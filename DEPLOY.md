# 部署指南——招商产园 GEO 智控台

部署到 `https://cmip.alaa.org.cn/geo/`（子路径模式，由 cmip 主站 nginx 反代到本服务）。

## 架构

```
用户浏览器
    ↓ HTTPS
cmip.alaa.org.cn（主站 nginx，已有 SSL）
    ↓ location /geo/ { proxy_pass http://127.0.0.1:8340/; }
127.0.0.1:8340（Python server.py，systemd 托管）
    ↓
SQLite（/var/lib/geo-control/geodesk.db）
    ↓ HTTPS
DeepSeek API（对话后端，OpenAI 兼容）
```

## 一次性部署（5 步）

### 第 1 步：服务器拉代码

```bash
ssh root@118.178.120.99
mkdir -p /var/www/geo_control_console
cd /var/www/geo_control_console
git clone https://github.com/JackieAi2008/geo-control-console.git . || git pull
```

### 第 2 步：填环境变量

```bash
sudo mkdir -p /etc/geo-control
sudo cp /var/www/geo_control_console/.env.example /etc/geo-control/geo-control.env
sudo nano /etc/geo-control/geo-control.env
```

至少填一个：
- `DEEPSEEK_API_KEY=sk-...`（推荐生产用 DeepSeek）
- 不填就走本机 Ollama（需 `ollama serve` + 已 `ollama pull qwen3:4b-instruct-2507-q4_K_M`）

```bash
sudo chmod 600 /etc/geo-control/geo-control.env
sudo chown root:root /etc/geo-control/geo-control.env
```

### 第 3 步：装 systemd 服务

```bash
sudo cp /var/www/geo_control_console/deploy/geo-control-console.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable geo-control-console
sudo systemctl start geo-control-console
sudo systemctl status geo-control-console   # 看到 active (running) 即成功
```

### 第 4 步：在 cmip 主站 nginx 加子路径反代

⚠️ **这一步必须在 cmip.alaa.org.cn 的 nginx 上做，不在 GEO 这边。**

把 `deploy/nginx-geo.conf` 整个文件的内容，追加到 cmip 主站 nginx 配置里（通常是 `/etc/nginx/sites-enabled/cmip` 或 `/etc/nginx/nginx.conf` 的 server 块内）。

```bash
# 在 cmip 主站服务器上执行（不是 GEO 服务器）
sudo cp /var/www/geo_control_console/deploy/nginx-geo.conf /tmp/nginx-geo.conf
# 人工把 /tmp/nginx-geo.conf 的内容追加到主站 server { ... } 块内
sudo nano /etc/nginx/sites-enabled/cmip.conf
sudo nginx -t && sudo nginx -s reload
```

> ⚠️ 重要：nginx 片段里的 `location ^~ /geo/` 必须紧贴在主站 server 块**内部**，而不是新建一个 server 块（否则会跟主站 HTTPS 冲突）。

### 第 5 步：验证

```bash
# 服务器本地
curl http://127.0.0.1:8340/api/ping
# 期望：{"ok": true, "server": "geodesk", "version": "4.0"}

# LLM 后端
curl http://127.0.0.1:8340/api/llm/status
# 期望：{"backend": "remote", "provider": "deepseek", "model": "deepseek-chat"}

# 通过 cmip 反代
curl https://cmip.alaa.org.cn/geo/api/ping
# 期望：同本地

# 浏览器
open https://cmip.alaa.org.cn/geo/
# 期望：看到 GEO 智控台首页
```

## 自动部署（CI/CD）

推送 `main` 分支自动部署。配置：

1. 在阿里云 ECS 生成 deploy key：
```bash
ssh root@118.178.120.99
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

2. GitHub 仓库 → Settings → Deploy keys → Add deploy key
   - Title: `aliyun-118.178.120.99`
   - Key: 粘贴上一步的公钥
   - **勾选 Allow write access**（其实用不到，但留着安全）
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：
   - `DEPLOY_SSH_KEY` = 私钥全文（`cat ~/.ssh/github_deploy` 的输出）
   - `DEPLOY_HOST` = `118.178.120.99`
   - `DEPLOY_USER` = `root`
   - `DEPLOY_PATH` = `/var/www/geo_control_console`
4. 推送代码到 main，Actions 自动跑：
   - rsync 代码到服务器
   - 保留服务器上的 `.env`（避免覆盖 LLM key）
   - restart systemd 服务
   - 验证 `/api/ping`

## 数据迁移（如果有旧 SQLite 库）

```bash
# 在旧环境（8340 端口）导出
scp old-server:/var/lib/geo-control/geodesk.db /tmp/geodesk.db.bak

# 上传到新服务器
scp /tmp/geodesk.db.bak root@118.178.120.99:/var/lib/geo-control/geodesk.db
sudo chown www-data:www-data /var/lib/geo-control/geodesk.db
sudo systemctl restart geo-control-console
```

## 备份策略

`server.py` 已内置：
- 每日自动备份到 `system/backups/geodesk-YYYYMMDD.json`（保留 30 份）
- 通过 `/api/audit` 查看操作留痕（最近 100 条）

生产环境建议：
- `/var/lib/geo-control/` 单独挂载云盘
- 用 crontab 把 `system/backups/` 同步到 OSS

## SSO 接入（暂未实施）

下一步要把 cmip.alaa.org.cn 的 SSO 接进来。需要从 cmip 站长那里拿到：
1. OIDC discovery endpoint
2. client_id / client_secret
3. 用户唯一字段（通常是 `sub` 或 `email`）
4. 回调地址白名单需添加 `https://cmip.alaa.org.cn/geo/auth/sso/callback`

拿到后实施步骤：
- `server.py` 新增 `/auth/sso/login`、`/auth/sso/callback`、`/auth/sso/logout` 三个路由
- `state` 的多项目数据按用户隔离（不同 cmip 账号看到不同项目）
- 删除「本地模式」/「服务器模式」徽标（这是内部技术细节，对外不暴露）

## 故障排查

| 现象 | 检查 |
|---|---|
| `/api/ping` 返回 connection refused | `sudo systemctl status geo-control-console`；看 stderr.log |
| `/api/ping` 返回 200 但浏览器 502 | cmip 主站 nginx 反代配置是否生效（`sudo nginx -T` 查 location） |
| 对话助手 503 | `curl /api/llm/status` 看后端是 none 还是 key 失效 |
| 对话助手 401 | DeepSeek key 失效；去 DeepSeek 控制台重新生成 |
| 数据库锁 | `sudo systemctl restart geo-control-console`；不要手动 kill -9 |