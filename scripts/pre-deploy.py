#!/usr/bin/env python3
"""GEO 发版闸门：跑 e2e 全量测试，必须全绿才允许 push。
失败 → exit 1，中止发版；成功 → 写摘要到 /tmp/geo-release-summary.txt 供 commit-msg hook 使用。
用法：git push 前执行 scripts/pre-deploy.sh（bash 包装调本脚本）。"""
import os, re, subprocess, sys, time
from datetime import datetime

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
print("=" * 60)
print("  GEO 发版闸门：跑 e2e 全量测试")
print("=" * 60)

env = dict(os.environ)
env["GEO_MOCK_ARK"] = "1"
try:
    r = subprocess.run(
        [sys.executable, "system/test_e2e.py"],
        env=env, capture_output=True, text=True, timeout=540
    )
    out = r.stdout + r.stderr
except subprocess.TimeoutExpired:
    out = "e2e 超时（540 秒），视为失败"
except Exception as e:
    out = f"e2e 启动失败：{e}"

print(out)
last = ""
for line in out.splitlines():
    if line.startswith("══ "):
        last = line
if not last:
    print("\n✗ 闸门：e2e 输出中找不到汇总行，视为失败")
    open("/tmp/geo-release-summary.txt", "w").write("FAIL")
    sys.exit(1)

m = re.search(r"(\d+) 通过.*?(\d+) 失败", last)
if not m:
    print("\n✗ 闸门：无法从汇总行解析通过/失败数，视为失败")
    open("/tmp/geo-release-summary.txt", "w").write("FAIL")
    sys.exit(1)

pass_n, fail_n = int(m.group(1)), int(m.group(2))
print("\n" + "=" * 60)
print(f"  闸门结论：通过 {pass_n} · 失败 {fail_n}")
print("=" * 60)

summary_path = "/tmp/geo-release-summary.txt"
ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

if fail_n > 0:
    print(f"\n✗ 有失败项，闸门拦下，不允许 push 到 main。修复后重新跑此脚本。")
    with open(summary_path, "w") as f:
        f.write(f"FAIL (e2e 通过 {pass_n} 失败 {fail_n} {ts})")
    sys.exit(1)

print(f"✓ e2e 全绿，可以 push。摘要已写入 {summary_path}（commit-msg hook 会读取）。")
with open(summary_path, "w") as f:
    f.write(f"PASS (e2e {pass_n} 通过 0 失败 {ts})")
sys.exit(0)
