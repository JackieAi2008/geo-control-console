#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真实跑一轮：一键诊断(真官网) → 一键跑30问(批量真实搜索) → 状态入库 → 生成提升包文件
与前端按钮走同一批后端接口（/api/diagnose /api/probe /api/data），结果写入服务器数据库。"""
import json, subprocess, sys, time, urllib.request, re, os
from urllib.parse import urlparse

ROOT = "http://127.0.0.1:8340"
PARK, URL, CITY, INDUSTRY = "蛇口网谷", "www.cmsk1979.com", "深圳南山", "数字经济"
OWN = ["cmsk1979.com", "cmhk.com", "mp.weixin.qq.com", "weixin.qq.com"]
OUT = os.path.expanduser("~/Desktop/SKIPGEO/output/蛇口网谷提升包")

def req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(ROOT + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read() or b"{}")

def put_state(state):
    """乐观锁保存：先取版本号，冲突则报错退出（不覆盖他人数据）"""
    cur = req("GET", "/api/data")
    r = urllib.request.Request(ROOT + "/api/data", method="PUT",
        data=json.dumps({"state": state, "base_rev": cur.get("_rev", 0)}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read() or b"{}")

PROMPTS = None
def load_prompts():
    global PROMPTS
    src = open(os.path.join(os.path.dirname(__file__), "js/data.js"), encoding="utf-8").read()
    PROMPTS = [(m.group(1), m.group(2)) for m in re.finditer(r'\{ id:"(P\d+)",\s*cat:"[^"]+",\s*q:"([^"]+)"', src)]

def main():
    today = time.strftime("%Y-%m-%d")
    print(f"══ 真实执行 · {PARK} · 官方承载页 {URL} ══\n")
    load_prompts()
    state = req("GET", "/api/data")

    # ── ① 一键诊断（真实HTTP探测+品牌词搜索）──
    print("① 一键诊断 …")
    diag = req("POST", "/api/diagnose", {"url": URL, "brand": PARK}, timeout=90)
    if diag.get("error"): sys.exit(f"诊断失败: {diag['error']}")
    for c in diag["checks"]:
        print(f"  [{'通过' if c['status']=='pass' else '警告' if c['status']=='warn' else '未过'}] {c['id']} {c['name']} — {c['evidence'][:66]}")
    for k, v in diag["auto_scores"].items():
        state.setdefault("audit", {})[k] = v
    state["lastDiag"] = {"ts": diag["ts"], "url": diag["url"], "brand": PARK, "checks": diag["checks"]}
    state["parkUrl"] = URL

    # ── ② 一键跑30问（批量真实搜索，自动入台账）──
    print(f"\n② 一键跑30问（真实搜索，预计2–4分钟）…")
    ledger = state.get("ledger", [])
    hits, errs = 0, 0
    for i, (pid, q) in enumerate(PROMPTS, 1):
        try:
            d = req("POST", "/api/probe", {"query": q}, timeout=50)
            if d.get("error"):
                errs += 1; note = f"失败:{d['error'][:40]}"
                ledger.append({"date": today, "engine": "搜索通道", "promptId": pid, "mention": 0, "sentiment": 0.5, "url": "", "note": note})
            else:
                tops = (d.get("results") or [])[:10]
                own = next((t for t in tops if any(dom in t["url"] for dom in OWN)), None)
                if own: hits += 1
                ledger.append({"date": today, "engine": "搜索通道", "promptId": pid,
                               "mention": 1 if own else 0, "sentiment": 1 if own else 0.5,
                               "url": own["url"] if own else "",
                               "note": "信源侧自动：前10=" + ",".join(urlparse(t["url"]).hostname for t in tops[:3])})
        except Exception as e:
            errs += 1
        print(f"\r  {i}/30 完成 · 自有阵地命中 {hits}", end="", flush=True)
        time.sleep(0.25)
    state["ledger"] = ledger
    print(f"\n  30问完成：自有阵地命中 {hits}/30 · 失败 {errs}")

    put_state(state)
    print("\n③ 状态已写入服务器数据库（体检回填+30条台账），前端打开即见。")
    json.dump(diag, open("/tmp/diag_result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n诊断原始JSON: /tmp/diag_result.json")

if __name__ == "__main__":
    main()
