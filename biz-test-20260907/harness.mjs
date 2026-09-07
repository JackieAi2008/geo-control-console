/* 业务测试 harness：puppeteer 会话 + mock 层 + 断言与问题记录
 * 用法见 run.mjs。所有轮次共享同一本地服务（GEO_MOCK_ARK=1，AI代问走罐头通道），
 * /api/probe 与 /api/diagnose 默认拦截为确定性罐头（真实网络路径由 e2e T3/T7 覆盖）。
 */
import path from "node:path";
import { createRequire } from "node:module";

const GLOBAL_NM = "/Users/jackieai/.nvm/versions/node/v24.18.0/lib/node_modules";
const require = createRequire(path.join(GLOBAL_NM, "noop.js"));
const puppeteer = require("puppeteer-core");
export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--disable-gpu", "--no-sandbox", "--window-size=1440,960", "--lang=zh-CN"],
    defaultViewport: { width: 1440, height: 960 },
  });
}

/* ── mock 数据（与 server.py diagnose()/run_probe() 返回结构同构）── */
export const MOCK_PROBE_RESULTS = (q) => ({
  query: q,
  results: [
    { title: "官网介绍-测试.Mock", url: "https://www.cmsk1979.com/intro", own: true },
    { title: "百度百科词条", url: "https://baike.baidu.com/item/mock", own: false },
    { title: "知乎讨论", url: "https://www.zhihu.com/question/mock", own: false },
    { title: "企查查", url: "https://www.qcc.com/firm/mock", own: false },
    { title: "新闻稿", url: "https://www.sohu.com/a/mock", own: false },
  ],
});
export const MOCK_DIAG_SITE = {
  url: "www.mockpark.cn", https_url: "https://www.mockpark.cn/", mode: "site",
  ts: "2026-09-07 10:00",
  checks: [
    { id: "T1a", name: "HTTPS 可达", status: "pass", evidence: "GET https://www.mockpark.cn/ → 200", score: { T1: 2 } },
    { id: "T1b", name: "HTTP 行为", status: "pass", evidence: "GET http://www.mockpark.cn/ → 301", score: {} },
    { id: "T1", name: "robots.txt / WAF", status: "warn", evidence: "GET /robots.txt → 404（未获取到robots.txt）", score: { T1: 1 } },
    { id: "T5", name: "llms.txt（可选项）", status: "warn", evidence: "GET /llms.txt → 404", score: { T5: 0 } },
    { id: "T2", name: "服务端渲染（源码可读文本量）", status: "fail", evidence: "首页HTML源码去标签后有效字符 ≈ 120（过低=内容依赖JS渲染或图片化）", score: { T2: 0 } },
    { id: "T4", name: "Schema 结构化数据", status: "fail", evidence: "未检出 JSON-LD 结构化数据", score: { T4: 0 } },
    { id: "C2", name: "标题与页面描述", status: "warn", evidence: "title=「测试园区」；description=「简介」", score: { C2: 1 } },
    { id: "C6", name: "图片文字替代（alt覆盖率）", status: "warn", evidence: "首页图片 6 张，2 张有alt（33%）", score: { C6: 1 } },
    { id: "E2a", name: "品牌词搜索·自有阵地", status: "pass", evidence: "前10含自有阵地：www.mockpark.cn",
      score: { E2: 1 }, top_domains: ["www.mockpark.cn", "baike.baidu.com", "www.zhihu.com"],
      tops: [
        { title: "官网介绍-测试.Mock", url: "https://www.cmsk1979.com/intro", own: true },
        { title: "百度百科词条", url: "https://baike.baidu.com/item/mock", own: false },
        { title: "中介平台房源", url: "https://www.mock-zhongjie.com/park/mock", own: false },
        { title: "网友点评", url: "https://www.mock-dianping.com/review/mock", own: false },
      ] },
  ],
  auto_scores: { T1: 2, T5: 0, T2: 0, T4: 0, C2: 1, C6: 1, E2: 1 },
};
export const MOCK_DIAG_ENTITY = {
  url: "", mode: "entity", ts: "2026-09-07 10:05", brand: "测试大厦",
  checks: [
    { id: "E2a", name: "品牌词搜索·自有渠道", status: "fail", evidence: "搜索「测试大厦」前10全部为第三方：mock-zhongjie.com、mock-dianping.com…",
      score: { E2: 0 },
      top_domains: ["www.mock-zhongjie.com", "www.mock-dianping.com", "baike.baidu.com", "www.mockpark.cn"],
      tops: [
        { title: "中介平台房源", url: "https://www.mock-zhongjie.com/park/mock", own: false },
        { title: "网友点评", url: "https://www.mock-dianping.com/review/mock", own: false },
        { title: "百度百科词条（内容陈旧）", url: "https://baike.baidu.com/item/mock", own: false },
        { title: "集团官网新闻", url: "https://www.mockgroup.cn/news/1", own: false },
      ] },
    { id: "E1", name: "百科词条", status: "warn", evidence: "检出百科词条，但数据时点不明（人工核实：与口径表逐项比对）", score: {} },
    { id: "E6", name: "企业信息平台", status: "warn", evidence: "企查查可检索到运营主体（人工核实：名称/法人/地址一致性）", score: {} },
    { id: "E4", name: "权威信源覆盖", status: "fail", evidence: "前10未检出政府/权威媒体报道", score: {} },
  ],
  auto_scores: { E2: 0 },
};

