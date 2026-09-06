#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GEO智控台 V3 · 轻量后台（Python 标准库，零依赖）

用法：  python3 server.py            # 默认 http://0.0.0.0:8340
        python3 server.py --port 8340 --db geodesk.db

能力：
  · 静态服务 system/ 前端（index.html/js/css）
  · GET  /api/ping                 健康检查
  · GET  /api/data                 读取全量工作区状态（SQLite 持久化，团队共享）
  · PUT  /api/data                 保存全量工作区状态
  · POST /api/probe  {"query":..}  信源侧快检：真实调用本机搜索通道(anysearch)，
                                    返回Top10结果与自有阵地标记（与2026-09-04基线同方法）
  · POST /api/answerbot/start      V0.1.7「AI代问」：后台线程逐问调用豆包（火山方舟联网通道），
                                    自动抽取提及/倾向/引用写入台账；GET /api/answerbot/status 轮询进度；
                                    GET/POST /api/answerbot/config 通道配置（密钥只存服务器，回显尾4位）

说明：答案侧监测以人工录入为基准；豆包已可经火山方舟联网通道自动提问（AI代问，标注 src=api，
      与人工记录同口径统计）；腾讯元宝等无公开API的引擎仍需人工提问录入。
      /api/probe 检测的是「实时检索通道的素材池」，是AI引用的上游，真实可自动化。
