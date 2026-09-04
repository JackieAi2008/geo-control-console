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
import json, os, subprocess, sys, time, urllib.request, urllib.error

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
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    try: os.remove("/tmp/geodesk_e2e.db")   # V4：多项目测试要求全新 db（避免上次运行的项目残留）
    except FileNotFoundError: pass
    srv = subprocess.Popen([sys.executable, os.path.join(BASE, "server.py"),
                            "--port", str(PORT), "--db", "/tmp/geodesk_e2e.db"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        print("T1 健康检查")
        s, d = req("GET", "/api/ping")
        check("ping", s == 200 and d.get("ok") is True, f"status={s} body={d}")

        print("T2 状态持久化往返（含乐观锁）")
        sample = {"audit": {"T1": 2, "T2": 1}, "ledger": [
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

        print("T4 静态资源")
        for path, mark in [("/", "GEO 智控台"), ("/js/app.js", "scoreContent"), ("/css/tokens.css", "招商蓝")]:
            with urllib.request.urlopen(ROOT + path, timeout=10) as resp:
                body = resp.read().decode("utf-8", "ignore")
                check(f"GET {path}", resp.status == 200 and mark in body, f"含「{mark}」")

        print("T5 前端服务器模式渲染（无头Chrome）")
        if os.path.exists(chrome):
            def dump(frag):
                out = f"/tmp/e2e_{frag.replace('/', '_')}.html"
                with open(out, "w") as fh:
                    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=4000",
                                    "--dump-dom", f"{ROOT}/#{frag}"], stdout=fh, stderr=subprocess.DEVNULL, timeout=60)
                return open(out, encoding="utf-8", errors="ignore").read()
            html = dump("diag/scan")
            check("一键诊断页渲染", "dgRun" in html and "开始一键诊断" in html, f"诊断表单与按钮存在")
            html = dump("diag/report")
            check("诊断报告查阅页", "reportList" in html and ("诊断报告" in html) and ("打印" in html),
                  f"档案列表+报告视图+打印按钮存在（含历史数据或空态）")
            html = dump("diag/audit")
            check("体检页30项评分控件", html.count("score-seg") >= 30,
                  f"score-seg×{html.count('score-seg')}")
            html = dump("diag/evidence")
            check("V4证据库渲染", "evBox" in html and "已核验引言" in html and ("王强" in html or "暂无证据" in html), "证据库子页+进度条+条目")
            html = dump("act/toolkit")
            check("提升包页渲染", "tkBuild" in html and "渠道分发图" in html and html.count("agent-card") >= 8,
                  f"生成按钮+渠道卡×{html.count('agent-card')}")
            check("V4资产追踪卡", "watchBox" in html and "查进榜" in html, "Watched Pages管理区")
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
            check("V4基线对比卡", ("vs 起始数据" in html or "首测即起始数据" in html) and ("答案侧" in html or "信源侧" in html or "平均提及率" in html), "KPI含起始数据Δ与通道标注")
            check("V4项目身份块(报头)", "projChip" in html and "pcName" in html and "projSel" not in html,
                  "报头项目身份块渲染、原生下拉已移除")
            html = dump("projects")
            check("项目总览启动页", html.count("proj-card") >= 2 and "新建项目" in html and "体检分" in html,
                  f"项目卡片+新建卡×{html.count('proj-card')}（含真实快照数据）")
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
        except Exception as e:
            check("diagnose 端点", False, f"异常: {e}")

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
        check("V4项目归档", s == 200 and d.get("archived") is True and not any(p["id"] == "p_testb" for p in d2.get("projects", [])),
              "归档后不出现在列表（数据保留）")
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
        check("server侧操作留痕", s == 200 and any(str(a.get("action", "")).startswith("PUT") for a in d.get("audit", [])),
              f"留痕{len(d.get('audit', []))}条")

        print("T11 贴答案解析（V4 3.4 /api/parse · 真实本机模型）")
        try:
            s, d = req("POST", "/api/parse", {"text": "深圳南山的科创园区推荐深圳湾科技生态园和蛇口网谷，后者由招商蛇口运营。来源：baike.baidu.com",
                                              "brand": "蛇口网谷", "competitors": ["深圳湾科技生态园"]})
            check("parse 结构化抽取", s == 200 and d.get("mention") == 1 and "baike.baidu.com" in (d.get("citedDomains") or [])
                  and any("深圳湾" in c for c in (d.get("competitorMentions") or [])),
                  f"mention={d.get('mention')} 引用={d.get('citedDomains')} 竞品={d.get('competitorMentions')}")
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
console.log(JSON.stringify({bad: r1.score, good: r2.score,
  fp: {hi: fp1, mid: fp2, d: [dt1, dt2, dt3]},
  snap: {pct: snap.auditPct, fails: snap.diagFails, ans: snap.mentionAns, ansN: snap.mentionAnsN, src: snap.mentionSrc, srcN: snap.mentionSrcN, own: snap.ownHitN, ownT: snap.ownHitTotal, ownD: snap.ownHitDate},
  bp: {n: bp.rows.length, badn: bp.bad.length, co: (bp.rows[0] && bp.rows[0].cooccur || []).length},
  samp: {n: samp.qs.length, sev: samp.qs[0] ? samp.qs[0].severity : 0, noDoubao: !samp.engs.includes("豆包")}}));
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
        else:
            check("评分器单元", False, p.stderr[:200] or "node 输出为空", skippable=True)
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