export class Session {
  constructor(browser, root, name = "s") {
    this.browser = browser; this.root = root; this.name = name;
    this.dialogs = []; this.dialogPolicy = "accept"; this.promptText = undefined;
    this.mocks = { probe: true, diagnose: true, pingFail: false, brandcheck: true };  // 默认全 mock（业务测试关注 UI/业务逻辑）
    this.mockDiagSite = null; this.mockDiagEntity = null; // 允许轮次覆写
    this.page = null; this.ctx = null;
  }
  async start() {
    this.ctx = await this.browser.createBrowserContext();
    this.page = await this.ctx.newPage();
    const p = this.page;
    // 去除无头 Chrome 的 navigator.webdriver 标记（tour/自动播放守卫会拦自动化环境，业务测试要还原真实浏览器行为）
    await p.evaluateOnNewDocument(() => {
      try { Object.defineProperty(navigator, "webdriver", { get: () => false }); } catch (e) {}
    });
    p.setDefaultTimeout(9000);
    p.on("dialog", async (d) => {
      this.dialogs.push({ type: d.type(), msg: d.message().slice(0, 200) });
      try {
        if (this.dialogPolicy === "accept") await d.accept(this.promptText);
        else await d.dismiss();
      } catch (e) { /* 已被处理 */ }
    });
    p.on("pageerror", (e) => { this.pageErrors = (this.pageErrors || []); this.pageErrors.push(String(e).slice(0, 200)); });
    await p.setRequestInterception(true);
    p.on("request", async (req) => {
      const u = req.url();
      try {
        if (this.mocks.pingFail && u.includes("/api/ping")) return req.abort("failed").catch(() => {});
        if (this.mocks.brandcheck && u.includes("/api/brandcheck")) {
          return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ambiguity: false }) });
        }
        if (this.mocks.probe && req.method() === "POST" && u.includes("/api/probe")) {
          const body = JSON.parse(req.postData() || "{}");
          return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROBE_RESULTS(body.query || "")) });
        }
        if (this.mocks.diagnose && req.method() === "POST" && u.includes("/api/diagnose")) {
          const body = JSON.parse(req.postData() || "{}");
          const canned = body.mode === "entity" ? (this.mockDiagEntity || MOCK_DIAG_ENTITY) : (this.mockDiagSite || MOCK_DIAG_SITE);
          const out = JSON.parse(JSON.stringify(canned));
          if (body.brand) out.brand = body.brand;
          if (body.mode !== "entity" && body.url) out.url = body.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
        }
      } catch (e) { /* fallthrough */ }
      return req.continue().catch(() => {});
    });
    return this;
  }
  async goto(hash = "") {
    const url = hash.startsWith("?") ? this.root + "/" + hash : this.root + "/" + (hash ? "#" + hash : "");
    if (this.page.url().startsWith(this.root)) {
      await this.page.evaluate(async () => {
        try { if (typeof serverSave === "function" && SERVER_MODE) await serverSave(); } catch (e) {}
      }).catch(() => {});
    }
    await this.page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
    await this.page.evaluate(() => {
      window.__dlLog = window.__dlLog || [];
      if (typeof window.download === "function" && !window.__dlPatched) {
        window.__dlPatched = true;
        window.download = (f, c, m) => { window.__dlLog.push({ f, head: String(c || "").slice(0, 500) }); };
      }
    });
    await this.sleep(250);
  }
  async reload() { await this.page.reload({ waitUntil: "networkidle2" }); await this.sleep(400); }
  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  /* —— DOM helpers —— */
  async q(sel) { return this.page.$(sel); }
  async count(sel) { return this.page.$$eval(sel, (els) => els.length).catch(() => 0); }
  async exists(sel) { return (await this.count(sel)) > 0; }
  async visible(sel) {
    return this.page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return !el.hidden && r.width > 0 && r.height > 0;
    }, sel).catch(() => false);
  }
  async txt(sel) { return this.page.$eval(sel, (el) => el.innerText.replace(/\s+/g, " ").trim()).catch(() => ""); }
  async txtAll(sel) { return this.page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim())).catch(() => []); }
  async val(sel) { return this.page.$eval(sel, (el) => el.value).catch(() => null); }
  async attr(sel, name) { return this.page.$eval(sel, (el) => el.getAttribute(name)).catch(() => null); }
  async fill(sel, v) { await this.page.waitForSelector(sel, { visible: true }); await this.page.evaluate((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, sel, v); }
  async pick(sel, v) { await this.page.waitForSelector(sel, { visible: true }); await this.page.evaluate((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, sel, v); }
  async click(sel) { await this.page.waitForSelector(sel, { visible: true }); await this.page.click(sel); await this.sleep(120); }
  async clickText(sel, contains) {
    const handle = await this.page.evaluateHandle((s, t) => Array.from(document.querySelectorAll(s)).find((e) => e.innerText.includes(t)), sel, contains);
    const el = handle.asElement();
    if (!el) throw new Error(`clickText: ${sel} 含「${contains}」的元素不存在`);
    await el.click(); await this.sleep(150);
  }
  async waitCard(name, timeout = 8000) {
    await this.page.waitForFunction((t) => {
      const cards = Array.from(document.querySelectorAll(".proj-card"));
      return cards.some(c => c.innerText.includes(t) && !c.classList.contains("archived"));
    }, { timeout }, name);
  }
  async ev(fn, ...args) { return this.page.evaluate(fn, ...args); }
  async waitForText(sel, substr, timeout = 6000) {
    await this.page.waitForFunction((s, t) => {
      const el = document.querySelector(s);
      return el && el.innerText.includes(t);
    }, { timeout }, sel, substr);
  }
  async toast(substr = "", timeout = 5000) {
    try {
      await this.page.waitForFunction((t) => {
        const el = document.querySelector("#toast");
        return el && el.classList.contains("show") && (!t || el.textContent.includes(t));
      }, { timeout }, substr);
      return await this.txt("#toast");
    } catch (e) { return null; }
  }
  async dl() { return this.ev(() => (window.__dlLog || []).slice()); }
  async shot(name) { await this.page.screenshot({ path: path.join(process.cwd(), "biz-test-20260907", "shots", name + ".png"), fullPage: false }).catch(() => {}); }
  /* —— 业务 seeding：在页面上下文直接改 state 并保存 —— */
  seed(fnStr) {
    return this.page.evaluate((code) => { (0, eval)(code); save(); }, fnStr);
  }
  /* —— 快捷：通过 UI 新建项目 —— */
  async mkProj(o = {}) {
    await this.goto("projects");
    await this.page.waitForSelector("#pjNew", { visible: true, timeout: 6000 }).catch(() => {});
    await this.sleep(300);
    await this.click("#pjNew");
    await this.fill("#npName", o.name || "测试园区A");
    const mode = o.mode || "own";
    await this.page.evaluate((m) => {
      const el = document.querySelector(`input[name="npMode"][value="${m}"]`);
      if (el) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
    }, mode);
    if (mode !== "none") await this.fill("#npUrl", o.url || "www.mockpark.cn");
    if (o.brand) await this.fill("#npBrand", o.brand);
    if (o.city) await this.fill("#npCity", o.city);
    if (o.ind) await this.fill("#npInd", o.ind);
    if (o.comp) await this.fill("#npComp", o.comp);
    if (o.operator) await this.fill("#npOperator", o.operator);
    if (o.tier) await this.page.evaluate((t) => {
      const el = document.querySelector(`input[name="npTier"][value="${t}"]`);
      if (el) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
    }, o.tier);
    if (o.own) await this.fill("#npOwn", o.own);
    await this.click("#npSubmit");
    await this.sleep(600);
  }
  async close() {
    // flush：防抖中的 serverSave 立即落库（否则 incognito 上下文销毁会取消未触发的 PUT）
    await this.page.evaluate(async () => {
      try { if (typeof serverSave === "function" && SERVER_MODE) await serverSave(); } catch (e) {}
    }).catch(() => {});
    await this.ctx.close().catch(() => {});
  }
}

/* ── 轮次运行器 ── */
export const RESULTS = [];
export async function runRound(def) {
  const rec = { id: def.id, name: def.name, area: def.area, status: "PASS", issues: [], notes: [], errors: [] };
  const issue = (sev, title, detail = "", evidence = "") => {
    rec.issues.push({ sev, title, detail, evidence });
    rec.status = "ISSUE";
    console.log(`    ⚠ [${sev}] ${title}`);
  };
  const note = (t) => rec.notes.push(t);
  const expect = (cond, title, opts = {}) => {
    if (!cond) issue(opts.sev || "P2", title, opts.detail || "", opts.evidence || "");
    else console.log(`    ✓ ${title}`);
    return !!cond;
  };
  const t0 = Date.now();
  try {
    await def.fn({ issue, note, expect, rec });
  } catch (e) {
    rec.status = "ERROR";
    rec.errors.push(String(e && e.message || e).slice(0, 300));
    console.log(`    ✗ 异常: ${e && e.message}`);
  }
  rec.ms = Date.now() - t0;
  RESULTS.push(rec);
  const tag = rec.status === "PASS" ? "✓" : (rec.status === "ERROR" ? "✗" : "⚠");
  console.log(`  ${tag} ${def.id} ${def.name} — ${rec.status}${rec.issues.length ? `（${rec.issues.length} 项问题）` : ""}${rec.ms > 3000 ? ` [${(rec.ms / 1000).toFixed(1)}s]` : ""}`);
  return rec;
}
