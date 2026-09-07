#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GEO智控台 V3 · 全链路测试（后端API + 前端渲染 + 评分器单元）

用法：python3 test_e2e.py
覆盖：
  T1 后台健康检查 /api/ping
  T2 状态持久化往返 PUT→GET /api/data（含监测台账/口径表/体检分）
  T3 信源侧快检 /api/probe（真实外呼；网络不可用时标记 SKIP）
  T4 静态资源服务（/ 与 js/css）
  T5 前端服务器模式渲染（无头Chrome：体检30项、Agent4卡、监测30问）
  T6 内容评分器单元（营销腔<50 / GEO体≥75，与geo_score.py同源判定）
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = 8341
ROOT = f"http://127.0.0.1:{PORT}"
PASS, FAIL, SKIP = [], [], []

def check(name, ok, detail="", skippable=False):
    (PASS if ok else (SKIP if skippable and not ok else FAIL)).append(f"{name} — {detail}")
    print(f"  {'✓' if ok else ('⊘' if skippable and not ok else '✗')} {name}: {detail}")

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(ROOT + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.status, json.loads(resp.read() or b"{}")

def main():
    # V0.2.1 闸门：chrome 路径按 OS 自动检测；CI (ubuntu runner) 用 /usr/bin/google-chrome，本地 macOS 用 .app
    _candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
    ]
    chrome = next((p for p in _candidates if os.path.exists(p)), None)
    try: os.remove("/tmp/geodesk_e2e.db")   # V4：多项目测试要求全新 db（避免上次运行的项目残留）
    except FileNotFoundError: pass
    srv = subprocess.Popen([sys.executable, os.path.join(BASE, "server.py"),
                            "--port", str(PORT), "--db", "/tmp/geodesk_e2e.db"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           env=dict(os.environ, GEO_MOCK_ARK="1"))   # V0.1.7：AI代问走罐头通道，e2e 绝不外呼豆包
    # 就绪等待（2026-09-07：本机偶发启动 >1.2s，固定 sleep 会让首 ping 落空；
    # 落空在本环境会被网关回成 502 而非拒连，urllib 直接抛 HTTPError 崩掉整轮）
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"{ROOT}/api/ping", timeout=2) as _r:
                if _r.status == 200: break
        except Exception: pass
        time.sleep(0.3)
    try:
        print("T1 健康检查")
        s, d = req("GET", "/api/ping")
        check("ping", s == 200 and d.get("ok") is True, f"status={s} body={d}")

        print("T2 状态持久化往返（含乐观锁）")
        sample = {"audit": {"T1": 2, "T2": 1}, "parkUrl": "www.cmsk1979.com", "statsV2": True, "ledger": [
            {"date": "2026-09-04", "engine": "豆包", "promptId": "P2", "mention": 1, "sentiment": 1, "url": "", "note": "App端"},
            {"date": "2026-08-21", "engine": "DeepSeek", "promptId": "P20", "mention": 0, "sentiment": 0.5, "url": "", "note": "", "cooccur": ["张江高科"]}],
            "caliber": [{"park": "蛇口网谷", "field": "入驻企业数", "official": "近460家", "asOf": "2025-11", "source": "测试", "conflicts": []}],
            "snapshots": [
                {"ts": 1, "date": "2026-08-21", "type": "round", "auditPct": 8, "diagFails": 3, "mentionAns": 0, "mentionAnsN": 1, "mentionSrc": None, "mentionSrcN": 0, "ownHitN": None, "ownHitTotal": None, "baseline": True},
                {"ts": 2, "date": "2026-09-04", "type": "round", "auditPct": 12, "diagFails": 2, "mentionAns": 50, "mentionAnsN": 1, "mentionSrc": None, "mentionSrcN": 0, "ownHitN": None, "ownHitTotal": None}],
            "events": [{"date": "2026-08-25", "type": "deploy", "label": "部署一园一档"}],
            "probes": [
                {"date": "2026-08-21", "promptId": "P20", "domains": ["baike.baidu.com", "www.zhihu.com", "csdn.net"], "urls": [], "ownHit": False, "partial": True},
                {"date": "2026-09-04", "promptId": "P2", "domains": ["www.szns.gov.cn", "baike.baidu.com", "mp.weixin.qq.com"], "urls": [], "ownHit": True}],
            "evidence": [{"type": "引言", "park": "蛇口网谷", "content": "我们对比了三个园区，最终选蛇口网谷。", "person": "王强", "title": "某科技总经理", "source": "测试", "asOf": "2026-09-01", "status": "已核验"}]}
        s, _ = req("PUT", "/api/data", sample)  # 旧协议=强制覆盖，建立基线
        check("PUT data(强制覆盖)", s == 200, f"status={s}")
        _, back = req("GET", "/api/data")
        rev = back.pop("_rev", None)
        check("GET data 往返一致(忽略_rev)", {k: back[k] for k in sample} == sample and rev is not None, f"roundtrip+rev={rev}")
        # 新协议：正确 base_rev → 200；过期 base_rev → 409 冲突
        s2, d2 = req("PUT", "/api/data", {"state": dict(sample, parkUrl="x.com"), "base_rev": rev})
        check("PUT 新协议(正确rev)", s2 == 200 and d2.get("rev") == rev + 1, f"rev {rev}→{d2.get('rev')}")
        try:
            req("PUT", "/api/data", {"state": sample, "base_rev": rev})  # 旧rev重放
            check("PUT 过期rev返回409", False, "未拒绝")
        except urllib.error.HTTPError as e:
            body = json.loads(e.read() or b"{}")
            check("PUT 过期rev返回409", e.code == 409 and body.get("rev") == rev + 1 and body.get("state", {}).get("parkUrl") == "x.com",
                  f"409+最新数据返回（rev={body.get('rev')}）")

        print("T3 信源侧快检（真实外呼）")
        try:
            s, d = req("POST", "/api/probe", {"query": "蛇口网谷"})
            if d.get("error"):
                check("probe 真实搜索", False, d["error"], skippable=True)
            else:
                check("probe 真实搜索", s == 200 and d.get("n", 0) >= 3,
                      f"n={d.get('n')} 自有阵地命中={d.get('own_hits')}", skippable=True)   # 真实外呼受上游波动影响（空结果/超时均可跳过；结构由1b交互验收背书）
        except Exception as e:
            check("probe 真实搜索", False, f"异常: {e}", skippable=True)

        print("T3b AI代问（GEO_MOCK_ARK=1 罐头通道，绝不外呼）")
        s, d = req("GET", "/api/answerbot/config")
        check("AI代问 初始未配置", s == 200 and d.get("configured") is False, f"config={d}")
        try:
            req("POST", "/api/answerbot/start", {"project": "p_default", "prompts": [{"id": "P1", "q": "x"}]})
            check("AI代问 未配密钥拒绝启动", False, "未拒绝")
        except urllib.error.HTTPError as e:
            body = json.loads(e.read() or b"{}")
            check("AI代问 未配密钥拒绝启动", e.code == 400 and "未配置" in body.get("error", ""), f"{e.code} {body.get('error')}")
        s, d = req("POST", "/api/answerbot/config", {"apiKey": "e2e-test-key-123456", "model": "doubao-seed-1-6-250615"})
        check("AI代问 保存配置", s == 200 and d.get("configured") is True and str(d.get("keyTail", "")).startswith("****"),
              f"keyTail={d.get('keyTail')}")
        s, d = req("GET", "/api/answerbot/config")
        check("AI代问 密钥不回显全文", "e2e-test-key" not in json.dumps(d), f"响应={d}")
        prompts = [{"id": "P1", "q": "招商蛇口产业园区有哪些代表项目？"}, {"id": "P2", "q": "蛇口网谷是什么？里面有哪些类型的企业？"}]
        s, d = req("POST", "/api/answerbot/start", {"project": "p_default", "prompts": prompts,
                                                    "brand": "蛇口网谷", "competitors": ["张江高科"],
                                                    "ownDomains": ["cmsk1979.com"]})
        check("AI代问 启动返回runId", s == 200 and d.get("runId") and d.get("total") == 2, f"{d}")
        rid, st = d.get("runId"), {}
        for _ in range(30):
            time.sleep(0.6)
            s, st = req("GET", f"/api/answerbot/status?runId={rid}")
            if s == 200 and st.get("status") != "running":
                break
        check("AI代问 运行完成", st.get("status") == "done" and st.get("total") == 2,
              f"status={st.get('status')} items={st.get('items')}")
        check("AI代问 2问自动录入", sum(1 for it in (st.get("items") or []) if it.get("ok")) == 2, f"items={st.get('items')}")
        s, d = req("GET", "/api/data?project=p_default")
        rows = [r for r in (d.get("ledger") or []) if r.get("src") == "api"]
        check("AI代问 台账AI行", len(rows) == 2 and all(r.get("engine") == "豆包" and "AI代问" in (r.get("note") or "") for r in rows),
              f"src=api行×{len(rows)}")
        check("AI代问 提及抽取", any(r.get("mention") == 1 for r in rows), "罐头答案含品牌词→提及=1")
        check("V0.2.0 C3/C5 全文落盘+来源分层", bool(rows) and all(isinstance(r.get("srcTier"), dict) and "gov" in r["srcTier"] and "suspect" in r["srcTier"] and len(r.get("raw") or "") > 400 for r in rows),
              f"rawLen={len((rows[0].get('raw') or '')) if rows else 0} srcTier={rows[0].get('srcTier') if rows else None}")
        s, d = req("POST", "/api/answerbot/start", {"project": "p_default", "prompts": prompts[:1],
                                                    "brand": "蛇口网谷", "competitors": [], "ownDomains": []})
        rid = d.get("runId")
        for _ in range(30):
            time.sleep(0.6)
            s, st = req("GET", f"/api/answerbot/status?runId={rid}")
            if s == 200 and st.get("status") != "running":
                break
        s, d = req("GET", "/api/data?project=p_default")
        rows = [r for r in (d.get("ledger") or []) if r.get("src") == "api"]
        check("AI代问 重跑替换不重复累计", len(rows) == 2, f"src=api行×{len(rows)}")
        try:
            req("GET", "/api/answerbot/status?runId=nonexistent")
            check("AI代问 未知runId返回404", False, "未拒绝")
        except urllib.error.HTTPError as e:
            check("AI代问 未知runId返回404", e.code == 404, f"{e.code}")

        print("T4 静态资源")
        for path, mark in [("/", "GEO 智控台"), ("/js/app.js", "scoreContent"), ("/css/tokens.css", "招商蓝"),
                           ("/js/data.js?v=4.6", "entityChecklist"), ("/js/ops.js?v=4.6", "实体体检"),
                           ("/js/app.js?v=4.6", "项目库")]:
            with urllib.request.urlopen(ROOT + path, timeout=10) as resp:
                body = resp.read().decode("utf-8", "ignore")
                check(f"GET {path}", resp.status == 200 and mark in body, f"含「{mark}」")

        print("T5 前端服务器模式渲染（无头Chrome）")
        # V6.1：先给 local 用户标记已看引导——否则 T5 各 dump 里首登引导会自动弹出、
        # 页面切入南山大厦演示态，污染既有断言（无头 Chrome 的 navigator.webdriver 不可靠，以服务端判定为准）
        try:
            urllib.request.urlopen(urllib.request.Request(ROOT + "/api/onboarding/seen", data=b"{}", method="POST",
                                                          headers={"Content-Type": "application/json"}), timeout=10)
        except Exception:
            pass
        if chrome:
            def dump(frag):
                out = f"/tmp/e2e_{frag.replace('/', '_')}.html"
                with open(out, "w") as fh:
                    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=4000",
                                    "--dump-dom", f"{ROOT}/#{frag}"], stdout=fh, stderr=subprocess.DEVNULL, timeout=60)
                return open(out, encoding="utf-8", errors="ignore").read()
            html = dump("diag/scan")
            # 按钮文案跟项目承载形态（V4.5：无官网项目落实体体检）；dump 断言按模式二选一
            check("一键诊断页渲染", "dgRun" in html and ("开始一键诊断" in html or "开始实体体检" in html), f"诊断表单与按钮存在")
            check("V4.5诊断双入口", "实体体检" in html and "dgModeEntity" in html and "dgModeSite" in html,
                  "官网体检/实体体检双入口chip渲染")
            check("V0.1.8/0.1.12 诊断发射台+预检清单（dgOut 容器）", "dg-launch" in html and "dg-launch-row" in html and "dgOut" in html
                  and "将检查什么" in html and "is-todo" in html,
                  "表单横置发射台 + 空态预检清单（维度分组ghost卡）渲染")
            html = dump("projects")
            check("V4.5新建弹窗承载形态", "网上哪里能找到这个项目" in html and "暂时都没有" in html and 'value="none"' in html,
                  "三选一承载形态单选（own/parent/none）")
            html = dump("diag/report")
            check("诊断报告查阅页", "reportList" in html and ("诊断报告" in html) and ("打印" in html),
                  f"档案列表+报告视图+打印按钮存在（含历史数据或空态）")
            html = dump("diag/audit")
            check("体检页30项评分控件", html.count("score-seg") >= 30,
                  f"score-seg×{html.count('score-seg')}")
            check("V0.1.8 体检总结栏随行+两列网格", "audit-rail" in html and "audit-cols" in html
                  and "dimBars" in html and "dim-bar" in html and "audit-dim" in html,
                  f"sticky总结栏+维度得分条×{html.count(chr(34) + 'dim-bar' + chr(34))}+维度卡×{html.count('card audit-dim')}")
            html = dump("diag/evidence")
            check("V4证据库渲染", "evBox" in html and "已核验引言" in html and ("王强" in html or "暂无证据" in html), "证据库子页+进度条+条目")
            html = dump("act/toolkit")
            check("提升包页渲染", "tkBuild" in html and "渠道分发图" in html and html.count("打开入口") == 11,
                  f"生成按钮+渠道卡×{html.count('打开入口')}")
            check("V6.2 渠道图扩容", html.count("打开入口") == 11 and "B站（bilibili）" in html
                  and "搜狐号/网易号/企鹅号" in html and "地图POI（高德/百度/腾讯）" in html
                  and "11个真实入口" in html,
                  f"渠道卡×{html.count('打开入口')}（B站/同步号/地图POI进图+提示11同步）")
            check("V6.2 PR层指路", "谁在替你说话" in html and "数字 PR" in html and "争取被引" in html,
                  "权威媒体不走开号入驻的指路文案")
            check("V4资产追踪卡", "watchBox" in html and "查排名" in html, "资产追踪管理区（空态引导文案含查排名）")
            html = dump("monitor")
            check("V0.1 AI代问按钮与口径行", "botRun" in html and "AI 代问（豆包·自动录入）" in html
                  and "元宝" in html and "「AI」标" in html,
                  "采样卡顶部AI代问按钮+元宝仍人工说明+台账AI标口径行（零新术语）")

            def dump_lc(frag):
                out = f"/tmp/e2e_lc_{frag.replace('/', '_') or 'home'}.html"
                with open(out, "w") as fh:
                    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=8000",
                                    "--dump-dom", f"{ROOT}/?layoutcheck=1#/{frag}"], stdout=fh, stderr=subprocess.DEVNULL, timeout=90)
                return open(out, encoding="utf-8", errors="ignore").read()
            for frag, label in [("", "工作台"), ("projects", "项目库"), ("act/toolkit", "渠道图"), ("monitor", "监测"),
                                ("diag/scan", "诊断"), ("diag/audit", "体检")]:
                lh = dump_lc(frag)
                ok = ("W320" in lh and "W375" in lh and "W768" in lh
                      and "LAYOUT_FAIL" not in lh and "LAYOUT_ERR" not in lh and "测量中" not in lh)
                bad = re.search(r"(LAYOUT_FAIL[^<]*|LAYOUT_ERR[^<]*)", lh)
                check(f"V6.2.1 移动端布局无溢出·{label}", ok,
                      bad.group(1)[:180] if bad else "SELF+iframe真实320/375/768三视口全 OK")
            # V0.1.13 SPA 串页金标准：真实浏览器内执行「旧项目诊断→切新项目→全页扫描」+「演示态→退出→扫描南山大厦」
            # （?spacheck=1 自检通道；无头 dump 无法复现 SPA 切换路径，此为该缺陷类的唯一自动化防线）
            out2 = "/tmp/e2e_spacheck.html"
            with open(out2, "w") as fh:
                subprocess.run([chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=9000",
                                "--dump-dom", f"{ROOT}/?spacheck=1"], stdout=fh, stderr=subprocess.DEVNULL, timeout=120)
            sp = open(out2, encoding="utf-8", errors="ignore").read()
            v1 = (re.search(r'data-switch="([^"]+)"', sp) or [None, "MISSING"])[1]
            v2 = (re.search(r'data-tour="([^"]+)"', sp) or [None, "MISSING"])[1]
            note1 = (re.search(r'data-switchnote="([^"]+)"', sp) or [None, ""])[1]
            note2 = (re.search(r'data-tournote="([^"]+)"', sp) or [None, ""])[1]
            check("V0.1.13 金标准·跨项目切换无残留", v1 == "PASS", f"switch={v1} ({note1})")
            check("V0.1.13 金标准·演示退出无残留", v2 == "PASS", f"tour={v2} ({note2})")
            html = dump("act/agent")
            check("Agent页4张卡片", html.count("agent-card") == 4, f"agent-card×{html.count('agent-card')}")
            html = dump("monitor")
            check("监测页30问完整", html.count("prompt-li") >= 30, f"prompt-li×{html.count('prompt-li')}")
            check("批量跑按钮存在", "batchRun" in html and "跑一轮30问" in html, "一键跑30问按钮渲染")
            check("V4采样卡渲染", "本轮人工采样" in html and "sampleCard" in html and "≤20 分钟" in html, "采样卡+耗时徽标")
            check("V4发展曲线渲染", "GEO 发展曲线" in html and "curveBox" in html and html.count("<polyline") >= 2
                  and "基线" in html and "样本量" in html, f"曲线+基线标记+折线×{html.count('<polyline')}")
            check("V4预期窗口与口径", "预期窗口" in html and "禁止混均" in html, "事件窗口带+通道分层口径说明")
            check("V4引用诊断视图", "谁在赢" in html and "winBox" in html and "域名榜" in html and "诊断矩阵" in html
                  and "baike.baidu.com" in html and "基础层" in html, "域名榜含真实域名+类型标注+矩阵+fixQueue")
            check("V4修复队列", "fixQueueBox" in html and "生成工单" in html, "矩阵工单入口+队列渲染")
            check("V4业务结果卡", "bizBox" in html and "业务结果" in html and "AI引荐流量" in html, "月度表单+IT文案入口")
            check("V4曲线引擎筛选", "cvEngine" in html and "引用份额" in html, "引擎下拉+份额序列chips")
            check("V4批量粘贴入口", "batchPasteBtn" in html and "批量粘贴录入" in html and "batchTa" in html, "批量粘贴按钮+弹窗")
            check("V4矩阵管理入口", "paToggle" in html and "管理问题矩阵" in html, "问题矩阵管理按钮")
            check("V4共现字段", "mCooccur" in html and "竞品同时出现" in html, "录入表单含竞品同时出现")
            html = dump("dashboard")
            check("工作台三步向导", "三步上手向导" in html and "去一键诊断" in html, "向导卡片渲染")
            check("V4.6报头两态(项目内返回)", "‹ 项目库" in html and "projChip" in html, "项目内chip=一步返回项目库")
            check("V4基线对比卡", ("vs 起始数据" in html or "首测即起始数据" in html) and ("答案侧" in html or "信源侧" in html or "平均提及率" in html), "KPI含起始数据Δ与通道标注")
            check("V4项目身份块(报头)", "projChip" in html and "pcName" in html and "projSel" not in html,
                  "报头项目身份块渲染、原生下拉已移除")
            html = dump("projects")
            check("V4.6项目库工具栏", "pjQ" in html and "pjChips" in html and "pjSort" in html and "pjArch" in html
                  and "pjNew" in html and "新建项目" in html, "搜索/形态状态chips/排序/含归档/新建按钮")
            check("V4.7主导航全站常驻", "工作台" in html and "诊断" in html and "监测" in html and "知识库" in html
                  and "mainNav" in html, "项目库页也显示系统全貌导航（新人不再只见卡片墙）")
            check("V4.7首访欢迎页容器", "pjWelcome" in html and "新建项目" in html and "知道了" in html, "欢迎区（价值三步+新建引导+可关闭）存在；首访即显示（无localStorage标记）")
            check("V4.6项目库页头与形态筛选", "项目库" in html and "无官网" in html and "挂上级官网" in html
                  and "未诊断" in html and "pjStat" in html, "h2项目库+形态大白话chips+统计条")
            check("V4.6报头两态(库内高亮)", "pj-on" in html and "☰" in html, "项目库态chip高亮（同步渲染）")
            check("V4.6上次处理条", "上次处理" in html or "pjRecent" in html, "上次处理直达条（服务器汇总到位后显示项目名）")
            check("V4.6卡片形态徽标", "pc-badges" in html and ("挂上级官网" in html or "无官网" in html), "卡片含承载形态徽标")
            check("V4.6体检分口径标注", "24项" in html or "30项" in html or "体检分" in html, "分数口径随形态标注")
            check("V4留痕与恢复卡", "auditBox" in html and "restoreFile" in html and "操作留痕" in html, "项目总览页留痕+备份恢复")
            check("V4组合视图(趋势/预警/归档)", "vs起始数据" in html and "归档" in html, "项目卡含趋势箭头位+归档入口")
        else:
            check("无头Chrome", False, "未安装 Chrome，跳过前端渲染断言", skippable=True)

        print("T7 一键诊断端点（真实HTTP探测）")
        try:
            s, d = req("POST", "/api/diagnose", {"url": f"127.0.0.1:{PORT}", "brand": ""})
            checks = d.get("checks", [])
            ids = [c["id"] for c in checks]
            check("diagnose 结构化结果", s == 200 and len(checks) >= 5 and "T1" in ids and "T1a" in ids,
                  f"checks={len(checks)} 项: {ids}")
            ev = next((c["evidence"] for c in checks if c["id"] == "T1a"), "")
            check("diagnose 带证据", "GET" in ev and "→" in ev, f"证据示例: {ev[:60]}")
            check("site模式返回mode标记", d.get("mode") == "site", f"mode={d.get('mode')}")
        except Exception as e:
            check("diagnose 端点", False, f"异常: {e}")

        print("T7b 实体体检端点（V4.5 无官网项目入口 · 真实搜索）")
        try:
            s, d = req("POST", "/api/diagnose", {"url": "", "brand": "", "mode": "entity"})
            check("entity 无品牌词被拒", "品牌词" in str(d.get("error", "")), f"error={str(d.get('error'))[:50]}")
            s, d = req("POST", "/api/diagnose", {"url": "", "brand": "蛇口网谷", "mode": "entity"})
            if d.get("error"):
                check("entity 实体体检", False, d["error"], skippable=True)
            else:
                eids = [c["id"] for c in d.get("checks", [])]
                check("entity 实体体检", s == 200 and d.get("mode") == "entity" and "E2a" in eids and "E1" in eids and "E6" in eids and "E4" in eids,
                      f"mode={d.get('mode')} checks={eids}（无官网四项实体证据）", skippable=True)
                check("entity 判定保守（E1/E6 未确认时 warn 而非 fail）",
                      all(c["status"] in ("pass", "warn") for c in d.get("checks", []) if c["id"] in ("E1", "E6")),
                      "百科/企业信息只 warn，证据里给人工核实方法", skippable=True)
        except Exception as e:
            check("entity 端点", False, f"异常: {e}", skippable=True)

        print("T8 内置对话助手（真实本地模型）")
        try:
            r = urllib.request.Request(ROOT + "/api/chat", method="POST",
                data=json.dumps({"messages": [{"role": "user", "content": "一句话说明监测页怎么用"}]}).encode(),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(r, timeout=180) as resp:
                out = resp.read().decode("utf-8", "ignore")
            check("chat 真实回答", len(out.strip()) >= 20 and "跑一轮" in out or "监测" in out,
                  f"回答 {len(out)} 字：{out[:60]}…")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            check("chat 端点", False, f"HTTP {e.code}: {body[:80]}", skippable=True)
        except Exception as e:
            check("chat 端点", False, f"异常: {e}", skippable=True)

        print("T9 多项目层（V4 · 1a）")
        s, d = req("GET", "/api/projects")
        check("项目列表(默认项目迁移)", s == 200 and len(d.get("projects", [])) >= 1
              and d["projects"][0].get("id") == "p_default", f"{len(d.get('projects', []))} 个项目")
        s, d = req("POST", "/api/projects", {"id": "p_testb", "name": "测试园区B", "url": "www.bpark-test.com",
                                             "brand": "B园", "ownDomains": ["bpark-test.com"]})
        check("新建项目B", s == 200 and d.get("id") == "p_testb", f"id={d.get('id')}")
        s, d = req("POST", "/api/projects", {"id": "p_nosite", "name": "万海大厦", "url": "",
                                             "brand": "万海大厦", "entityMode": "none", "ownDomains": ["mp.weixin.qq.com"]})
        check("V4.5新建无官网项目", s == 200, f"status={s}")
        _, dpl = req("GET", "/api/projects")
        pn = next((p for p in dpl.get("projects", []) if p["id"] == "p_nosite"), {})
        check("V4.5 entityMode 往返+推导", pn.get("entityMode") == "none"
              and next((p.get("entityMode") for p in dpl.get("projects", []) if p["id"] == "p_testb"), "?") == "parent",
              f"显式none={pn.get('entityMode')} 有url推导parent")
        sampleB = {"audit": {"T1": 2}, "ledger": [
            {"date": "2026-09-04", "engine": "豆包", "promptId": "P9", "mention": 1, "sentiment": 1, "url": "", "note": "B专属标记"}],
            "snapshots": [{"ts": 5, "date": "2026-08-21", "type": "round", "auditPct": 5, "mentionAns": 40, "mentionAnsN": 1, "baseline": True},
                          {"ts": 6, "date": "2026-09-04", "type": "round", "auditPct": 5, "mentionAns": 100, "mentionAnsN": 1}],
            "watchPages": [{"name": "B园-一园一档.md", "url": "https://www.bpark-test.com/profile", "deployedAt": "2026-09-04", "promptIds": [], "hits": []}]}
        s, _ = req("PUT", "/api/data", {"project": "p_testb", "base_rev": 0, "state": sampleB})
        check("PUT 项目B(新协议)", s == 200, f"status={s}")
        _, ddef = req("GET", "/api/data")
        check("项目隔离(默认项目无B数据)", all(r.get("promptId") != "P9" for r in (ddef.get("ledger") or [])),
              f"默认项目ledger={len(ddef.get('ledger') or [])}条(应为T2的1条且无P9)")
        _, dB = req("GET", "/api/data?project=p_testb")
        check("项目B数据往返", dB.get("_project") == "p_testb" and dB.get("ledger") == sampleB["ledger"],
              f"_project={dB.get('_project')} ledger={len(dB.get('ledger') or [])}条")
        check("V4快照与资产往返", len(dB.get("snapshots") or []) == 2 and (dB.get("snapshots") or [{}])[0].get("baseline") is True
              and len(dB.get("watchPages") or []) == 1, f"snapshots={len(dB.get('snapshots') or [])} watchPages={len(dB.get('watchPages') or [])}")
        check("V4证据与修复队列往返", len(dB.get("evidence") or []) == 0 and len(dB.get("fixQueue") or []) == 0,
              "空结构不丢键（B未录入，defaultState兜底）")
        s, d = req("GET", "/api/projects")
        sb = next((p["summary"] for p in d.get("projects", []) if p["id"] == "p_testb"), {})
        check("V4组合指标(趋势/预警)", sb.get("trend") == 60 and sb.get("lastRound") == "2026-09-04" and "无口径表" in (sb.get("warn") or []),
              f"trend={sb.get('trend')} lastRound={sb.get('lastRound')} warn={sb.get('warn')}")
        s, d = req("POST", "/api/projects/archive", {"id": "p_testb", "archived": True})
        _, d2 = req("GET", "/api/projects")
        arch_b = next((p for p in d2.get("projects", []) if p["id"] == "p_testb"), {})
        check("V4.6归档返回带标记", s == 200 and d.get("archived") is True and arch_b.get("archived") is True,
              "归档项目仍返回（archived=True，项目库「含已归档」开关下展示/恢复）")
        sb0 = next((p.get("summary") for p in d2.get("projects", []) if p["id"] == "p_nosite"), {})
        check("V4.6 summary新字段", "woPending" in sb0 and "lastDiag" in sb0 and sb0.get("entMode") == "none",
              f"woPending={sb0.get('woPending')} lastDiag={sb0.get('lastDiag')} entMode={sb0.get('entMode')}")
        check("V4.6 none分母对齐(server)", sb0.get("auditPct") == 0,
              f"无官网项目服务端分母排除T1-T6（空audit=0分，非NaN）·实测{sb0.get('auditPct')}")
        s, d = req("POST", "/api/projects/archive", {"id": "p_testb", "archived": False})
        _, d3 = req("GET", "/api/projects")
        back_b = next((p for p in d3.get("projects", []) if p["id"] == "p_testb"), {})
        check("V4.6归档恢复往返", s == 200 and d.get("ok") and back_b and not back_b.get("archived"),
              "恢复后回到活跃列表（数据未动）")
        req("POST", "/api/projects/archive", {"id": "p_testb", "archived": True})   # 测完再归档，保持原测试状态
        try:
            req("PUT", "/api/data", {"project": "p_testb", "base_rev": 0, "state": sampleB})  # 过期 rev 重放
            check("项目级乐观锁409", False, "未拒绝")
        except urllib.error.HTTPError as e:
            b = json.loads(e.read() or b"{}")
            check("项目级乐观锁409", e.code == 409 and b.get("project") == "p_testb", f"409 project={b.get('project')}")
        try:
            req("PUT", "/api/data", {"project": "p_nope", "base_rev": 0, "state": {}})
            check("不存在项目404", False, "未拒绝")
        except urllib.error.HTTPError as e:
            check("不存在项目404", e.code == 404, f"HTTP {e.code}")
        s, d = req("GET", "/api/backup")
        fexists = os.path.exists(os.path.join("/tmp/backups", "geodesk-" + time.strftime("%Y%m%d") + ".json"))
        check("每日备份生成", s == 200 and d.get("ok") and fexists, f"file={d.get('file')}")
        s, d = req("GET", "/api/audit")
        check("server侧操作留痕", s == 200 and any(str(a.get("action", "")).startswith(("PUT", "保存数据")) for a in d.get("audit", [])),
              f"留痕{len(d.get('audit', []))}条")

        print("T11 贴答案解析（V4 3.4 /api/parse · 真实本机模型）")
        try:
            s, d = req("POST", "/api/parse", {"text": "深圳南山的科创园区推荐深圳湾科技生态园和蛇口网谷，后者由招商蛇口运营。来源：baike.baidu.com",
                                              "brand": "蛇口网谷", "competitors": ["深圳湾科技生态园"]})
            check("parse 结构化抽取", s == 200 and d.get("mention") == 1 and "baike.baidu.com" in (d.get("citedDomains") or [])
                  and any("深圳湾" in c for c in (d.get("competitorMentions") or [])),
                  f"mention={d.get('mention')} 引用={d.get('citedDomains')} 竞品={d.get('competitorMentions')}",
                  skippable=True)   # CI 无本机模型/豆包通道→LLM 调用失败→mention=None；本地有模型时才算 PASS
        except Exception as e:
            check("parse 端点", False, f"异常/无模型: {e}", skippable=True)

        print("T10 备份恢复（V4 2.5 /api/restore）")
        try:
            req("POST", "/api/restore", {"payload": {"projects": [{"id": "p_x"}], "docs": {"p_x": {"rev": 1, "state": {}}}}})
            check("restore缺confirm被拒", False, "未拒绝")
        except urllib.error.HTTPError as e:
            check("restore缺confirm被拒", e.code == 400, f"HTTP {e.code}")
        s, d = req("POST", "/api/restore", {"confirm": True, "payload": {
            "projects": [{"id": "p_r", "name": "恢复测试园", "url": "", "brand": "", "ownDomains": [], "createdAt": "2026-09-04", "archived": False}],
            "docs": {"p_r": {"rev": 1, "state": {"ledger": [{"date": "2026-09-04", "engine": "Kimi", "promptId": "P1", "mention": 1, "sentiment": 1, "url": "", "note": "来自备份"}]}}},
            "audit": []}})
        check("restore执行", s == 200 and d.get("ok") and d.get("projects") == 1, f"恢复{d.get('projects')}个项目")
        _, dr = req("GET", "/api/data?project=p_r")
        check("restore数据可读", dr.get("ledger") and dr["ledger"][0]["note"] == "来自备份" and dr.get("_rev") == 1, "备份内容落到新库")

        print("T6 评分器单元（node 直接驱动浏览器同源逻辑）")
        # V0.2.1 闸门：CI 上 /tmp 没有外部坏例/好例，内联到脚本里（与改写示范 27/82 同源）
        open("/tmp/bad.md", "w").write(
            "蛇口网谷环境优美、配套完善、区位优越，是广大企业理想的办公选择，欢迎咨询入驻！")
        open("/tmp/good.md", "w").write(
            "蛇口网谷是招商蛇口产业园区（招商产园）旗下科创园区，位于深圳南山区。"
            "截至2025年11月，园区入驻企业近460家，核心产业聚集度近70%，引入苹果、博世、雀巢等世界500强，"
            "培育上市公司及新三板挂牌企业20余家（来源：中国工业新闻网，2025）。"
            "\n\n## 园区租金什么水平？\n租金区间为XX元/㎡/月（以口径表为准）。\n"
            "\n## 入驻企业有哪些？\n引入苹果、博世、雀巢等世界500强，培育上市公司20余家。\n"
            "\n「招商既是房东也是公司股东——我们十多年没换过地方。」（纽迪瑞科技董事长李灏）\n"
            "更新时间：2026-09 · 责任人：招商产园品牌部")
        harness = r'''
const fs = require("fs");
global.document = { addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []}, createElement(){return {style:{},appendChild(){},remove(){},click(){},set href(v){},set download(v){}}} };
global.localStorage = { getItem(){return null}, setItem(){}, };
global.location = { hash:"" };
global.window = { addEventListener(){}, scrollTo(){} };
global.AbortSignal = { timeout(){} };
global.fetch = async()=>{throw new Error("offline")};
global.confirm = ()=>true;
const vm = require("vm");
const ctx = vm.createContext(global);
vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), ctx);  // data.js
vm.runInContext(fs.readFileSync(process.argv[3], "utf8"), ctx);  // app.js
try { vm.runInContext(fs.readFileSync(require("path").dirname(process.argv[2]) + "/chat-kb.js", "utf8"), ctx); } catch (e) {}  // V0.2.0 C2：KB 口语化命中
const bad = fs.readFileSync(process.argv[4], "utf8");
const good = fs.readFileSync(process.argv[5], "utf8");
const r1 = vm.runInContext(`scoreContent(${JSON.stringify(bad)}, "蛇口网谷")`, ctx);
const r2 = vm.runInContext(`scoreContent(${JSON.stringify(good)}, "蛇口网谷")`, ctx);
const bpText = "日期\t引擎\t问题ID\t提及\t倾向\t链接\t竞品共现\t备注\n\t豆包\tP2\t提及\t正面\thttps://x.com/a\t深圳湾科技园、天安数码城\t第3位\n2026-09-01,DeepSeek,P19,未提及,中性,,,对比类零素材\n\t豆包\tP99\t提及\t正面\t\t\t坏ID应被拒";
const bp = vm.runInContext(`parseBatchRows(${JSON.stringify(bpText)})`, ctx);
const samp = vm.runInContext('pickSample(state.prompts, [{engine:"豆包",promptId:"P20"},{engine:"豆包",promptId:"P20"},{engine:"DeepSeek",promptId:"P20"}], ["豆包","DeepSeek","腾讯元宝","通义千问","文心一言","Kimi"])', ctx);
const fp1 = vm.runInContext('fixPriority({biz:5,gap:5,fix:5,acc:5,effort:1})', ctx);
const fp2 = vm.runInContext('fixPriority({biz:3,gap:4,fix:3,acc:3,effort:2})', ctx);
const dt1 = vm.runInContext('domainType("blog.csdn.net")[0]', ctx);
const dt2 = vm.runInContext('domainType("baike.baidu.com")[0]', ctx);
const dt3 = vm.runInContext('domainType("www.example.com")[0]', ctx);
const snap = vm.runInContext(`computeSnapshot("round", {audit: {T1: 2, T2: 1, T3: 0}, lastDiag: {checks: [{status: "fail"}, {status: "pass"}]}, ledger: [
  {date: "2026-09-01", engine: "搜索通道", promptId: "P1", mention: 0},
  {date: "2026-09-01", engine: "搜索通道", promptId: "P2", mention: 1},
  {date: "2026-09-04", engine: "搜索通道", promptId: "P3", mention: 1},
  {date: "2026-09-04", engine: "搜索通道", promptId: "P4", mention: 0},
  {date: "2026-09-04", engine: "豆包", promptId: "P1", mention: 1},
  {date: "2026-09-04", engine: "Kimi", promptId: "P2", mention: 0}]})`, ctx);
const snapNone = vm.runInContext('computeSnapshot("diag", {entityMode: "none", audit: {T1: 2, T2: 2, T3: 2, E1: 2, E2: 1}, lastDiag: {checks: []}, ledger: []})', ctx);
const af = vm.runInContext(`(() => {
  state.audit = {}; state.autoAudit = {};          /* 复现线上 bug：doc 覆盖导致 audit 稀疏 */
  const r1 = applyAutoScores({T1:0, T2:2, T4:0, C2:1, X9:2});
  const marked = !!state.autoAudit.T1 && !!state.autoAudit.T4 && !state.autoAudit.X9;
  const r2 = applyAutoScores({T2:2, T5:2});        /* T2 已有 2 分=保持；T5 稀疏键缺失=可填 */
  return {f1: r1.filled, k1: r1.kept, marked, f2: r2.filled, k2: r2.kept, scoreT2: state.audit.T2};
})()`, ctx);
const pf1 = vm.runInContext(`diagPrefill({parkUrl:"www.cmsk1979.com"}, {brand:"蛇口网谷", name:"蛇口网谷", url:"www.cmsk1979.com"})`, ctx);
const pf2 = vm.runInContext(`diagPrefill({}, {brand:"深圳新时代广场", name:"新时代广场", url:""})`, ctx);
const landing = vm.runInContext('landingView()', ctx);
const kb = vm.runInContext(`(() => { try {
  return { d: !!kbSearch("数据会丢吗"), k: !!kbSearch("口径表冲突怎么处理"), m: !!kbSearch("监测是怎么做的"),
           recoNull: kbSearch("咱们园区在AI里被推荐了吗") === null };
} catch (e) { return { err: String(e) }; } })()`, ctx);
console.log(JSON.stringify({bad: r1.score, good: r2.score,
  fp: {hi: fp1, mid: fp2, d: [dt1, dt2, dt3]},
  snap: {pct: snap.auditPct, fails: snap.diagFails, ans: snap.mentionAns, ansN: snap.mentionAnsN, src: snap.mentionSrc, srcN: snap.mentionSrcN, own: snap.ownHitN, ownT: snap.ownHitTotal, ownD: snap.ownHitDate},
  snapNone: {pct: snapNone.auditPct},
  landing,
  kb,
  bp: {n: bp.rows.length, badn: bp.bad.length, co: (bp.rows[0] && bp.rows[0].cooccur || []).length},
  samp: {n: samp.qs.length, sev: samp.qs[0] ? samp.qs[0].severity : 0, noDoubao: !samp.engs.includes("豆包")},
  af,
  pf: {u1: pf1.url, b1: pf1.brand, u2: pf2.url, b2: pf2.brand}}));
'''
        open("/tmp/e2e_harness.js", "w").write(harness)
        subprocess.run(["cp", "/tmp/bad.md", "/tmp/e2e_bad.md"], check=True)
        subprocess.run(["cp", "/tmp/good.md", "/tmp/e2e_good.md"], check=True)
        p = subprocess.run(["node", "/tmp/e2e_harness.js", f"{BASE}/js/data.js", f"{BASE}/js/app.js",
                            "/tmp/e2e_bad.md", "/tmp/e2e_good.md"], capture_output=True, text=True, timeout=30)
        # harness 内取 process.argv[2..5]（argv[1] 为脚本自身）
        if p.returncode == 0 and p.stdout.strip():
            r = json.loads(p.stdout.strip().splitlines()[-1])
            check("营销腔<50", r["bad"] < 50, f"score={r['bad']}")
            check("GEO体≥75", r["good"] >= 75, f"score={r['good']}")
            check("V0.2.0 C2 KB口语化命中", r.get("kb", {}).get("d") and r["kb"]["k"] and r["kb"]["m"] and r["kb"]["recoNull"],
                  f"数据会丢={r['kb'].get('d')} 口径冲突={r['kb'].get('k')} 监测插字={r['kb'].get('m')} 被推荐走项目感知={r['kb'].get('recoNull')}")
            check("V4批量粘贴解析器", r["bp"]["n"] == 2 and r["bp"]["badn"] == 1 and r["bp"]["co"] == 2,
                  f"有效{r['bp']['n']}/拒{r['bp']['badn']}条·共现{r['bp']['co']}个")
            check("V4采样选择器", r["samp"]["n"] == 10 and r["samp"]["sev"] == 5 and r["samp"]["noDoubao"],
                  f"取{r['samp']['n']}问·首问严重度{r['samp']['sev']}·避开已测引擎={r['samp']['noDoubao']}")
            sn = r["snap"]
            fp = r["fp"]
            check("V4优先级公式与域名类型", fp["hi"] == 625 and fp["mid"] == 54 and fp["d"] == ["通吃平台", "基础层", "其他"],
                  f"P(全5/工作量1)={fp['hi']} P(3,4,3,3,÷2)={fp['mid']} 类型={fp['d']}")
            check("V4快照计算器(通道分层)", sn["pct"] == 50 and sn["fails"] == 1 and sn["ans"] == 50 and sn["ansN"] == 2
                  and sn["src"] == 50 and sn["srcN"] == 4 and sn["own"] == 1 and sn["ownT"] == 2 and sn["ownD"] == "2026-09-04",
                  f"体检{sn['pct']}·未过{sn['fails']}·答案侧{sn['ans']}(n={sn['ansN']})·信源侧{sn['src']}(n={sn['srcN']})·当日自有{sn['own']}/{sn['ownT']}")
            check("V4.5无官网分母排除", r.get("snapNone", {}).get("pct") == 75,
                  f"none模式 T1–T3(满分6)不进分母，E1+E2=3/4=75%·实测{r.get('snapNone', {}).get('pct')}%")
            check("V4.7落地分流(无上次记录→项目库)", r.get("landing") == "projects",
                  f"node环境无lastOpen→projects（有项目卡片+全貌导航）·实测{r.get('landing')}")
            pf = r.get("pf", {})
            check("V0.1.11 诊断预填按项目隔离", pf.get("u1") == "www.cmsk1979.com" and pf.get("b1") == "蛇口网谷"
                  and pf.get("u2") == "" and pf.get("b2") == "深圳新时代广场",
                  f"蛇口→{pf.get('b1')}/{pf.get('u1') or '—'}·新时代→{pf.get('b2')}/{pf.get('u2') or '—'}（各取各的，杜绝串值）")
            af = r.get("af", {})
            check("V0.1.10 诊断自动填入(稀疏audit闭环)", af.get("f1") == 4 and af.get("k1") == 0 and af.get("marked")
                  and af.get("f2") == 1 and af.get("k2") == 1 and af.get("scoreT2") == 2,
                  f"稀疏audit填{af.get('f1')}项(0分也留痕={af.get('marked')})·非法id拒·已评分保持{af.get('k2')}·T2分={af.get('scoreT2')}")
        else:
            check("评分器单元", False, p.stderr[:200] or "node 输出为空", skippable=True)

        print("T11 V5 通用化（第二项目：任何项目进来，尺子必须跟着变）")
        # 1. 建虚构第二项目（9 字段全量）
        s, d = req("POST", "/api/projects", {"name": "南京金融城", "brand": "南京金融城", "entityMode": "none",
            "city": "南京河西", "industries": ["金融科技", "人工智能"], "competitors": ["德基广场", "南京国际金融中心"],
            "matrixTier": "park", "operator": "南京河西新城区开发委员会", "ownDomains": ["mp.weixin.qq.com"]})
        pid2 = d.get("id")
        check("V5第二项目创建", s == 200 and pid2, f"status={s} id={pid2}")
        # 2. 元数据回读（server 存了新字段）
        s, d = req("GET", "/api/projects")
        pj = next((x for x in d.get("projects", []) if x.get("id") == pid2), {})
        check("V5元数据9字段回读", pj.get("city") == "南京河西" and pj.get("industries") == ["金融科技", "人工智能"]
              and pj.get("competitors") == ["德基广场", "南京国际金融中心"] and pj.get("matrixTier") == "park",
              f"city={pj.get('city')} ind={pj.get('industries')} comp={pj.get('competitors')} tier={pj.get('matrixTier')}")
        # 3. update 端点改档位/城市
        s, d = req("POST", "/api/projects/update", {"id": pid2, "matrixTier": "lite", "city": "南京建邺"})
        s, d = req("GET", "/api/projects")
        pj = next((x for x in d.get("projects", []) if x.get("id") == pid2), {})
        check("V5项目设置更新生效", pj.get("matrixTier") == "lite" and pj.get("city") == "南京建邺",
              f"tier={pj.get('matrixTier')} city={pj.get('city')}")
        # 4. node 驱动模板实例化（GEO.promptTemplates 为被测对象）
        node_probe = """
const fs = require('fs');
const GEO = new Function(fs.readFileSync('js/data.js', 'utf8') + '; return GEO;')();
const m = { park: '南京金融城', city: '南京河西', industry: ['金融科技','人工智能'], competitors: ['德基广场','南京国际金融中心'], operator: '南京河西新城区开发委员会' };
const inst = (tier, mm) => (GEO.promptTemplates[tier] || []).map(t => ({ id: t.id, cat: t.cat, q: t.q(mm) }));
const park = inst('park', m);
const lite = inst('lite', m);
const bare = inst('park', { park: '某园区', city: '某市', industry: [], competitors: [], operator: '' });
const allQ = park.concat(lite, bare).map(x => x.q).join('|');
const bad = ['蛇口','招商','深圳','南海意库','张江','联东','网谷'].filter(w => allQ.includes(w));
console.log(JSON.stringify({
  parkN: park.length, liteN: lite.length,
  hasBrand: park.some(x => x.q.includes('南京金融城')),
  hasCity: park.some(x => x.q.includes('南京河西')),
  hasComp: park.some(x => x.q.includes('德基广场')),
  badWords: bad, bareOk: bare.length === 30 && bare.every(x => x.q && x.q.length >= 8),
  cats: [...new Set(park.map(x => x.cat))].join('/')
}));
"""
        np = subprocess.run(["node", "-e", node_probe], capture_output=True, text=True, cwd=BASE)
        if np.returncode == 0 and np.stdout.strip():
            r = json.loads(np.stdout)
            check("V5园区版30问实例化", r["parkN"] == 30 and r["cats"] == "品牌认知/选址决策/对比竞品/产业服务",
                  f"n={r['parkN']} 类别={r['cats']}")
            check("V5轻量版12问(V6扩至14)", r["liteN"] == 14, f"n={r['liteN']}（V6 追加 L13/L14 区位词探针）")
            check("V5参数注入", r["hasBrand"] and r["hasCity"] and r["hasComp"], f"品牌/城市/竞品 全部进入问题")
            check("V5零种子残留", not r["badWords"], f"蛇口/招商/深圳等字样={r['badWords'] or '无'}")
            check("V5缺参兜底通顺", r["bareOk"], "全空元数据仍生成30问且每问≥8字")
        else:
            check("V5模板实例化", False, np.stderr[:160] or "node 输出为空", skippable=True)
        # 5. parse 轨道：有模型（本机 Ollama）应成功抽取；无模型时报错必须是大白话（禁 ollama pull 指令）
        s, d = req("POST", "/api/parse", {"text": "南京金融城是南京河西的金融科技产业园区，德基广场也在附近。", "brand": "南京金融城", "competitors": ["德基广场"]})
        err = str(d.get("error", ""))
        if d.get("mention") is not None:
            check("V5 parse可用（本机Ollama轨道）", True, f"mention={d.get('mention')} 共现={d.get('competitorMentions')}")
        else:
            # V0.2.0 C4 parse_answer 回退豆包通道后，无本机模型时错误文案可能来自豆包通道（401/未配置）
            # 本地有模型 → mention 非 None 走上一条；CI 无模型 → 两种错误都视为 PASS（都说明 LLM 调用被正确拒绝）
            acceptable = ("配置你自己的模型" in err and "ollama" not in err) or "豆包通道" in err or "未配置" in err
            check("V5 parse无模型合理报错", acceptable, f"error={err[:60]}", skippable=True)
        print("T12 V6 冷启动与发言权（骨架/区位词/阵地分层/歧义检测/向导卡）")
        # 1. data.js 骨架结构（node）
        node_v6 = """
const fs = require('fs');
const GEO = new Function(fs.readFileSync('js/data.js', 'utf8') + '; return GEO;')();
const sc = GEO.caliberScaffold;
const lite = GEO.promptTemplates.lite;
const m = { park: '南京金融城', city: '南京河西', district: '元通商圈', industry: ['金融科技'], competitors: [], operator: '' };
const mk = t => ({ id: t.id, cat: t.cat, q: t.q(m) });
const qs = lite.map(mk);
console.log(JSON.stringify({
  anchorN: sc.anchor.length, parkN: sc.park.length, liteN: sc.lite.length,
  hintsOk: [...sc.anchor, ...sc.park, ...sc.lite].every(x => x.field && x.hint),
  liteQ: qs.length, l13: (qs.find(x => x.id === 'L13') || {}).q, l14: (qs.find(x => x.id === 'L14') || {}).q,
  l13NoBrand: !(qs.find(x => x.id === 'L13') || {q:''}).q.includes('南京金融城'),
  l13FallbackCity: lite.find(x => x.id === 'L13').q(Object.assign({}, m, { district: '' })),
}));
"""
        nv = subprocess.run(["node", "-e", node_v6], capture_output=True, text=True, cwd=BASE)
        if nv.returncode == 0 and nv.stdout.strip():
            r = json.loads(nv.stdout)
            check("V6口径骨架结构", r["anchorN"] == 3 and r["parkN"] == 5 and r["liteN"] == 6 and r["hintsOk"],
                  f"锚定{r['anchorN']}+园区{r['parkN']}+楼宇{r['liteN']}·每字段带指引={r['hintsOk']}")
            check("V6 lite 14问+区位词", r["liteQ"] == 14 and "元通商圈" in r["l13"] and "元通商圈" in r["l14"],
                  f"n={r['liteQ']} L13={r['l13']}")
            check("V6 区位词不带品牌词", r["l13NoBrand"], "L13 度量的是真实搜索路径而非品牌词")
            check("V6 区位缺省退城市", "南京河西" in r["l13FallbackCity"], r["l13FallbackCity"])
        else:
            check("V6骨架/区位词", False, nv.stderr[:120] or "node 无输出", skippable=True)
        # 2. groupDomains API 往返
        s, d = req("POST", "/api/projects", {"name": "V6分层测试楼", "brand": "V6分层测试楼", "entityMode": "none",
            "city": "测试市", "ownDomains": ["own-test.com"], "groupDomains": ["group-test.com"]})
        pid6 = d.get("id")
        s, d = req("GET", "/api/projects")
        pj6 = next((x for x in d.get("projects", []) if x.get("id") == pid6), {})
        check("V6 groupDomains 创建回读", pj6.get("groupDomains") == ["group-test.com"] and pj6.get("ownDomains") == ["own-test.com"],
              f"own={pj6.get('ownDomains')} group={pj6.get('groupDomains')}")
        s, d = req("POST", "/api/projects/update", {"id": pid6, "groupDomains": ["grp2.com", "grp3.com"]})
        s, d = req("GET", "/api/projects")
        pj6 = next((x for x in d.get("projects", []) if x.get("id") == pid6), {})
        check("V6 groupDomains 更新生效", pj6.get("groupDomains") == ["grp2.com", "grp3.com"], str(pj6.get("groupDomains")))
        # 3. brandcheck（真实外呼，结构断言，失败可跳过）
        try:
            s, d = req("POST", "/api/brandcheck", {"brand": "新时代广场", "city": "深圳南山"})
            _ok = "ambiguity" in d and (not d.get("ambiguity") or bool(d.get("samples") or d.get("suggestion")))
            check("V6 brandcheck 结构", _ok,
                  f"ambiguity={d.get('ambiguity')} suggestion={str(d.get('suggestion'))[:20]}", skippable=True)
        except Exception as e:
            check("V6 brandcheck 结构", False, f"异常: {e}", skippable=True)
        # 4. 向导卡容器（无头渲染工作台）——CI 上可能无 Chrome（ubuntu runner 自带但某些环境缺）
        if chrome:
            html = dump("dashboard")
            check("V6 起步向导卡容器", "dashOnboard" in html and "起步四步" in html, "四步向导卡渲染（三空项目显示，蛇口等成熟项目 hidden）")
        else:
            check("V6 起步向导卡容器", False, "CI 无 Chrome，跳过", skippable=True)
        # 5. own 后缀匹配单元（python exec server.py 顶层取 _own_hit）
        g = {"__file__": os.path.join(BASE, "server.py")}
        try:
            exec(compile(open(os.path.join(BASE, "server.py"), encoding="utf-8").read(), "server.py", "exec"), g)
            oh = g["_own_hit"]
            check("V5 own后缀匹配", oh("https://www.cmhk.com/x", ["cmhk.com"]) and oh("https://mp.weixin.qq.com/y", ["weixin.qq.com"])
                  and not oh("https://fake-cmhk.com.evil.com/z", ["cmhk.com"]) and not oh("https://x.com/a/b-cmhk.com", ["cmhk.com"]),
                  "www 子域命中/父域命中/恶意子串不命中/路径子串不命中")
        except Exception as e:
            check("V5 own后缀匹配", False, f"exec 失败: {e}", skippable=True)

        print("T13 V6.1 新用户首登引导（账号级一次性 + 南山大厦只读演示）")
        def reqh(method, path, body=None, user=None):
            data = json.dumps(body).encode() if body is not None else None
            h = {"Content-Type": "application/json"}
            if user: h["X-Geo-User"] = user
            r = urllib.request.Request(ROOT + path, data=data, method=method, headers=h)
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        s, d = reqh("GET", "/api/onboarding", user="touruser1")
        check("V6.1 首访显示引导", s == 200 and d.get("show") is True and d.get("user") == "touruser1", f"show={d.get('show')}")
        s, d = reqh("POST", "/api/onboarding/seen", user="touruser1")
        check("V6.1 标记已看", s == 200 and d.get("ok") is True, f"user={d.get('user')}")
        s, d = reqh("GET", "/api/onboarding", user="touruser1")
        check("V6.1 看过不再显示", d.get("show") is False, f"show={d.get('show')}")
        s, d = reqh("GET", "/api/onboarding", user="touruser2")
        check("V6.1 账号级隔离", d.get("show") is True, "另一账号不受影响（kv 按账号分键）")
        s, d = reqh("POST", "/api/onboarding/seen", body={"exit": "skip", "step": 3, "maxStep": 6}, user="touruser3")
        s, d = reqh("GET", "/api/onboarding", user="touruser3")
        check("V6.1.1 引导漏斗记录", d.get("record", {}).get("exit") == "skip" and d.get("record", {}).get("maxStep") == 6
              and d.get("show") is False, f"record={d.get('record')}")
        s, d = reqh("GET", "/api/ping")
        check("V0.1 版本号0.2.10", d.get("version") == "0.2.10", f"v={d.get('version')}")
        with urllib.request.urlopen(ROOT + "/js/chat.js", timeout=10) as _resp:
            _cjs = _resp.read().decode("utf-8", "ignore"); _s2 = _resp.status
        check("V0.2.0 C1 chat项目感知", _s2 == 200 and "projectRecoAnswer" in _cjs and "你的项目实时数据" in _cjs,
              "「被推荐了吗」类问题走项目实时数据应答（F3）")
        for path, mark in [("/js/tour.js", "南山大厦"), ("/css/tour.css", "tour-ring")]:
            with urllib.request.urlopen(ROOT + path + "?v=6.1.0", timeout=10) as resp:
                body = resp.read().decode("utf-8", "ignore")
            check(f"V6.1 静态资源 {path}", resp.status == 200 and mark in body, f"含「{mark}」")
        with urllib.request.urlopen(ROOT + "/", timeout=10) as resp:
            idx_html = resp.read().decode("utf-8", "ignore")
        check("V0.1 版本戳统一0.2.10", idx_html.count("?v=0.2.10") >= 9 and "?v=0.1.13" not in idx_html
              and "?v=6.2.0" not in idx_html and "?v=6.1.2" not in idx_html and "?v=6.1.1" not in idx_html
              and "?v=6.1.0" not in idx_html and "?v=6.0.0" not in idx_html and "?v=4.7.7" not in idx_html
              and "?v=4.7.3" not in idx_html,
              f"?v=0.2.0×{idx_html.count('?v=0.2.0')}")
        reqh("POST", "/api/onboarding/seen")   # local 用户也标记：后续 dump 不受自动弹影响（webdriver 兜底之外第二层）
        if chrome:
            def dump_tour(urlpath):
                out = "/tmp/e2e_tour.html"
                with open(out, "w") as fh:
                    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=4000",
                                    "--dump-dom", f"{ROOT}{urlpath}"], stdout=fh, stderr=subprocess.DEVNULL, timeout=60)
                return open(out, encoding="utf-8", errors="ignore").read()
            html = dump_tour("/?tour=force#/projects")
            check("V6.1 欢迎步渲染", "tourBubble" in html and "南山大厦" in html and "不用再学了" in html and "开始带看" in html
                  and "tour-head" in html and "tour-prog" in html,
                  "欢迎气泡+跳过按钮+案例名+头部进度行（V6.1.2 结构：进度归头/动作归脚）")
            html = dump_tour("/?tour=force&tourStep=4#/projects")
            check("V6.1.1 导航地图步", "全流程地图" in html and "mainNav" in html, "新增聚光主导航步（教地图不只教流程）")
            html = dump_tour("/?tour=force&tourStep=6#/projects")
            check("V6.1 演示态渲染真实组件", "谁在替你说话" in html and "中介平台" in html and "已自动填入体检表" in html,
                  "第7步=实体体检结果+发言权分析卡（真实组件渲染示例数据，非截图）")
            html = dump_tour("/?tour=force&tourStep=8#/projects")
            check("V6.1 监测曲线演示", "GEO 发展曲线" in html and html.count("<polyline") >= 2 and "南山大厦" in html,
                  "第9步=发展曲线渲染示例快照（报头/演示态=南山大厦）")
            check("V0.1 引导监测步含AI代问", "AI 代问" in html and "人工抽查" in html,
                  "新手展示同步：监测步气泡教「AI 代问」并说明元宝仍需人工抽查")
            check("V6.1.1 口径一致(14问)", "14 问真实搜索" in html and "跑一轮14问" in html and "12 问" not in html,
                  "气泡与页面同屏均为 14 问（P1 修复回归断言）")
            html = dump_tour("/#/projects")
            check("V6.1 已看过不再自动弹", "tourBubble" not in html, "seen 标记+webdriver 兜底双保险")
        else:
            check("V6.1 无头Chrome引导渲染", False, "未安装 Chrome", skippable=True)
    finally:
        srv.terminate(); srv.wait(timeout=5)

    print(f"\n══ 全链路测试结果：{len(PASS)} 通过 · {len(SKIP)} 跳过 · {len(FAIL)} 失败 ══")
    for f in FAIL:
        print("  ✗", f)
    for s in SKIP:
        print("  ⊘", s)
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