"""
import argparse, hashlib, json, os, re, sqlite3, subprocess, sys, threading, time, urllib.request, urllib.error, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# ===== LLM 后端（启动时确定，运行时按需切换） =====
# 优先级：远端 API（DeepSeek 等） > 本机 Ollama > 不可用
# 远端配置从环境变量读取（不要硬编码 key 到仓库里）
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip()
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434").strip()
# 性能实测(2026-09-04)：qwen3.5:9b 内容首字16.2s(思考型,太慢)；qwen3:4b-instruct 无思考、首字快，指导类任务够用 → 默认4b，9b备用
CHAT_MODELS_PREF = ["qwen3:4b-instruct-2507-q4_K_M", "qwen3.5:9b"]

BASE = os.path.dirname(os.path.abspath(__file__))
APP_VERSION = "0.1.13"   # 唯一版本源：页脚/接口自动跟随，发版时改这一处（V0.1.x 序列：0.1.7=AI代问；旧 6.x 序列已封存）
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
                ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json"}
ANYSEARCH = os.environ.get("ANYSEARCH_CLI", os.path.expanduser("~/.openclaw/skills/anysearch/scripts/anysearch_cli.py"))   # 生产可用 env 指向独立部署的搜索脚本
# ===== 豆包联网通道（V0.1.7「AI代问」，火山方舟 Responses API + 内置 web_search 工具）=====
ARK_URL = os.environ.get("ARK_URL", "https://ark.cn-beijing.volces.com/api/v3/responses").strip()
ARK_API_KEY = os.environ.get("ARK_API_KEY", "").strip()          # 密钥只放环境变量或管理设置，严禁入库
ARK_MODEL = os.environ.get("ARK_MODEL", "").strip()              # 接入点 ID（ep-…）；数据面要求 ep，经「通道设置」或 env 注入
BOT_CAP_DEFAULT = 2000    # 每项目每月自动调用上限（联网搜索免费额度2万次/月的护栏，kv bot:cap 可调）
OWN_DOMAINS = ["cmsk1979.com", "cmhk.com", "mp.weixin.qq.com", "weixin.qq.com"]
MAX_BODY = 5 * 1024 * 1024
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai",
           "PerplexityBot", "Perplexity-User", "Bytespider", "Google-Extended", "CCBot", "Applebot"]

def pick_chat_model():
    """选本机Ollama可用的最佳中文对话模型；不可用返回None"""
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3) as r:
            names = [m["name"] for m in json.loads(r.read()).get("models", [])]
    except Exception:
        return None
    names = [n for n in names if "embed" not in n]
    for pref in CHAT_MODELS_PREF:
        if pref in names: return pref
    return names[0] if names else None

# ── 用户自接入 LLM（按登录账号隔离；生产由 nginx auth_request 注入 X-Geo-User）──
import ipaddress

def geo_user(headers):
    """当前登录用户名。仅信任同机 nginx 注入的头（服务只监听 127.0.0.1，外部无法直连伪造）"""
    return (headers.get("X-Geo-User") or "").strip()[:64] or "local"

def llm_user_config(conn, u):
    try:
        c = kv_get(conn, "llm:user:" + u) or {}
        if c.get("baseUrl") and c.get("model"):
            return {"provider": c.get("provider", "custom"), "baseUrl": c["baseUrl"],
                    "model": c["model"], "apiKey": c.get("apiKey", ""), "updatedAt": c.get("updatedAt", "")}
    except Exception:
        pass
    return None

def mask_key(k):
    k = str(k or "")
    return ("****" + k[-4:]) if len(k) >= 8 else ("*" * len(k) if k else "—")

def llm_url_guard(u, allow_loopback_http=False):
    """SSRF 防护：默认仅 https + 拒绝内网/CGNAT(云metadata)。
    allow_loopback_http=True（本地 Ollama 场景）时额外放行 http://127.0.0.1:任意端口。返回错误文案，空串=通过"""
    try:
        p = urlparse(str(u or ""))
    except Exception:
        return "地址格式不正确"
    h = (p.hostname or "").lower()
    if not h:
        return "缺少主机名"
    loop = h in ("127.0.0.1", "localhost", "::1")
    if p.scheme == "https":
        pass
    elif p.scheme == "http":
        if not (allow_loopback_http and loop):
            return "仅允许 https 地址（本地 Ollama 可用 http://127.0.0.1:端口）"
    else:
        return "仅允许 http/https 地址"
    if loop and p.scheme == "http":
        return ""   # 环回 http 仅本机 Ollama 场景放行（不影响其余内网拦截）
    if h == "localhost" or h.endswith((".localhost", ".internal", ".local", ".lan")):
        return "不允许内网地址"
    try:
        ip = ipaddress.ip_address(h)
        bad = ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified
        if bad or (ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10")):
            return "不允许内网地址"
    except ValueError:
        pass   # 域名放行（DNS 级伪造为残留风险；已叠加 仅https+禁自动重定向 两层缓解）
    return ""

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """禁自动重定向：防配置的 URL 通过 3xx 跳到内网地址（SSRF 跳转绕过）"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def llm_resolve(conn, headers):
    """解析当前生效的聊天后端。优先级：本账号配置 > 服务器环境 DeepSeek > 本机 Ollama。
    返回 (source, model, cfg|None)；source ∈ user/server/local/none"""
    cfg = llm_user_config(conn, geo_user(headers))
    if cfg:
        return "user", cfg["model"], cfg
    if DEEPSEEK_API_KEY:
        return "server", DEEPSEEK_MODEL, {"provider": "deepseek", "baseUrl": DEEPSEEK_BASE_URL,
                                          "model": DEEPSEEK_MODEL, "apiKey": DEEPSEEK_API_KEY}
    m = pick_chat_model()
    if m:
        return "local", m, None
    return "none", "", None

def llm_remote_open(cfg, msgs, stream, timeout=30, max_tokens=1024):
    """OpenAI 兼容远端调用（DeepSeek/通义/Kimi/智谱/豆包/Ollama /v1/自定义通用）；无密钥不发 Authorization"""
    payload = {"model": cfg["model"], "messages": msgs, "stream": stream,
               "temperature": 0.4, "max_tokens": max_tokens}
    headers = {"Content-Type": "application/json"}
    if cfg.get("apiKey"):
        headers["Authorization"] = "Bearer " + cfg["apiKey"]
    req = urllib.request.Request(cfg["baseUrl"].rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(), headers=headers)
    return urllib.request.build_opener(_NoRedirect).open(req, timeout=timeout)

def state_summary(conn, pid=None):
    """把当前项目状态浓缩成助手上下文（助手因此知道你的真实数据）"""
    try:
        plist = projects_ensure(conn)
        pid = pid if pid and any(p["id"] == pid for p in plist) else (plist[0]["id"] if plist else None)
        proj = next((p for p in plist if p["id"] == pid), {}) if pid else {}
        st = (kv_get(conn, proj_doc_key(pid)) or {}).get("state") or {} if pid else {}
        mode = _ent_mode(proj)
        audit_all = st.get("audit", {})
        audit = {k: v for k, v in audit_all.items() if not (mode == "none" and k in SITE_AUDIT_IDS)}   # V4.5 分母同口径
        got = sum(audit.values()); full = len(audit) * 2 or (48 if mode == "none" else 60)
        ledger = st.get("ledger", [])
        mention = round(sum(float(r.get("mention", 0)) for r in ledger) / len(ledger) * 100) if ledger else None
        cal = st.get("caliber", []); conf = sum(1 for r in cal if r.get("conflicts"))
        ld = st.get("lastDiag") or {}
        diag = ""
        if ld.get("checks"):
            fails = [c["id"] + c["name"] for c in ld["checks"] if c["status"] == "fail"]
            warns = [c["id"] for c in ld["checks"] if c["status"] == "warn"]
            dmode = "实体体检" if ld.get("mode") == "entity" else "一键诊断"
            diag = f"；最近一次{dmode}({ld.get('url','')})：未过项={('、'.join(fails) if fails else '无')}，警告项={('、'.join(warns) if warns else '无')}"
        em = f"；项目承载形态={ {'own':'有官网','parent':'挂上级官网','none':'暂无官网(走实体体检路线)'}[mode] }"
        return (f"体检成熟度{got}/{full}分{em}；监测台账{len(ledger)}条，平均提及率{('%d%%' % mention) if mention is not None else '无数据'}；"
                f"口径表{len(cal)}字段其中{conf}个有外部冲突{diag}；官方承载页={st.get('parkUrl','未填')}")
    except Exception as e:
        return f"（状态读取失败：{e}）"

CHAT_SYSTEM = """你是「招商产园GEO智控台」内置助手，教用户用系统并解答园区GEO问题。简体中文，先结论后展开，默认≤120字（用户要求展开才加长），提操作要给页面/按钮名，不编造数据（状态没有就说明先跑哪个功能）。

【系统地图】入口=项目库（打开系统第一页：搜索项目名/品牌词/域名、按形态筛选[有官网/挂上级官网/无官网]、按状态筛选[未诊断/有预警]、排序、含已归档开关可恢复归档项目；「上次处理」条一步回到最近项目）。每个园区/楼宇/要诊断的实体一个项目，新建时选「网上哪里能找到这个项目」。项目内：工作台=三步向导+状态。诊断：双入口——官网体检（填官方承载页域名+品牌词,真实探测HTTPS/robots/WAF/llms.txt/渲染/Schema/alt,自动回填体检表）或实体体检（无官网项目专用：只填品牌词,真实搜索查自有渠道/百科词条/企业信息平台/权威信源,附12项实体资产核对清单打分）·30项体检（无官网项目技术可达6项不适用不计分）·口径表·内容评分(≥75分才发布)·证据库。执行：一键生成优化文件——有官网项目6件(robots片段/llms.txt/Schema/一园一档/FAQ20问/渠道分发指南)，无官网项目5件(百科词条更新稿/地图信息核对清单/一园一档公众号版/FAQ/渠道指南,不需要任何技术)·90天方案·AI助手提示词。监测：跑一轮30问(批量真实搜索自动入台账,双周一次)·人工台账·引用诊断(谁在赢我们的问题)·发展曲线。知识库=方法论。
【真实控件名·只可引用这些，不确定就只说页面位置，严禁编造按钮】项目库/＋新建项目/开始一键诊断/开始实体体检/官网体检/实体体检/下载诊断报告/30项体检/口径表/添加字段/导出JSON/内容评分/开始体检/一键生成优化文件/打包下载全部/生成方案/跑一轮30问（真实搜索）/停止/导出CSV/含已归档/恢复到项目库/查排名/打开助手对话窗。若用户提到的功能或按钮不在名单与系统地图中，直接回答「本系统没有这个功能」并给出最接近的正确入口；不得发明任何按钮、页面或流程。
【GEO速查】五步链路:爬取→索引→检索→重排→生成引用;四条件:可达可读可信可验证;有效策略:引用来源/真实引言/统计数字/流畅/权威语气(最高+40%),堆砌注水无效;见效:3-5天可检索,10-15天首批引用,8-12周稳定(参考值)。引擎偏好:豆包→抖音97.7%+头条CSDN;DeepSeek→权威媒体,孤证不立,口径不一致首选率暴跌82%;元宝→公众号;文心→百度系81.7%;千问→头条;Kimi→知乎长文。无官网项目路线:官网不是GEO必要条件——先做实体体检建基线,再依次①百度百科词条(数字附权威来源)②三大地图认领核对③官方公众号首发一园一档,工单全是品宣自己能做的事,不需要官网管理员。"""

_db_lock = threading.Lock()

def db(path):
    # check_same_thread=False：配合 _db_lock 供多线程 handler 使用
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, ts REAL)")
    return conn

def kv_get(conn, k):
    with _db_lock:
        row = conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(row[0]) if row else None

def kv_put(conn, k, v):
    with _db_lock:
        conn.execute("INSERT INTO kv(k,v,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts",
                     (k, json.dumps(v, ensure_ascii=False), time.time()))
        conn.commit()

# ── V4 多项目层 ────────────────────────────────────────────
AUDIT_MAX = 500
DB_PATH = None  # main() 注入，备份目录据此定位

def audit_append(conn, actor, project, action, detail=""):
    """操作留痕（server 侧追加，前端不直写，避免并发整键覆盖）"""
    with _db_lock:
        row = conn.execute("SELECT v FROM kv WHERE k='audit'").fetchone()
        log = json.loads(row[0]) if row else []
        log.append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "actor": actor or "未知操作员",
                    "project": project, "action": action, "detail": str(detail)[:200]})
        conn.execute("INSERT INTO kv(k,v,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts",
                     ("audit", json.dumps(log[-AUDIT_MAX:], ensure_ascii=False), time.time()))
        conn.commit()

def proj_doc_key(pid):
    return "doc:project:" + str(pid)

def projects_get(conn):
    return kv_get(conn, "projects") or []

def projects_ensure(conn):
    """项目层幂等迁移：旧全局 doc/state → 默认项目（旧键保留不删，30 天后可清）。返回项目列表。
       V0.1.13 F2：全新空库不再凭空预置「蛇口网谷」真实园区项目——新账号首屏会误以为库里
       躺着别人的项目（还带「当前」徽标与一条不是自己做的留痕）。空库改为显式示例项目
       （sample 标记 → 前端卡片「示例」徽标，可改名/归档）。老库迁移路径保持原行为：
       那是真实数据搬家，不是预置。"""
    plist = kv_get(conn, "projects")
    if plist:
        return plist
    old_doc = kv_get(conn, "doc") or {}
    old_state = old_doc.get("state") or kv_get(conn, "state") or {}
    if old_state:
        name = (str(old_state.get("parkUrl") or "").strip()) or "蛇口网谷"  # 系统既有口径种子与基线均为蛇口网谷
        proj = {"id": "p_default", "name": name, "url": old_state.get("parkUrl") or "",
                "brand": "", "ownDomains": list(OWN_DOMAINS),
                "createdAt": time.strftime("%Y-%m-%d"), "archived": False}
        kv_put(conn, proj_doc_key(proj["id"]), {"rev": max(int(old_doc.get("rev") or 0), 0), "state": old_state})
    else:
        proj = {"id": "p_default", "name": "示例项目", "url": "", "brand": "示例园区",
                "ownDomains": [], "entityMode": "none", "sample": True,
                "createdAt": time.strftime("%Y-%m-%d"), "archived": False}
        kv_put(conn, proj_doc_key(proj["id"]), {"rev": 0, "state": {}})
    kv_put(conn, "projects", [proj])
    return [proj]

def _ent_mode(p):
    """V4.6 承载形态（与前端 entMode() 同口径）：显式字段优先，老项目按 url 推导"""
    m = str(p.get("entityMode") or "").strip()
    if m in ("own", "parent", "none"):
        return m
    return "parent" if str(p.get("url") or "").strip() else "none"


SITE_AUDIT_IDS = {"T1", "T2", "T3", "T4", "T5", "T6"}   # 与前端 GEO.SITE_IDS 同步：无官网项目不进体检分母


def proj_summary(conn, p):
    """项目库卡片汇总（V4.6：体检分按承载形态分母 + 待办工单数 + 最近诊断；项目库即组合视图数据源）"""
    doc = kv_get(conn, proj_doc_key(p["id"])) or {}
    st = doc.get("state") or {}
    audit = st.get("audit") or {}
    mode = _ent_mode(p)
    keys = [k for k in audit if not (mode == "none" and k in SITE_AUDIT_IDS)]
    got = sum(audit[k] for k in keys)
    full = len(keys) * 2 or (48 if mode == "none" else 60)
    ledger = st.get("ledger") or []
    mention = round(sum(float(r.get("mention", 0)) for r in ledger) / len(ledger) * 100) if ledger else None
    snaps = st.get("snapshots") or []
    base = next((x for x in snaps if x.get("baseline")), snaps[0] if snaps else None)
    cur = snaps[-1] if snaps else None
    ans = cur.get("mentionAns") if (cur and cur.get("mentionAns") is not None) else None
    trend = None
    if cur and base and cur.get("mentionAns") is not None and base.get("mentionAns") is not None:
        trend = cur["mentionAns"] - base["mentionAns"]
    warn = []
    if not ledger: warn.append("无监测")
    if not (st.get("caliber") or []): warn.append("无口径表")
    if trend is not None and trend < 0: warn.append("提及率下滑")
    probes = st.get("probes") or []
    if probes:
        ld = max(x.get("date", "") for x in probes)
        last = [x for x in probes if x.get("date") == ld]
        ratio = sum(1 for x in last if x.get("ownHit")) / len(last)
        if ratio < 0.2: warn.append("信源缺席")
    # V4.6 待办：整改工单未验收数 + 修复队列未验证数（「有事等我」红标数据源）
    wo = 0
    for per in (st.get("remediation") or {}).values():
        wo += sum(1 for s in (per or {}).values() if s != "已验收")
    wo += sum(1 for o in (st.get("fixQueue") or []) if (o or {}).get("status") != "已验证")
    dh = st.get("diagHistory") or []
    last_diag = (str(dh[0].get("ts", "") if dh else "") or str((st.get("lastDiag") or {}).get("ts", "") or ""))[:10]
    return {"auditPct": round(got / full * 100) if full else 0, "ledgerN": len(ledger), "mentionPct": mention,
            "mentionAns": ans, "trend": trend, "lastRound": (cur or {}).get("date") if snaps else None,
            "warn": warn, "woPending": wo, "lastDiag": last_diag or None, "entMode": mode}

def backup_now(conn):
    """全量备份：projects + 各项目 doc + audit → <db目录>/backups/geodesk-YYYYMMDD.json（保留30份）"""
    try:
        plist = projects_ensure(conn)
        payload = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "projects": plist,
                   "docs": {p["id"]: kv_get(conn, proj_doc_key(p["id"])) for p in plist},
                   "audit": kv_get(conn, "audit") or []}
        bdir = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)) or ".", "backups")
        os.makedirs(bdir, exist_ok=True)
        fname = time.strftime("geodesk-%Y%m%d.json")
        with open(os.path.join(bdir, fname), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        olds = sorted(x for x in os.listdir(bdir) if x.startswith("geodesk-") and x.endswith(".json"))
        for x in olds[:-30]:
            try: os.remove(os.path.join(bdir, x))
            except OSError: pass
        return fname
    except Exception as e:
        return f"备份失败: {e}"

def _fetch(url, timeout=10, max_bytes=800000):
    """真实 HTTP 探测：返回 (status, body_text, final_url)；网络失败返回 (None, 错误信息, url)"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(max_bytes).decode("utf-8", "ignore"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, "", url
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"[:120], url

def _robots_blocks(txt):
    """解析 robots.txt → {agent: [rules]}（粗解析，够判断用）"""
    blocks, agent, rules = {}, None, []
    for line in txt.splitlines():
        s = line.split("#")[0].strip()
        if not s: continue
        k, _, v = s.partition(":")
        k, v = k.strip().lower(), v.strip()
        if k == "user-agent":
            if agent and rules: blocks.setdefault(agent, rules)
            agent, rules = v, []
        elif agent and k in ("allow", "disallow"):
            rules.append((k, v))
    if agent and rules: blocks.setdefault(agent, rules)
    return blocks

def diagnose(url, brand="", own_domains=None, mode="site", group_domains=None):
    """一键诊断。mode="site"：对园区官网做真实技术体检；mode="entity"（V4.5）：无官网实体体检——
    品牌词真实搜索推导实体资产证据（自有渠道/百科/企业信息/权威信源），不依赖官网。全部带证据。"""
    if mode == "entity":
        return _diagnose_entity(brand, own_domains, group_domains)
    host = re.sub(r"^https?://", "", (url or "").strip().rstrip("/"))
    if not host or "/" in host: host = (host or "").split("/")[0]
    if not host:
        return {"error": "请输入有效的官网域名，如 www.example.com"}
    https_url, http_url = f"https://{host}/", f"http://{host}/"
    checks = []

    # ── T1a HTTPS 可达 ──
    st, body, final = _fetch(https_url)
    if st != 200:  # HTTPS 不可达时回退 HTTP 抓首页（大量政企官网仅HTTP可达）
        st_h0, body_h0, _ = _fetch(http_url)
        if st_h0 == 200:
            st, body = st_h0, body_h0
    html = body if st == 200 else ""
    checks.append({"id": "T1a", "name": "HTTPS 可达", "status": "pass" if st == 200 else "fail",
                   "evidence": f"GET {https_url} → {st if st else '连接失败'}" + (f"（{body}）" if st != 200 and body and st else ""),
                   "score": {"T1": 2 if st == 200 else 0}})
    # ── HTTP 行为 ──
    st_h, _, _ = _fetch(http_url)
    checks.append({"id": "T1b", "name": "HTTP 行为", "status": "pass" if st_h in (200, 301, 302, 308) else "warn",
                   "evidence": f"GET {http_url} → {st_h if st_h else '连接失败'}" + ("（未跳转HTTPS，双协议并存）" if st_h == 200 else ""),
                   "score": {}})
    # ── T1 robots.txt 与 AI 爬虫 ──
    rst, rtxt, rurl = _fetch(https_url + "robots.txt")
    robots_attempts = [f"GET {https_url}robots.txt → {rst if rst is not None else '连接失败'}"]
    if rst != 200 and rst is not None or rst is None:
        rst, rtxt, rurl = _fetch(http_url + "robots.txt")
        robots_attempts.append(f"GET {http_url}robots.txt → {rst if rst is not None else '连接失败'}")
    if rst == 403:
        checks.append({"id": "T1", "name": "robots.txt / WAF", "status": "fail",
                       "evidence": f"GET {rurl} → 403 Forbidden（WAF/反爬对非浏览器UA拦截——AI爬虫大概率同样被拦，需IT在CDN/WAF白名单放行）", "score": {"T1": 0}})
    elif rst == 200 and rtxt:
        blocks = _robots_blocks(rtxt)
        star = blocks.get("*", [])
        blocked_star = any(k == "disallow" and v == "/" for k, v in star)
        ai_named = {b: blocks[b] for b in blocks if b in [a.lower() for a in AI_BOTS]}
        ai_blocked = [b for b, rules in ai_named.items() if any(k == "disallow" and v == "/" for k, v in rules)]
        named_txt = ("；AI爬虫专项规则：" + "、".join(f"{b}:{'拦截' if b in ai_blocked else '放行'}" for b in ai_named)) if ai_named else ""
        if blocked_star or ai_blocked:
            checks.append({"id": "T1", "name": "robots.txt / WAF", "status": "fail",
                           "evidence": f"GET {rurl} → 200；通配规则{'全站Disallow' if blocked_star else ''}{('；拦截AI爬虫：' + '、'.join(ai_blocked)) if ai_blocked else ''}", "score": {"T1": 0}})
        else:
            checks.append({"id": "T1", "name": "robots.txt / WAF", "status": "pass",
                           "evidence": f"GET {rurl} → 200，未发现全站Disallow或AI爬虫拦截{named_txt}", "score": {"T1": 2}})
    else:
        # V4.2：证据如实列出两次尝试（HTTPS/HTTP），避免读者误以为只查了一种协议
        checks.append({"id": "T1", "name": "robots.txt / WAF", "status": "warn",
                       "evidence": "；".join(robots_attempts) + "（未获取到robots.txt）", "score": {"T1": 1}})
    # ── T5 llms.txt ──
    lst, _, lurl = _fetch(https_url + "llms.txt")
    checks.append({"id": "T5", "name": "llms.txt（可选项）", "status": "pass" if lst == 200 else "warn",
                   "evidence": f"GET {lurl} → {lst}（Google已声明不使用此文件，缺失不影响收录）", "score": {"T5": 2 if lst == 200 else 0}})
    if html:
        # ── T2 服务端渲染（HTML源码可见文本量）──
        text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        n = len(re.sub(r"[^\u4e00-\u9fffa-zA-Z0-9]", "", text))
        checks.append({"id": "T2", "name": "服务端渲染（源码可读文本量）", "status": "pass" if n >= 800 else ("warn" if n >= 200 else "fail"),
                       "evidence": f"首页HTML源码去标签后有效字符 ≈ {n}（≥800 为AI可读良好；过低=内容依赖JS渲染或图片化）",
                       "score": {"T2": 2 if n >= 800 else (1 if n >= 200 else 0)}})
        # ── T4 结构化数据 ──
        ld = re.findall(r'<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>', html, flags=re.I)
        types = []
        for blk in ld:
            try: types += re.findall(r'"@type"\s*:\s*"([^"]+)"', blk)
            except Exception: pass
        has = [t for t in types if t in ("Organization", "LocalBusiness", "FAQPage", "Place", "Product")]
        checks.append({"id": "T4", "name": "Schema 结构化数据", "status": "pass" if has else ("warn" if types else "fail"),
                       "evidence": ("检出 " + "、".join(dict.fromkeys(types)) + ("（含GEO相关类型）" if has else "（无Organization/LocalBusiness/FAQPage）")) if types else "未检出 JSON-LD 结构化数据",
                       "score": {"T4": 2 if has else (1 if types else 0)}})
        # ── C2 标题与描述 ──
        m_t = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, flags=re.I)
        m_d = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', html, flags=re.I)
        title = (m_t.group(1).strip() if m_t else "")
        desc = (m_d.group(1).strip() if m_d else "")
        ok_td = bool(title) and bool(desc) and len(desc) >= 30
        checks.append({"id": "C2", "name": "标题与页面描述", "status": "pass" if ok_td else "warn",
                       "evidence": f"title=「{title[:40]}」；description={('「' + desc[:50] + '…」') if desc else '缺失'}",
                       "score": {"C2": 2 if ok_td else 1}})
        # ── C6 图片可解析（alt覆盖率粗测）──
        imgs = re.findall(r"<img\b[^>]*>", html, flags=re.I)
        with_alt = [i for i in imgs if re.search(r'\balt=["\'][^"\']+["\']', i, flags=re.I)]
        ratio = (len(with_alt) / len(imgs)) if imgs else 1
        checks.append({"id": "C6", "name": "图片文字替代（alt覆盖率）", "status": "pass" if ratio >= 0.6 else "warn",
                       "evidence": f"首页图片 {len(imgs)} 张，{len(with_alt)} 张有alt（{int(ratio*100)}%）",
                       "score": {"C6": 2 if ratio >= 0.6 else 1}})
    # ── 品牌词搜索：自有阵地是否进前10 ──
    if brand:
        pr = run_probe(brand, own_domains, group_domains)
        if not pr.get("error"):
            tops = pr.get("results", [])[:10]
            own = [t for t in tops if t["own"]]
            doms = [urlparse(t["url"]).netloc for t in tops]
            checks.append({"id": "E2a", "name": "品牌词搜索·自有阵地", "status": "pass" if own else "fail",
                           "evidence": ("前10含自有阵地：" + "、".join(urlparse(t["url"]).netloc for t in own)) if own else
                                       (f"搜索「{brand}」前10全部为第三方：" + "、".join(doms[:5]) + "…"),
                           "score": {"E2": 1 if own else 0}, "top_domains": doms,
                           "tops": [{"title": t.get("title", ""), "url": t.get("url", ""), "own": bool(t.get("own"))} for t in tops]})
        else:
            checks.append({"id": "E2a", "name": "品牌词搜索·自有阵地", "status": "warn",
                           "evidence": f"搜索通道暂不可用：{pr['error']}", "score": {}})
    score_map = {}
    for c in checks:
        for k, v in c.get("score", {}).items():
            score_map[k] = max(score_map.get(k, 0), v)
    return {"url": host, "https_url": https_url, "checks": checks,
            "auto_scores": score_map, "ts": __import__("time").strftime("%Y-%m-%d %H:%M"), "mode": "site"}


