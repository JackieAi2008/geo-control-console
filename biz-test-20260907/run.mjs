/* 业务测试编排器：起本地服务（GEO_MOCK_ARK=1，AI代问走罐头）→ 跑 A–E 五组共 60 轮 → 出报告
 * 用法：node biz-test-20260907/run.mjs [组名...]   例如 node run.mjs A B / 默认全跑
 * 产物：biz-test-20260907/report.json + report.md + issues.md（供产品经理分析）
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, RESULTS } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const PORT = 8361;
const ROOT = `http://127.0.0.1:${PORT}`;
const DB = "/tmp/biztest-20260907.db";

const server = spawn("python3", [path.join(REPO, "system", "server.py"), "--port", String(PORT), "--db", DB], {
  cwd: path.join(REPO, "system"),
  env: { ...process.env, GEO_MOCK_ARK: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.stderr.write("[srv] " + d));

const waitServer = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${ROOT}/api/ping`);
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server 未就绪");
};

const only = process.argv.slice(2);
/* db 生命周期：全量跑（无参）或跑 A 组或显式 fresh = 全新库；续跑 B–E 保留 A 建的项目 */
if (!only.length || only.includes("A") || only.includes("fresh")) { try { fs.rmSync(DB); } catch (e) {} }

let browser;
try {
  await waitServer();
  console.log(`○ 服务就绪 ${ROOT}（GEO_MOCK_ARK=1 · db=${DB}）`);
  browser = await launchBrowser();

  const areas = { A: "runAreaA", B: "runAreaB", C: "runAreaC", D: "runAreaD", E: "runAreaE" };
  for (const [k, fn] of Object.entries(areas)) {
    if (only.length && !only.includes(k)) continue;
    const mod = await import(`./rounds${{ A: 1, B: 2, C: 3, D: 4, E: 5 }[k]}.mjs`);
    console.log(`\n══ ${mod.AREA} ══`);
    await mod[fn](browser, ROOT);
  }
} catch (e) {
  console.error("✗ 编排异常：", e);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();

  /* ── 报告 ── */
  const pass = RESULTS.filter((r) => r.status === "PASS").length;
  const issueR = RESULTS.filter((r) => r.status === "ISSUE").length;
  const errR = RESULTS.filter((r) => r.status === "ERROR").length;
  const issues = RESULTS.flatMap((r) => r.issues.map((i) => ({ round: r.id, roundName: r.name, ...i })));
  const bySev = { P0: issues.filter((i) => i.sev === "P0"), P1: issues.filter((i) => i.sev === "P1"), P2: issues.filter((i) => i.sev === "P2") };
  fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify({ pass, issueRounds: issueR, errorRounds: errR, total: RESULTS.length, results: RESULTS }, null, 2));
  if (only.length) fs.copyFileSync(path.join(HERE, "report.json"), path.join(HERE, `report-${only.join("")}.json`));
  const md = [
    `# 业务测试报告（${new Date().toISOString().slice(0, 16).replace("T", " ")}）`,
    `共 ${RESULTS.length} 轮：✓ ${pass} 通过 · ⚠ ${issueR} 轮发现问题 · ✗ ${errR} 轮异常`,
    `问题合计 ${issues.length} 项（P0 ${bySev.P0.length} · P1 ${bySev.P1.length} · P2 ${bySev.P2.length}）`, "",
    "| 轮次 | 场景 | 结果 | 问题 |", "|---|---|---|---|",
    ...RESULTS.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${r.issues.map((i) => `[${i.sev}]${i.title}`).join("；") || (r.errors[0] ? "异常:" + r.errors[0].slice(0, 60) : "") } |`),
    "", "## 问题明细", "",
    ...issues.map((i) => `### [${i.sev}] ${i.title}\n- 轮次：${i.round} ${i.roundName}\n- 详情：${i.detail || "—"}\n- 证据：${i.evidence || "—"}`),
    "", "## 业务观察（未判缺陷）", "",
    ...RESULTS.flatMap((r) => r.notes.map((n) => `- ${r.id}：${n}`)),
  ].join("\n");
  fs.writeFileSync(path.join(HERE, "report.md"), md);
  console.log(`\n════ 汇总：${RESULTS.length} 轮 · ✓${pass} ⚠${issueR} ✗${errR} · 问题 ${issues.length} 项（P0 ${bySev.P0.length}/P1 ${bySev.P1.length}/P2 ${bySev.P2.length}）`);
  console.log(`报告：biz-test-20260907/report.md`);
}
