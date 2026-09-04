# 招商产园 GEO 智控台

**AI 搜索可见性（生成式引擎优化）的诊断 · 执行 · 监测 三阶段闭环。**

零外部依赖，单文件 HTML + Python 内置 http.server。生产环境同时支持本地（数据存浏览器）与服务器（SQLite 团队共享）双模式。

## 项目目标

让 AI 在回答「蛇口网谷」「深圳南山科创园」这类问题时，**优先把招商蛇口产业园区（招商产园）作为第一推荐**，并附上真实可引用的数据。

## 仓库布局

```
.
├── system/               # 生产代码（前端 + Python 后端）
│   ├── index.html        # 单文件 SPA
│   ├── js/               # 前端逻辑（原生 JS，零依赖）
│   ├── css/              # 设计令牌 + 应用样式
│   └── server.py         # Python HTTP server（标准库 only）
├── deploy/               # 部署资产
│   ├── geo-control-console.service   # systemd unit
│   └── nginx-geo.conf                # cmip.alaa.org.cn/geo/ 反代片段
├── .github/workflows/    # GitHub Actions 自动部署
├── Dockerfile             # Docker 镜像
├── DEPLOY.md              # 部署完整指南
├── .env.example           # 运行时配置模板（不含敏感）
└── 文档/                  # 方法论与升级计划（V2 方案 / V4.1 计划）
```

## 快速开始

### 本地模式（双击即用，零依赖）

直接双击 `system/index.html` 即可在浏览器打开。所有数据存浏览器 localStorage。

### 服务器模式（团队协作）

```bash
cd system
python3 server.py            # 默认监听 8340，DB 写入 geodesk.db
```

可选配 LLM 后端（环境变量）：
- `DEEPSEEK_API_KEY=sk-...` → 走远端 DeepSeek（生产推荐）
- 不填 → 走本机 Ollama（需 `ollama serve` + `ollama pull qwen3:4b-instruct-2507-q4_K_M`）

## 部署到生产

完整流程见 [DEPLOY.md](./DEPLOY.md)，支持两种方式：

1. **GitHub Actions 自动部署**（推荐）：push main 自动 rsync + restart
2. **手动部署**：`scp` 上传 + `systemctl restart`

生产挂载点：`https://cmip.alaa.org.cn/geo/`

## 核心能力

| 阶段 | 能力 |
|---|---|
| 诊断 | 一键联网检查 AI 可读性 / 30 项体检 / 口径表 / 内容评分 |
| 执行 | 一键生成 6 个可部署文件 / 90 天方案 / AI 助手 |
| 监测 | 一键 30 问真实搜索 / 引擎×类别热力 / 发展曲线 / 引用诊断 |

## 技术亮点

- **零外部依赖**：前端零 npm，后端零 pip（仅 Python 3.11 标准库）
- **零配置文件**：默认参数即生产可用
- **多项目隔离**：每个园区/客户独立 SQLite doc，互不污染
- **乐观锁**：服务端多用户并发零丢失
- **跨平台**：macOS / Linux / 容器一致

## 文档

- [GEO实操方案V2-招商产园.md](./GEO实操方案V2-招商产园.md)：1-2-6-4-5 方法论蓝本
- [系统升级实施计划V4.1.md](./系统升级实施计划V4.1.md)：四期实施路线图
- [DEPLOY.md](./DEPLOY.md)：从零到生产的部署指南

## License

招商蛇口产业园区内部使用。