def _diagnose_entity(brand, own_domains, group_domains=None):
    """V4.5 实体体检：无官网项目的诊断入口。一次品牌词真实搜索推导四类实体证据——
    E2a 自有渠道是否进前10 / E1 百科词条 / E6 企业信息平台 / E4 权威信源。
    判定保守（warn 为主），证据里写明人工核实方法，不编造。"""
    brand = (brand or "").strip()
    if not brand:
        return {"error": "实体体检需要品牌词（如：万海大厦）——它替代官网成为检查对象"}
    checks = []
    pr = run_probe(brand, own_domains, group_domains)
    if pr.get("error"):
        return {"error": "搜索通道暂不可用：" + str(pr["error"])}
    tops = pr.get("results", [])[:10]
    doms = [urlparse(t["url"]).netloc for t in tops]
    # ── E2a 自有渠道：品牌词前10 有无官方承载阵地（承载页/公众号域名）──
    own = [t for t in tops if t["own"]]
    checks.append({"id": "E2a", "name": "品牌词搜索·自有渠道", "status": "pass" if own else "fail",
                   "evidence": ("前10含自有渠道：" + "、".join(urlparse(t["url"]).netloc for t in own)) if own else
                               (f"搜索「{brand}」前10全部为第三方：" + "、".join(doms[:5]) + "…"),
                   "score": {"E2": 1 if own else 0}, "top_domains": doms,
                   "tops": [{"title": t.get("title", ""), "url": t.get("url", ""), "own": bool(t.get("own"))} for t in tops]})
    # ── E1 百科词条：前10 是否出现百度百科（AI 交叉对照的基础层）──
    baike = [d for d in doms if d.endswith("baike.baidu.com")]
    checks.append({"id": "E1", "name": "百科词条", "status": "pass" if baike else "warn",
                   "evidence": (f"搜索「{brand}」前10 出现百度百科（排名第{doms.index(baike[0]) + 1}位）——词条存在且可见，请人工核对数据是否与口径表一致") if baike else
                               (f"搜索「{brand}」前10 未见百度百科：" + ("、".join(doms[:5]) or "无结果") + "… 词条可能不存在或权重弱——去 baike.baidu.com 搜品牌词人工确认，无词条则按口径表创建"),
                   "score": {"E1": 2 if baike else 0}})
    # ── E6 企业信息：前10 是否出现企业信息平台（AI 核验运营主体的底层源）──
    ent_doms = [d for d in doms if any(k in d for k in ("qcc.com", "tianyancha.com", "aiqicha.baidu.com", "qixin.com"))]
    checks.append({"id": "E6", "name": "企业信息平台", "status": "pass" if ent_doms else "warn",
                   "evidence": (f"前10 含企业信息平台：" + "、".join(ent_doms) + "——请人工进平台核对运营主体名称/法人/地址与官方一致") if ent_doms else
                               "前10 未见企查查/天眼查/爱企查——AI 查「谁在运营」时缺底层数据，请人工到两平台核对并补全信息",
                   "score": {"E6": 2 if ent_doms else 0}})
    # ── E4 权威信源：前10 有无政府/权威媒体（gov.cn、央媒、主流新闻站）──
    AUTH = ("gov.cn", "people.com.cn", "xinhuanet.com", "news.cn", "cctv.com", "chinanews.com", "ce.cn",
            "eeo.com.cn", "caixin.com", "21jingji.com", "thepaper.cn", "cs.com.cn", "cinn.cn")
    auth_doms = [d for d in doms if any(d == a or d.endswith("." + a) or a in d for a in AUTH)]
    checks.append({"id": "E4", "name": "权威信源覆盖", "status": "pass" if auth_doms else "warn",
                   "evidence": (f"前10 含权威信源：" + "、".join(auth_doms[:4]) + "——把其中提及本项目的报道整理成带年份出处的可引用素材") if auth_doms else
                               "前10 未见政府/权威媒体——权威背书尚未被检索到，把榜单/资质/披露整理成文字并发布（见工单 E4）",
                   "score": {"E4": 1 if auth_doms else 0}})
    score_map = {}
    for c in checks:
        for k, v in c.get("score", {}).items():
            score_map[k] = max(score_map.get(k, 0), v)
    return {"url": brand, "https_url": "", "checks": checks,
            "auto_scores": score_map, "ts": __import__("time").strftime("%Y-%m-%d %H:%M"), "mode": "entity"}


