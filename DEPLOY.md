# 部署指南——招商产园 GEO 智控台

**生产环境已上线：https://geo.alaa.org.cn/（cmip SSO 汇总门户子系统）**

## 生产架构（2026-09-05 实际部署）

```
用户浏览器（cmip.alaa.org.cn 登录，cookie 域 .alaa.org.cn）
    ↓ 未登录 → 302 cmip.alaa.org.cn/#/login?redirect=...
    ↓ 已登录（cmip_sso cookie 自动携带）
geo.alaa.org.cn（nginx 443 + Let's Encrypt）
    ↓ auth_request → 127.0.0.1:8009/api/sso/check?system=geo   ← cmip 门户后端校验
    ↓ 401 → 302 门户登录页；200 → 放行（X-Sso-User 注入 X-Geo-User）
127.0.0.1:8340（geo-console.service，Python server.py）
    ↓
SQLite /var/lib/geo-control/geodesk.db（每日自动备份）
```

服务器：阿里云 ECS `118.178.120.99`（与 cmip 门户同机）
部署目录：`/var/www/geo.alaa.org.cn`（rsync 直传，服务器不出网连 GitHub）
systemd：`geo-console.service`（`/etc/geo-control/geo-control.env` 存配置）
nginx：`/etc/nginx/sites-enabled/geo.alaa.org.cn.conf`（auth_request SSO 门禁）

## 为什么是子域名而不是子路径

cmip 门户的 5 个既有子系统（qmjjr/yidun/tc/kzfy/weekly）全部是独立子域名模式：
- SSO cookie 域为 `.alaa.org.cn`，子域名天然携带，免跨域改造
- 门户通过 `/api/go?system=geo` 302 跳转并在跳转时重签 cookie（防 cookie 损坏）
- 独立 nginx conf，零风险不碰 cmip 主站配置

## 日常更新（发版）

本地改完代码后：

```bash
git add -A && git commit -m "..." && git push origin main   # 备份到 GitHub
rsync -az --delete \
  --exclude '.git' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'output' --exclude 'agent' --exclude '*.docx' \
  --exclude '.DS_Store' --exclude 'system/geodesk.db*' --exclude 'system/backups' \
  ./ root@118.178.120.99:/var/www/geo.alaa.org.cn/
ssh root@118.178.120.99 'systemctl restart geo-console && sleep 1 && curl -s http://127.0.0.1:8340/api/ping'
```

（GitHub Actions workflow 已备好 `.github/workflows/deploy.yml`，在仓库 Secrets 配置
DEPLOY_SSH_KEY/HOST/USER/PATH 后即可推送自动部署；GitHub runner 在境外可直连，服务器无需出网。）

## LLM 对话助手（待配 DeepSeek key）

服务器无 Ollama。启用对话助手：编辑 `/etc/geo-control/geo-control.env`：

```
DEEPSEEK_API_KEY=sk-xxxx
```

```bash
systemctl restart geo-console
curl http://127.0.0.1:8340/api/llm/status   # 应显示 backend:remote
```

不配 key 其余功能全部正常（诊断/执行/监测/台账），仅对话助手返回友好提示。

**已知降级**：信源侧快检/一键30问依赖 anysearch 脚本，服务器暂未安装——页面上会如实
提示「本机未找到 anysearch」，不编造数据。需要时把本机 `~/.openclaw/skills/anysearch/`
与 `~/.anysearch.json` 复制到服务器同路径即可启用。

## cmip 门户注册（已完成，留档）

- `/opt/cmip-portal/main.py` 的 `SYSTEMS` 清单已加 geo 条目（改前有 .bak 备份）
- 权限：admin 角色自动拥有；普通用户已在 `cmip.db` 的 `user_systems` 表逐人授予 `geo`
- 新用户授权：cmip 门户管理后台 → 用户管理 → 勾选「GEO 智控台」

## 故障排查

| 现象 | 检查 |
|---|---|
| 访问 302 到登录页但已登录 | cookie 过期（7天）→ 回门户重新登录；或门户 `user_systems` 表无 geo 权限 |
| 502 | `systemctl status geo-console`；`journalctl -eu geo-console \| tail` |
| 对话助手报"暂无可用的大模型后端" | `.env` 未配 DeepSeek key（见上节） |
| 快检报"未找到 anysearch" | 预期降级，见上节 |
| 门户菜单没有 GEO 智控台 | cmip-portal 未重启或 SYSTEMS 条目被还原 |