def parse_answer(text, brand, competitors, headers=None, conn=None):
    """V4 3.4：把人工粘贴的 AI 回答原文结构化（提及/情感/引用域名/竞品共现）。
    V5：模型走三级回退（本账号配置 > 服务器 DeepSeek > 本机 Ollama），与对话助手同一条轨道；
    只抽取不判断对错；失败如实返回 error，前端优雅降级为手工填写。"""
    src, model, cfg = llm_resolve(conn, headers or {})
    if src == "none":
        return {"error": "当前没有可用的大模型。两种解决方式：①点右下角「问」助手窗口右上角的 ⚙，配置你自己的模型（推荐，一次配置全系统可用）；②联系管理员在服务器设置。"}
    if not text or not str(text).strip():
        return {"error": "text 不能为空"}
    comp = "、".join([str(c) for c in (competitors or []) if str(c).strip()][:8]) or "无指定候选——答案中出现其他知名同类也请列入"
    sys_prompt = f"""你是监测数据抽取器。输入是用户粘贴的一段AI引擎回答原文，目标品牌是「{brand or '（未指定）'}」。只输出一个JSON对象，不要输出任何其他文字：
{{"mention": 1或0.5或0（明确提及目标品牌=1；仅相似或模糊指代=0.5；完全未提及=0），
"sentiment": 1或0.5或0（提及内容的语气：正面推荐=1；中性客观=0.5；负面或含错误信息=0；未提及时填0.5），
"citedDomains": [回答中出现的引用/参考链接域名数组，没有则空数组],
"competitorMentions": [答案中同时出现的竞品名数组（候选：{comp}），没有则空数组]}}
规则：只依据原文判断，不猜测不补全；citedDomains 只收真正的链接域名（形如 xx.yy），「来源：某机构名/某研究」这类机构名不算域名、不得编造成域名。"""
    if src in ("user", "server"):
        try:
            with llm_remote_open(cfg, [{"role": "system", "content": sys_prompt},
                                       {"role": "user", "content": str(text)[:6000]}],
                                 stream=False, timeout=150, max_tokens=300) as r:
                out = json.loads(r.read())
        except Exception as e:
            return {"error": f"模型调用失败：{e}"}
        raw = (out.get("choices") or [{}])[0].get("message", {}).get("content", "")
    else:
        payload = {"model": model, "messages": [{"role": "system", "content": sys_prompt},
                   {"role": "user", "content": str(text)[:6000]}],
                   "stream": False, "think": False, "format": "json",
                   "options": {"temperature": 0.1, "num_predict": 300}, "keep_alive": "30m"}
        try:
            req = urllib.request.Request(OLLAMA + "/api/chat", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=150) as r:
                out = json.loads(r.read())
        except Exception as e:
            return {"error": f"模型调用失败：{e}"}
        raw = (out.get("message") or {}).get("content", "")
    try:
        d = json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return {"error": "模型未返回合法 JSON，请手工填写", "raw": raw[:200]}
        try:
            d = json.loads(m.group(0))
        except Exception:
            return {"error": "模型未返回合法 JSON，请手工填写", "raw": raw[:200]}
    def norm3(v):
        s = str(v)
        if s in ("1", "1.0"): return 1
        if s in ("0.5",): return 0.5
        if s in ("0", "0.0"): return 0
        return None
    def norm_host(x):
        # V4.2：归一化为裸域名——去协议、去路径/锚点、去端口前的空白；模型有时会带 https:// 前缀
        h = re.sub(r"^https?://", "", str(x).strip(), flags=re.I)
        h = h.split("/")[0].split("?")[0].strip().lower()
        return h
    doms = []
    for x in (d.get("citedDomains") or []):
        h = norm_host(x)
        if h and "." in h and h not in doms:
            doms.append(h)
    return {"mention": norm3(d.get("mention")), "sentiment": norm3(d.get("sentiment")),
            "citedDomains": doms[:10],
            "competitorMentions": [str(x).strip() for x in (d.get("competitorMentions") or []) if str(x).strip()][:10]}

# V6 1.3 品牌词歧义检测：城市/地标词表（阳性信号=结果标题中"其他城市+核心词"共现）
AMBIG_PLACES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "重庆", "武汉", "西安", "南京", "苏州", "天津",
                "长沙", "郑州", "青岛", "大连", "厦门", "合肥", "福州", "昆明", "沈阳", "哈尔滨", "石家庄",
                "济南", "无锡", "宁波", "佛山", "东莞", "纽约", "伦敦", "东京", "巴黎", "首尔", "新加坡", "香港"]

def brand_check(conn, brand, city):
    """V6 R2：阳性信号判定——只看"检出其他城市+品牌核心词共现"，不做"缺本地词"推断（会误伤）。
    结果 24h 缓存（kv brand:check:<词>）控外呼成本；anysearch 不可用时如实返回 unknown。"""
    brand = (brand or "").strip()
    city = (city or "").strip()
    if not brand or len(brand) < 2:
        return {"ambiguity": False}
    ck = "brand:check:" + brand
    cached = kv_get(conn, ck) or {}
    import time as _t
    if cached.get("result") and (_t.time() - (cached.get("ts") or 0)) < 86400:
        return cached["result"]
    core = brand[len(city):] if (city and brand.startswith(city) and len(brand) > len(city)) else brand
    if len(core) < 3:   # 核心词太短（如"广场"）无法可靠判定
        return {"ambiguity": False}
    if not os.path.exists(ANYSEARCH):
        return {"ambiguity": False, "unknown": True}
    try:
        p = subprocess.run([sys.executable, ANYSEARCH, "search", brand],
                           capture_output=True, text=True, timeout=40)
    except Exception:
        return {"ambiguity": False, "unknown": True}
    titles = [t.strip() for t, u in re.findall(r"###\s*\d+\.\s*(.+?)\n\s*-\s*\*\*URL\*\*:\s*(\S+)", p.stdout or "")]
    others = [c for c in AMBIG_PLACES if c != city[:2] and c != city]
    samples = []
    for t in titles:
        if any(c in t for c in others) and core[:6] in t:
            samples.append(t[:60])
    result = {"ambiguity": len(samples) >= 2, "samples": samples[:3],
              "suggestion": (city + core) if city else "", "core": core}
    kv_put(conn, ck, {"ts": _t.time(), "result": result})
    return result


def _own_hit(url, owns):
    """V5：自有域名判定改 hostname 后缀匹配（host 等于 d 或以 .d 结尾），
    修复旧子串匹配偏宽（自有域名出现在第三方 URL 路径中会误判）与偏窄（缺 www 变体）两个方向的失真。"""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return any(host == d.lower() or host.endswith("." + d.lower()) for d in owns if d)

def run_probe(query, own_domains=None, group_domains=None):
    """真实外呼：调用本机 anysearch（失败时如实返回 error，不编造结果）。
    own_domains：该项目的自有域名列表（V4 参数化，未传时回退全局默认）；
    group_domains：集团信源（V6 R5——判定合并：可控阵地+集团信源都算"我们这边"）"""
    owns = [d.strip() for d in (own_domains or []) if d and d.strip()] or OWN_DOMAINS
    owns = list(dict.fromkeys(owns + [d.strip() for d in (group_domains or []) if d and d.strip()]))
    if not query or len(query) > 120:
        return {"error": "query 必须为 1–120 字"}
    if not os.path.exists(ANYSEARCH):
        return {"error": f"本机未找到 anysearch（{ANYSEARCH}），信源侧快检不可用"}
    try:
        p = subprocess.run([sys.executable, ANYSEARCH, "search", query],
                           capture_output=True, text=True, timeout=40)
    except subprocess.TimeoutExpired:
        return {"error": "搜索超时（40s），请稍后重试"}
    if p.returncode != 0:
        return {"error": f"anysearch 退出码 {p.returncode}: {p.stderr.strip()[:200]}"}
    out = p.stdout or ""
    results = [{"title": t.strip(), "url": u.strip(), "own": _own_hit(u.strip(), owns)}
               for t, u in re.findall(r"###\s*\d+\.\s*(.+?)\n\s*-\s*\*\*URL\*\*:\s*(\S+)", out)]
    if not results:
        fb = _probe_mmx(query, owns)          # V4 4.5：anysearch 空结果时回退 mmx（标注来源）
        if fb: return fb
    return {"query": query, "n": len(results), "results": results[:10],
            "own_hits": sum(1 for r in results[:10] if r["own"]), "source": "anysearch"}

def _probe_mmx(query, owns):
    """mmx 回退通道（anysearch 失败/空结果时）；不可用返回 None"""
    try:
        p = subprocess.run(["mmx", "search", query, "--quiet"], capture_output=True, text=True, timeout=40)
    except Exception:
        return None
    if p.returncode != 0 or not (p.stdout or "").strip():
        return None
    try:
        d = json.loads(p.stdout)
    except Exception:
        return None
    res = [{"title": str(r.get("title") or ""), "url": str(r.get("link") or ""),
            "own": _own_hit(str(r.get("link") or ""), owns)}
           for r in (d.get("organic") or []) if r.get("link")][:10]
    if not res:
        return None
    return {"query": query, "n": len(res), "results": res,
            "own_hits": sum(1 for r in res if r["own"]), "source": "mmx"}

# ══════ V0.1.7「AI代问」：豆包联网自动监测（火山方舟通道）════════
BOT_RUNS = {}            # runId → 运行态（内存态：完成即写库，重启丢失无碍，前端收到 404 提示重跑即可）
BOT_LOCK = threading.Lock()

def ark_cfg(conn):
    """豆包通道配置：密钥=环境变量 > 管理设置(kv bot:ark:key)；模型=管理设置(kv bot:ark:model) > 默认。
    密钥任何响应只回显 mask_key 尾4位，绝不完整下发。"""
    key = ARK_API_KEY or (kv_get(conn, "bot:ark:key") or "")
    model = (kv_get(conn, "bot:ark:model") or "") or ARK_MODEL
    return {"key": str(key).strip(), "model": str(model).strip()}

ARK_SYS = "你是面向企业选址者的AI助手。直接回答用户问题；答案中若参考了网站，在相关句子后以（来源：域名）标注。"

def ark_ask(conn, question, brand=""):
    """向豆包发一问（Responses API + 内置 web_search 工具，模型自主联网检索）。
    返回 (answer_text, 检索URL列表, 错误文案)，成功时错误文案为空串。
    GEO_MOCK_ARK=1（e2e）返回罐头答案，绝不外呼。"""
    if os.environ.get("GEO_MOCK_ARK"):
        return (f"（mock）关于这个问题：{brand or '该项目'}是区域内的代表性载体，相关信息可参考（来源：example.com）。", [], "")
    cfg = ark_cfg(conn)
    if not cfg["key"] or not cfg["model"]:
        return None, [], "豆包通道未配置：管理员在「监测 → AI 代问 · 通道设置」填入密钥与联网接入点 ID（ep-…）"
    payload = {"model": cfg["model"], "instructions": ARK_SYS,
               "input": [{"role": "user", "content": [{"type": "input_text", "text": question}]}],
               "tools": [{"type": "web_search"}], "store": False,
               "thinking": {"type": "disabled"}}   # 关思考：监测问答要快与省（实测同问 353→47 token）

    def _post(p):
        req = urllib.request.Request(ARK_URL, data=json.dumps(p).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["key"]})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    try:
        try:
            d = _post(payload)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode("utf-8", "ignore")).get("error", {}).get("message", "")
            except Exception:
                pass
            if e.code == 400 and "instructions" in str(detail).lower():   # 不认 instructions → 并入问题文本重试
                payload.pop("instructions", None)
                payload["input"] = [{"role": "user", "content": [
                    {"type": "input_text", "text": f"（回答要求：{ARK_SYS}）{question}"}]}]
                d = _post(payload)
            elif e.code == 400 and "think" in str(detail).lower():        # 模型不认 thinking 参数 → 去掉重试
                payload.pop("thinking", None)
                d = _post(payload)
            elif "not activated web search" in str(detail):
                return None, [], "账号未开通联网搜索插件——控制台开通后重试"
            else:
                return None, [], f"豆包通道 HTTP {e.code}：{str(detail)[:150] or '调用失败'}"
    except urllib.error.HTTPError as e:
        return None, [], f"豆包通道 HTTP {e.code}"
    except Exception as e:
        return None, [], f"豆包通道不可达：{type(e).__name__}"
    text, cites = [], []
    for item in d.get("output") or []:
        t = item.get("type")
        if t == "message":
            for c in item.get("content") or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    text.append(c["text"])
                    for a in (c.get("annotations") or []):
                        if a.get("url"):
                            cites.append(a["url"])
        elif t in ("function_web_search", "web_search_call"):
            act = item.get("action") or {}
            cites += [u for u in (act.get("urls") or []) if u]
    out = "\n".join(x for x in text if x).strip()
    if not out:
        return None, [], "豆包返回空答案"
    return out, cites[:8], ""

def answerbot_worker(db_path, rid, pid, prompts, brand, competitors, own_domains):
    """后台逐问执行：预算闸门→24h缓存→豆包→结构化→台账。写库前最后一刻重读文档，最小化与用户保存的竞态窗口。"""
    conn = db(db_path)
    st = BOT_RUNS[rid]
    try:
        ym = time.strftime("%Y-%m")
        ukey = f"bot:usage:{pid}:{ym}"
        cap = int(kv_get(conn, "bot:cap") or BOT_CAP_DEFAULT)
        usage = int(kv_get(conn, ukey) or 0)
        can_llm = llm_resolve(conn, {})[0] != "none" and not os.environ.get("GEO_MOCK_ARK")   # e2e mock 下不做 LLM 抽取（快且确定）
        today = time.strftime("%Y-%m-%d")
        # 今日已有人工记录的（豆包·问题）不再自动覆盖——人工是基准，自动是补充
        doc0 = kv_get(conn, proj_doc_key(pid)) or {"state": {}}
        manual_today = {(r.get("promptId")) for r in ((doc0.get("state") or {}).get("ledger") or [])
                        if r.get("date") == today and r.get("engine") == "豆包" and not r.get("src")}
        added, skipped = 0, 0
        for i, p in enumerate(prompts):
            st["done"], st["current"] = i, p["q"][:24]
            if p["id"] in manual_today:
                st["items"].append({"promptId": p["id"], "ok": False, "note": "今日已有人工记录，未覆盖（人工是基准）"})
                skipped += 1
                continue
            if usage >= cap:
                st["items"].append({"promptId": p["id"], "ok": False, "note": "已达本月自动调用上限（管理员可调 bot:cap），本问跳过"})
                skipped += 1
                continue
            # 24h 答案缓存：同问不重复外呼（换问法即新键）
            qkey = "bot:ans:" + pid + ":" + hashlib.md5((p["id"] + "|" + p["q"]).encode()).hexdigest()[:16]
            cached = kv_get(conn, qkey)
            if cached and (time.time() - (cached.get("ts") or 0)) < 86400 and cached.get("q") == p["q"]:
                text = cached.get("text") or ""
                web_urls = cached.get("urls") or []
            else:
                text, web_urls, err = ark_ask(conn, p["q"], brand)
                if text is None:
                    st["items"].append({"promptId": p["id"], "ok": False, "note": err})
                    continue
                kv_put(conn, qkey, {"ts": time.time(), "q": p["q"], "text": text, "urls": web_urls})
            usage += 1
            kv_put(conn, ukey, usage)
            # 结构化：有 LLM 沿用同一套 parse_answer 抽取；没有则退化为纯提及检测（如实标注，不冒充）
            ex = parse_answer(text, brand, competitors, {}, conn) if can_llm else None
            if ex and ex.get("error"):
                ex = None
            if ex:
                mention, senti = ex.get("mention"), ex.get("sentiment")
                cites = ex.get("citedDomains") or []
                cooccur = ex.get("competitorMentions") or []
                how = "LLM抽取"
            else:
                mention = 1 if (brand and brand in text) else 0
                senti, cites, cooccur = 0.5, [], []
                how = "自动判定（未接大模型，仅查提及）"
            url = ""
            for u in web_urls + ["https://" + c for c in cites]:   # 引擎真实检索URL优先，LLM抽取域名兜底
                if _own_hit(u, own_domains):
                    url = u
                    break
            st["_rows"] = st.get("_rows", []) + [{
                "date": today, "engine": "豆包", "promptId": p["id"],
                "mention": mention if mention is not None else 0, "sentiment": senti or 0.5,
                "url": url, "cooccur": [str(c)[:40] for c in cooccur][:6],
                "note": f"AI代问·联网检索（{how}）", "src": "api", "raw": text[:400]}]
            st["items"].append({"promptId": p["id"], "ok": True, "mention": mention,
                                "cite": "、".join(cites[:3])})
            added += 1
            time.sleep(2)   # 串行节流，防引擎风控
        if added:
            cur = kv_get(conn, proj_doc_key(pid)) or {"rev": 0, "state": {}}
            state = dict(cur.get("state") or {})
            ledger = list(state.get("ledger") or [])
            for row in st.get("_rows") or []:
                # 同日同问的旧 AI 行替换（重跑不重复计）；人工行永远不动
                ledger = [r for r in ledger if not (r.get("src") == "api" and r.get("date") == row["date"]
                                                    and r.get("engine") == row["engine"] and r.get("promptId") == row["promptId"])]
                ledger.append(row)
            state["ledger"] = ledger
            kv_put(conn, proj_doc_key(pid), {"rev": cur.get("rev", 0) + 1, "state": state})
        st["status"], st["finished"] = "done", time.strftime("%H:%M:%S")
        audit_append(conn, "aibot", pid, "AI代问", f"完成 {added}/{len(prompts)}（跳过{skipped}）")
        log = kv_get(conn, "bot:log") or []
        log.append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "pid": pid, "ok": added,
                    "fail": len(prompts) - added - skipped, "skip": skipped})
        kv_put(conn, "bot:log", log[-50:])
    except Exception as e:
        st["status"], st["error"] = "error", str(e)[:200]
    finally:
        conn.close()

def kv_migrate(conn):
    """旧版整包state → 新版 {rev,state} 文档（一次性迁移）"""
    if kv_get(conn, "doc") is None:
        old = kv_get(conn, "state")
        kv_put(conn, "doc", {"rev": 1, "state": old or {}})

class Handler(BaseHTTPRequestHandler):
    server_version = "GeoDesk/" + APP_VERSION
    conn = None  # 由 main 注入

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if not ctype.startswith("application/json"):
            self.send_header("Cache-Control", "no-cache")   # 静态资源不缓存，改版刷新即生效
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_GET(self):
        path = urlparse(self.path).path
        qs = dict(p.split("=", 1) for p in urlparse(self.path).query.split("&") if "=" in p)
        if path == "/api/ping":
            return self._send(200, {"ok": True, "server": "geodesk", "version": APP_VERSION})
        if path == "/api/onboarding":
            """V6.1 首登引导（账号级一次性）：kv user:onboard:<用户> 存在即看过。
               与 localStorage 方案的区别：换设备/清缓存不重复弹；按登录账号隔离。
               V6.1.1 record 携带引导漏斗（exit=出口方式/step=退出步/maxStep=到达最深步），上线后可量化完成率。"""
            u = geo_user(self.headers)
            rec = kv_get(self.conn, "user:onboard:" + u)
            return self._send(200, {"user": u, "show": rec is None, "record": rec})
        if path == "/api/llm/status":
            src, model, cfg = llm_resolve(self.conn, self.headers)
            return self._send(200, {"backend": "remote" if src in ("user", "server") else src,
                                    "source": src, "model": model})
        if path == "/api/llm/settings":
            src, model, _ = llm_resolve(self.conn, self.headers)
            saved = llm_user_config(self.conn, geo_user(self.headers))
            user_out = None
            if saved:
                user_out = {"provider": saved["provider"], "baseUrl": saved["baseUrl"],
                            "model": saved["model"], "keyTail": mask_key(saved["apiKey"]),
                            "updatedAt": saved.get("updatedAt", "")}
            return self._send(200, {"active": {"source": src, "model": model}, "user": user_out})
        if path == "/api/projects":
            plist = projects_ensure(self.conn)
            # V4.6 归档项目也返回（带 archived 标记），前端项目库按「含已归档」开关过滤展示/恢复
            out = [dict(p, summary=proj_summary(self.conn, p)) for p in plist]
            return self._send(200, {"projects": out})
        if path == "/api/audit":
            return self._send(200, {"audit": (kv_get(self.conn, "audit") or [])[-100:]})
        if path == "/api/backup":
            fname = backup_now(self.conn)
            ok = not str(fname).startswith("备份失败")
            return self._send(200 if ok else 500, {"ok": ok, "file": fname})
        if path == "/api/answerbot/status":
            """V0.1.7 AI代问进度轮询"""
            st = BOT_RUNS.get(qs.get("runId") or "")
            if not st:
                return self._send(404, {"error": "runId 不存在（服务可能已重启），请重新发起"})
            return self._send(200, {k: st.get(k) for k in ("runId", "pid", "status", "done", "total", "items", "current", "error")})
        if path == "/api/answerbot/config":
            """V0.1.7 通道配置查看（密钥只回显尾4位）"""
            c = ark_cfg(self.conn)
            return self._send(200, {"configured": bool(c["key"]), "model": c["model"],
                                    "keyTail": mask_key(c["key"]) if c["key"] else "—"})
        if path == "/api/data":
            kv_migrate(self.conn)
            plist = projects_ensure(self.conn)
            pid = qs.get("project") or (plist[0]["id"] if plist else None)
            doc = kv_get(self.conn, proj_doc_key(pid)) or {"rev": 0, "state": {}}
            out = dict(doc.get("state") or {})
            out["_rev"] = doc.get("rev", 0)
            out["_project"] = pid
            return self._send(200, out)
        if path == "/":
            path = "/index.html"
        f = os.path.normpath(os.path.join(BASE, path.lstrip("/")))
        if not f.startswith(BASE) or not os.path.isfile(f):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(f)[1].lower()
        if ext not in STATIC_TYPES:
            return self._send(403, {"error": "forbidden type"})
        with open(f, "rb") as fh:
            return self._send(200, fh.read(), STATIC_TYPES[ext])

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return None
        return json.loads(self.rfile.read(n) or b"{}")

    def do_PUT(self):
        if urlparse(self.path).path != "/api/data":
            return self._send(404, {"error": "not found"})
        try:
            data = self._body()
            kv_migrate(self.conn)
            plist = projects_ensure(self.conn)
            default = plist[0]["id"] if plist else None
            if isinstance(data, dict) and "state" in data and "base_rev" in data:
                # 新协议：项目级乐观锁。base_rev 过期 → 409 + 服务器最新数据（客户端负责字段级合并）
                pid = data.get("project") or default
                if not any(p["id"] == pid for p in plist):
                    return self._send(404, {"error": f"project 不存在: {pid}"})
                cur = kv_get(self.conn, proj_doc_key(pid)) or {"rev": 0, "state": {}}
                if data["base_rev"] != cur.get("rev"):
                    return self._send(409, {"error": "conflict", "rev": cur.get("rev"),
                                            "state": cur.get("state", {}), "project": pid})
                newdoc = {"rev": cur.get("rev", 0) + 1, "state": data["state"]}
            else:
                # 旧协议（脚本/兼容）：整包强制覆盖，落到默认项目
                pid = default
                cur = kv_get(self.conn, proj_doc_key(pid)) or {"rev": 0, "state": {}}
                newdoc = {"rev": cur.get("rev", 0) + 1, "state": data if isinstance(data, dict) else {}}
            kv_put(self.conn, proj_doc_key(pid), newdoc)
            # V0.1.13 F7：留痕分级——批任务（如跑一轮30问）逐问保存可静默，收尾写一条聚合记录，
            # 不再把留痕表刷满 30 条「保存数据」把关键里程碑顶出最近100条
            if isinstance(data, dict) and data.get("auditSilent"):
                pass
            else:
                action = (data.get("auditAction") if isinstance(data, dict) else None) or "保存数据"
                detail = (data.get("auditDetail") if isinstance(data, dict) else None) or f"rev={newdoc['rev']} ledger={len(newdoc['state'].get('ledger') or [])}条"
                audit_append(self.conn, data.get("operator") if isinstance(data, dict) else None, pid, action, detail)
            return self._send(200, {"ok": True, "rev": newdoc["rev"], "project": pid})
        except Exception as e:
            return self._send(400, {"error": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/onboarding/seen":
            """V6.1：标记当前账号已看过首登引导（幂等；跳过或看完都写）。
               V6.1.1：body 可带引导漏斗 {exit: skip/esc/cta/done/finish, step, maxStep}。"""
            u = geo_user(self.headers)
            try:
                body = self._body() or {}
            except Exception:
                body = {}
            rec = {"seenAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "exit": str(body.get("exit") or "unknown")[:12],
                   "step": int(body.get("step") or 0),
                   "maxStep": int(body.get("maxStep") or 0)}
            kv_put(self.conn, "user:onboard:" + u, rec)
            return self._send(200, {"ok": True, "user": u})
        if path == "/api/projects":
            try:
                body = self._body() or {}
                plist = projects_ensure(self.conn)
                pid = str(body.get("id") or "").strip() or ("p_" + uuid.uuid4().hex[:10])
                if any(p["id"] == pid for p in plist):
                    return self._send(409, {"error": f"项目 id 已存在: {pid}"})
                proj = {"id": pid,
                        "name": str(body.get("name") or "未命名项目").strip()[:60],
                        "url": str(body.get("url") or "").strip()[:120],
                        "brand": str(body.get("brand") or "").strip()[:60],
                        "operator": str(body.get("operator") or "").strip()[:60],
                        "entityMode": str(body.get("entityMode") or "").strip()[:10] or ("none" if not str(body.get("url") or "").strip() else "parent"),
                        "city": str(body.get("city") or "").strip()[:40],
                        "industries": [str(i).strip()[:30] for i in (body.get("industries") or []) if str(i).strip()][:5],
                        "competitors": [str(c).strip()[:40] for c in (body.get("competitors") or []) if str(c).strip()][:5],
                        "matrixTier": "lite" if str(body.get("matrixTier") or "").strip() == "lite" else "park",
                        "groupDomains": [str(d).strip()[:80] for d in (body.get("groupDomains") or []) if str(d).strip()][:10],
                        "ownDomains": [str(d).strip()[:80] for d in (body.get("ownDomains") or []) if str(d).strip()][:20],
                        "createdAt": time.strftime("%Y-%m-%d"), "archived": False}
                kv_put(self.conn, "projects", plist + [proj])
                kv_put(self.conn, proj_doc_key(pid), {"rev": 0, "state": {}})
                audit_append(self.conn, body.get("operator"), pid, "POST /api/projects", f"新建项目「{proj['name']}」")
                return self._send(200, {"ok": True, "id": pid})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/projects/update":
            """V4.2：更新项目元数据（名称/品牌词/运营主体/自有域名）——元数据单一真相落地：
               前端启动时把本机可读元数据回写服务器，修复历史「域名当项目名」遗留。"""
            try:
                body = self._body() or {}
                pid = str(body.get("id") or "")
                plist = projects_ensure(self.conn)
                p = next((x for x in plist if x["id"] == pid), None)
                if not p:
                    return self._send(404, {"error": f"project 不存在: {pid}"})
                if "name" in body: p["name"] = str(body.get("name") or p["name"]).strip()[:60] or p["name"]
                if "url" in body: p["url"] = str(body.get("url") or "").strip()[:120]
                if "brand" in body: p["brand"] = str(body.get("brand") or "").strip()[:60]
                if "operator" in body: p["operator"] = str(body.get("operator") or "").strip()[:60]
                if "entityMode" in body: p["entityMode"] = str(body.get("entityMode") or "").strip()[:10]
                if "city" in body: p["city"] = str(body.get("city") or "").strip()[:40]
                if "industries" in body:
                    p["industries"] = [str(i).strip()[:30] for i in (body.get("industries") or []) if str(i).strip()][:5]
                if "competitors" in body:
                    p["competitors"] = [str(c).strip()[:40] for c in (body.get("competitors") or []) if str(c).strip()][:5]
                if "matrixTier" in body:
                    p["matrixTier"] = "lite" if str(body.get("matrixTier") or "").strip() == "lite" else "park"
                if "groupDomains" in body:
                    p["groupDomains"] = [str(d).strip()[:80] for d in (body.get("groupDomains") or []) if str(d).strip()][:10]
                if "ownDomains" in body:
                    p["ownDomains"] = [str(d).strip()[:80] for d in (body.get("ownDomains") or []) if str(d).strip()][:20]
                kv_put(self.conn, "projects", plist)
                audit_append(self.conn, body.get("operator"), pid, "POST /api/projects/update",
                             f"更新项目元数据「{p['name']}」")
                return self._send(200, {"ok": True, "id": pid})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/restore":
            """V4 2.5：从备份 JSON 恢复（覆盖全部项目数据，需 confirm:true 二次确认）"""
            try:
                body = self._body() or {}
                if body.get("confirm") is not True:
                    return self._send(400, {"error": "缺少 confirm:true（恢复将覆盖服务器全部项目数据，必须显式二次确认）"})
                payload = body.get("payload") or {}
                plist, docs = payload.get("projects"), payload.get("docs")
                if not isinstance(plist, list) or not plist or not isinstance(docs, dict):
                    return self._send(400, {"error": "备份格式不符：需要非空 projects 数组与 docs 映射（来自 backups/geodesk-*.json）"})
                kv_put(self.conn, "projects", plist)
                for pid, doc in docs.items():
                    if not isinstance(pid, str) or not pid:
                        return self._send(400, {"error": f"非法项目 id: {pid!r}"})
                    kv_put(self.conn, proj_doc_key(pid), doc or {"rev": 0, "state": {}})
                if isinstance(payload.get("audit"), list):
                    kv_put(self.conn, "audit", payload["audit"])
                audit_append(self.conn, body.get("operator"), None, "POST /api/restore",
                             f"从备份恢复 {len(plist)} 个项目（覆盖写入）")
                return self._send(200, {"ok": True, "projects": len(plist)})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/projects/archive":
            """V4 4.1：项目归档/恢复（归档后不出现在列表，数据保留可恢复）"""
            try:
                body = self._body() or {}
                pid = str(body.get("id") or "")
                plist = projects_ensure(self.conn)
                p = next((x for x in plist if x["id"] == pid), None)
                if not p:
                    return self._send(404, {"error": f"project 不存在: {pid}"})
                p["archived"] = bool(body.get("archived", True))
                kv_put(self.conn, "projects", plist)
                audit_append(self.conn, body.get("operator"), pid, "POST /api/projects/archive",
                             f"{'归档' if p['archived'] else '恢复'}项目「{p['name']}」")
                return self._send(200, {"ok": True, "id": pid, "archived": p["archived"]})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/probe":
            try:
                body = self._body() or {}
                return self._send(200, run_probe(str(body.get("query", "")), body.get("ownDomains"), body.get("groupDomains")))
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/diagnose":
            try:
                body = self._body() or {}
                mode = "entity" if str(body.get("mode", "")) == "entity" else "site"
                return self._send(200, diagnose(str(body.get("url", "")), str(body.get("brand", "")), body.get("ownDomains"), mode, body.get("groupDomains")))
            except Exception as e:
                return self._send(500, {"error": str(e)})
        if path == "/api/brandcheck":
            """V6 1.3：品牌词歧义检测（阳性信号，24h 缓存）"""
            try:
                body = self._body() or {}
                return self._send(200, brand_check(self.conn, str(body.get("brand") or ""), str(body.get("city") or "")))
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/parse":
            """V4 3.4：贴答案自动填（结构化抽取，人确认后才入库）"""
            try:
                body = self._body() or {}
                return self._send(200, parse_answer(body.get("text"), body.get("brand"), body.get("competitors"), self.headers, self.conn))
            except Exception as e:
                return self._send(500, {"error": str(e)})
        if path == "/api/llm/settings":
            return self._llm_settings_save()
        if path == "/api/llm/settings/clear":
            u = geo_user(self.headers)
            kv_put(self.conn, "llm:user:" + u, {})
            audit_append(self.conn, u, None, "LLM配置", "清除个人模型配置")
            return self._send(200, {"ok": True})
        if path == "/api/llm/test":
            return self._llm_test()
        if path == "/api/answerbot/start":
            """V0.1.7 AI代问：后台线程逐问调用豆包（联网），结构化后写台账；进度走 /status 轮询。
            prompts 由前端按当前项目问题矩阵下发（[{id,q}]，≤20条）；同项目同时只允许一个运行。"""
            try:
                body = self._body() or {}
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            plist = projects_ensure(self.conn)
            pid = str(body.get("project") or "") or (plist[0]["id"] if plist else "")
            if not any(p["id"] == pid for p in plist):
                return self._send(404, {"error": f"project 不存在: {pid}"})
            if not ark_cfg(self.conn)["key"] or not ark_cfg(self.conn)["model"]:
                return self._send(400, {"error": "豆包通道未配置——先在「AI 代问 · 通道设置」里保存密钥与联网接入点 ID（ep-…）"})
            prompts = []
            for x in (body.get("prompts") or [])[:20]:
                q = str(x.get("q") or "").strip()[:200]
                i = str(x.get("id") or "").strip()[:10]
                if q and i:
                    prompts.append({"id": i, "q": q})
            if not prompts:
                return self._send(400, {"error": "prompts 为空（每项需含 id 与 q）"})
            with BOT_LOCK:
                for r in BOT_RUNS.values():
                    if r.get("pid") == pid and r.get("status") == "running":
                        return self._send(409, {"error": "该项目已有 AI 代问在运行", "runId": r["runId"]})
                rid = uuid.uuid4().hex[:12]
                BOT_RUNS[rid] = {"runId": rid, "pid": pid, "status": "running", "done": 0,
                                 "total": len(prompts), "items": [], "current": "",
                                 "started": time.strftime("%H:%M:%S")}
            threading.Thread(target=answerbot_worker,
                             args=(DB_PATH, rid, pid, prompts,
                                   str(body.get("brand") or "")[:60],
                                   [str(c)[:40] for c in (body.get("competitors") or [])][:8],
                                   [str(d)[:80] for d in (body.get("ownDomains") or [])][:20]),
                             daemon=True).start()
            audit_append(self.conn, geo_user(self.headers), pid, "AI代问", f"启动 {len(prompts)} 问")
            return self._send(200, {"runId": rid, "total": len(prompts)})
        if path == "/api/answerbot/config":
            """V0.1.7 通道配置保存：密钥只存服务器 SQLite，响应只回显尾4位；留空=沿用已存密钥"""
            try:
                b = self._body() or {}
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            key = str(b.get("apiKey") or "").strip()[:200]
            model = str(b.get("model") or "").strip()[:100]
            if key:
                kv_put(self.conn, "bot:ark:key", key)
            if model:
                kv_put(self.conn, "bot:ark:model", model)
            audit_append(self.conn, geo_user(self.headers), None, "AI代问配置",
                         f"模型={model or '未改'} 密钥={'更新' if key else '未改'}")
            c = ark_cfg(self.conn)
            return self._send(200, {"configured": bool(c["key"]), "model": c["model"],
                                    "keyTail": mask_key(c["key"]) if c["key"] else "—"})
        if path == "/api/chat":
            return self._chat()
        return self._send(404, {"error": "not found"})

    def _llm_settings_save(self):
        """保存当前账号的个人 LLM 配置。密钥仅存服务器 SQLite，任何响应只回显尾 4 位"""
        try:
            b = self._body() or {}
        except Exception:
            return self._send(400, {"error": "请求体不是合法 JSON"})
        provider = str(b.get("provider") or "custom").strip()[:30]
        base = str(b.get("baseUrl") or "").strip()[:300]
        model = str(b.get("model") or "").strip()[:100]
        key = str(b.get("apiKey") or "").strip()[:200]
        is_local = provider == "ollama"
        if not key and not is_local:
            # 远端服务商留空 = 沿用已保存密钥（界面从不回显完整密钥，改地址/模型不必重贴 key）
            old = llm_user_config(self.conn, geo_user(self.headers))
            if old and old["baseUrl"] == base:
                key = old["apiKey"]
        err = llm_url_guard(base, allow_loopback_http=is_local)
        if err:
            return self._send(400, {"error": "API 地址不合规：" + err})
        if not (1 <= len(model) <= 100):
            return self._send(400, {"error": "请填写模型名称（以服务商控制台为准）"})
        if is_local:
            if any(c in key for c in " \t\r\n"):
                return self._send(400, {"error": "Ollama 通常无需密钥；若填则不含空白"})
        elif not (8 <= len(key) <= 200) or any(c in key for c in " \t\r\n"):
            return self._send(400, {"error": "API 密钥长度需 8–200 位且不含空白字符（Ollama 无需密钥）"})
        u = geo_user(self.headers)
        kv_put(self.conn, "llm:user:" + u,
               {"provider": provider, "baseUrl": base, "model": model, "apiKey": key,
                "updatedAt": time.strftime("%Y-%m-%d %H:%M")})
        audit_append(self.conn, u, None, "LLM配置", f"设置 {provider}/{model}（密钥不记录）")
        return self._send(200, {"ok": True, "keyTail": mask_key(key)})

    def _llm_test(self):
        """连接测试：优先测请求体里的临时配置（先测后存），否则测当前生效配置。绝不回显密钥"""
        try:
            b = self._body() or {}
        except Exception:
            b = {}
        src, _, saved_cfg = llm_resolve(self.conn, self.headers)
        if b.get("apiKey") or b.get("provider") == "ollama":
            err = llm_url_guard(b.get("baseUrl"), allow_loopback_http=(b.get("provider") == "ollama"))
            if err:
                return self._send(200, {"ok": False, "error": "API 地址不合规：" + err})
            cfg = {"baseUrl": str(b["baseUrl"]).strip(), "model": str(b.get("model") or "").strip(),
                   "apiKey": str(b["apiKey"]).strip()}
            if not cfg["model"]:
                return self._send(200, {"ok": False, "error": "请先填写模型名称"})
            which = "临时配置"
        elif saved_cfg:
            cfg = saved_cfg
            which = {"user": "我的配置", "server": "系统配置"}.get(src, src)
        else:
            return self._send(200, {"ok": False, "error": "没有可测试的配置（当前后端为本机 Ollama 或未配置）"})
        t0 = time.time()
        try:
            with llm_remote_open(cfg, [{"role": "user", "content": "只回复两个字：成功"}],
                                 stream=False, timeout=20, max_tokens=16) as r:
                data = json.loads(r.read() or b"{}")
            reply = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            return self._send(200, {"ok": True, "which": which, "model": cfg["model"],
                                    "latency_ms": int((time.time() - t0) * 1000),
                                    "reply": str(reply)[:40]})
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = (e.read() or b"")[:200].decode("utf-8", "ignore")
            except Exception:
                pass
            # 常见错码翻译；detail 可能含提供商返回的说明（无密钥），截断即出
            hint = {401: "密钥无效或未授权", 403: "无权限（可能被风控或欠费）", 404: "地址或模型名不对",
                    429: "请求太频繁（限流）"}.get(e.code, f"HTTP {e.code}")
            return self._send(200, {"ok": False, "error": f"{hint}。{detail[:120]}"})
        except Exception as e:
            return self._send(200, {"ok": False, "error": "连接失败：" + str(e)[:120]})

    def _chat(self):
        """对话助手：本账号配置 > 服务器 DeepSeek > 本机 Ollama；流式返回纯文本"""
        src, model_name, cfg = llm_resolve(self.conn, self.headers)
        if src == "none":
            return self._send(503, {"error": "暂无可用的大模型后端。点对话窗口右上角 ⚙ 配置你自己的模型，或联系管理员设置系统级 DeepSeek。"})
        try:
            body = self._body() or {}
            msgs = [{"role": "system", "content": CHAT_SYSTEM + "\n【用户当前系统状态（实时）】" + state_summary(self.conn, body.get("project"))}]
            msgs += [m for m in (body.get("messages") or []) if m.get("role") in ("user", "assistant") and m.get("content")][-12:]
            if not any(m["role"] == "user" for m in msgs[1:]):
                return self._send(400, {"error": "messages 需要至少一条 user 消息"})

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Model", model_name)
            self.send_header("X-Accel-Buffering", "no")        # V4.3.3：明确告诉 nginx 禁缓冲
            # 不写 Transfer-Encoding——Python BaseHTTPRequestHandler 不允许写；nginx 配置了
            # chunked_transfer_encoding on 后会自己加上 chunked
            # 不写 Content-Length——让 nginx 用 chunked 而非定长
            self.end_headers()

            def stream_remote(max_tokens):
                """V0.1.12 空泡根治（AI评测P1）：DeepSeek V4 的 reasoning_content 与 content 共享
                   max_tokens 预算——思考一长即把预算顶满、正文 0 字，用户端表现为空回答/永久思考中。
                   返回累计正文字数，供外层在 0 字时自动加预算重试一次。"""
                total = 0
                with llm_remote_open(cfg, msgs, stream=True, timeout=180, max_tokens=max_tokens) as up:
                    for raw in up:
                        try:
                            line = raw.decode("utf-8", "ignore").strip()
                            if not line or line.startswith(":"): continue
                            if line.startswith("data:"): line = line[5:].strip()
                            if line == "[DONE]": break
                            chunk = json.loads(line)
                        except Exception:
                            continue
                        if chunk.get("error"):
                            err = chunk["error"]
                            if isinstance(err, dict): err = err.get("message") or json.dumps(err, ensure_ascii=False)
                            self.wfile.write(f"data: 【模型错误】{err}\n\n".encode("utf-8")); self.wfile.flush()
                            continue
                        text = ""
                        think = ""
                        if "choices" in chunk:                       # DeepSeek/OpenAI 格式
                            delta = chunk["choices"][0].get("delta") or {}
                            # V4.3.4 关键修复：DeepSeek V4 把「思考过程」放在 reasoning_content、
                            # 「最终回答」放在 content，两者独立流式返回，必须分开读。
                            content = delta.get("content") or ""
                            reasoning = delta.get("reasoning_content") or ""
                            # 用特殊事件前缀让前端识别思考过程（折叠/淡化展示）
                            if reasoning: think += reasoning
                            if content:  text += content
                        elif "message" in chunk:                      # Ollama 兼容格式
                            text = (chunk.get("message") or {}).get("content", "")
                        if think:
                            self.wfile.write(f"event: think\ndata: {think}\n\n".encode("utf-8")); self.wfile.flush()
                        if text:
                            total += len(text)
                            self.wfile.write(f"data: {text}\n\n".encode("utf-8")); self.wfile.flush()
                return total

            if src in ("user", "server"):
                total = stream_remote(2048)   # 预算翻倍：容纳思考+正文（原 1024 会被思考顶满）
                if total == 0:
                    total = stream_remote(4096)   # 正文 0 字：更高预算自动重试一次
                if total == 0:
                    self.wfile.write("data: 【这条没答出来】模型思考超长占满了输出预算，正文为空——请再问一次或换个问法。\n\n".encode("utf-8")); self.wfile.flush()
            else:
                payload = {"model": model_name, "messages": msgs, "stream": True,
                           "options": {"temperature": 0.4, "num_predict": 450},
                           "keep_alive": "30m"}      # V4.3.3：删掉 Ollama 0.x 不支持的 "think" 字段
                req = urllib.request.Request(OLLAMA + "/api/chat", data=json.dumps(payload).encode(),
                                             headers={"Content-Type": "application/json"})
                up = urllib.request.urlopen(req, timeout=180)
                with up as up:
                    for raw in up:
                        try:
                            line = raw.decode("utf-8", "ignore").strip()
                            if not line or line.startswith(":"): continue
                            if line.startswith("data:"): line = line[5:].strip()
                            if line == "[DONE]": break
                            chunk = json.loads(line)
                        except Exception:
                            continue
                        if chunk.get("error"):
                            err = chunk["error"]
                            if isinstance(err, dict): err = err.get("message") or json.dumps(err, ensure_ascii=False)
                            self.wfile.write(f"data: 【模型错误】{err}\n\n".encode("utf-8")); self.wfile.flush()
                            continue
                        text = ""
                        think = ""
                        if "choices" in chunk:
                            delta = chunk["choices"][0].get("delta") or {}
                            content = delta.get("content") or ""
                            reasoning = delta.get("reasoning_content") or ""
                            if reasoning: think += reasoning
                            if content:  text += content
                        elif "message" in chunk:
                            text = (chunk.get("message") or {}).get("content", "")
                        if think:
                            self.wfile.write(f"event: think\ndata: {think}\n\n".encode("utf-8")); self.wfile.flush()
                        if text:
                            self.wfile.write(f"data: {text}\n\n".encode("utf-8")); self.wfile.flush()
                # V4.3.3：明确 [DONE] 终止符 + 收尾 flush，前端 reader 才能正常 done
                try:
                    self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
                except Exception:
                    pass
        except urllib.error.URLError as e:
            try: self.wfile.write(f"data: 【连接模型失败】{e}\n\n".encode("utf-8"))
            except Exception: pass
            try: self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
            except Exception: pass
        except Exception as e:
            try: self.wfile.write(f"data: 【服务错误】{e}\n\n".encode("utf-8"))
            except Exception: pass
            try: self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
            except Exception: pass

def warmup_model():
    """启动即预载对话模型，避免用户首次提问等15秒冷启动（静默失败）"""
    try:
        model = pick_chat_model()
        if not model: return
        payload = {"model": model, "messages": [{"role": "user", "content": "hi"}],
                   "stream": False, "think": False, "keep_alive": "30m",
                   "options": {"num_predict": 1}}
        req = urllib.request.Request(OLLAMA + "/api/chat", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read(64)
    except Exception:
        pass

def backup_loop(conn):
    """每日备份：启动即备一次，此后每 24 小时一次（daemon 线程，静默失败）"""
    while True:
        try:
            fname = backup_now(conn)
            if not str(fname).startswith("备份失败"):
                sys.stderr.write(f"[backup] {fname}\n")
        except Exception:
            pass
        time.sleep(24 * 3600)

def main():
    global DB_PATH
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8340)
    ap.add_argument("--db", default=os.path.join(BASE, "geodesk.db"))
    ap.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args()
    DB_PATH = a.db
    Handler.conn = db(a.db)
    projects_ensure(Handler.conn)          # 启动即完成旧数据→项目层迁移（幂等）
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    threading.Thread(target=warmup_model, daemon=True).start()   # 预热对话模型
    threading.Thread(target=backup_loop, args=(Handler.conn,), daemon=True).start()  # 每日备份
    print(f"GEO智控台后台已启动: http://localhost:{a.port}  (DB: {a.db})")
    print("团队用法：同事浏览器打开本机IP:8340 即共享同一份数据（字段级自动合并）；单机亦可直接双击 index.html。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")

if __name__ == "__main__":
    main()
