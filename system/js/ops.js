/* GEO智控台 V3.2 · 生产操作层（OPS）
 * 真实动作：一键诊断（后端真实HTTP探测）· 一键优化文件（可部署物料生成）· 一键跑30问（批量真实搜索自动入账）
 * 依赖 app.js 的全局：state/save/SERVER_MODE/render/GEO/download/toast/esc/today/SUBS（跨script共享全局词法环境）
 */
"use strict";

const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return u; } };

/* ══════ ① 一键诊断 ══════ */
async function opsDiagnose() {
  if (!SERVER_MODE) {
    toast("一键诊断需要后台：终端执行 python3 server.py 后刷新本页");
    $("#dgOut").innerHTML = '<p style="color:var(--color-bad)">当前为本地模式，无法发起真实探测。请在本文件夹终端运行 <b class="num">python3 server.py</b>，然后浏览器打开 <b class="num">http://localhost:8340</b>。</p>';
    return;
  }
  const url = $("#dgUrl").value.trim(), brand = $("#dgBrand").value.trim();
  if (!url) { toast("请先填写官方承载页域名（如 www.cmsk1979.com）"); return; }
  const btn = $("#dgRun");
  btn.classList.add("is-busy"); btn.textContent = "真实探测中（约10–30秒）…";
  $("#dgOut").innerHTML = `<p class="muted">正在对 <b class="num">${esc(url)}</b> 发起真实联网检查：网站可达性 → AI 爬取许可 → AI 说明文件 → 首页源码分析（内容可读性/结构化数据/标题/图片说明）${brand ? " → 品牌词真实搜索" : ""}。每项结果都附证据，可点开复核。</p>`;
  let res;
  try {
    const r = await fetch("/api/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, brand, ownDomains: curOwn() }) });
    res = await r.json();
  } catch (e) { res = { error: String(e) }; }
  btn.classList.remove("is-busy"); btn.textContent = "开始一键诊断";
  if (res.error) { $("#dgOut").innerHTML = `<p style="color:var(--color-bad)">诊断失败：${esc(res.error)}</p>`; return; }

  let filled = 0, kept = 0;
  Object.entries(res.auto_scores || {}).forEach(([k, v]) => {
    if (Object.prototype.hasOwnProperty.call(state.audit, k)) {
      if ((state.audit[k] || 0) === 0) { state.audit[k] = v; filled++; }   // 只填入未评分项
      else kept++;                                                          // 已有手动评分不覆盖
    }
  });
  state.lastDiag = { ts: res.ts, url: res.url, brand, checks: res.checks };
  state.diagHistory = [JSON.parse(JSON.stringify(state.lastDiag)), ...(state.diagHistory || [])].slice(0, 20);
  state.parkUrl = url; save();
  pushSnapshot("diag");   /* V4 2.1：诊断完成自动记快照（发展曲线数据点） */
  renderDiagResult(res, filled, kept);
  render.dashboard();
}

function renderDiagResult(res, filled, kept) {
  const LV = { pass: "pass", warn: "warn", fail: "fail" }, IC = { pass: "✓", warn: "⚠", fail: "✗" };
  $("#dgOut").innerHTML =
    `<p class="muted">诊断时间 <b class="num">${res.ts}</b> · 对象 <b class="num">${esc(res.url)}</b> · 已自动填入体检表 <b>${filled}</b> 项${kept ? `（${kept} 项已有手动评分，未被覆盖，请在「诊断→30项体检」人工复核）` : ""}</p>` +
    res.checks.map(c => `<div class="chk ${LV[c.status]}"><span class="ico">${IC[c.status]}</span>
      <div><b>${c.id} ${esc(c.name)}</b><span class="why" style="color:var(--color-ink-2)">${esc(c.evidence)}</span></div></div>`).join("") +
    `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" id="dgDl">下载诊断报告(.md)</button>
      <button class="btn btn-ghost" id="dgCopy">复制报告内容</button>
      <a class="btn btn-primary" href="#/diag/report" onclick="RPT_MODE='wo'">生成整改工单 →</a>
      <a class="btn btn-ghost" href="#/diag/report">查阅完整报告 →</a>
      <a class="btn btn-ghost" href="#/diag/audit">去体检表看填入 →</a></div>`;
  $("#dgDl").addEventListener("click", () => {
    const md = diagReportMd(res);
    download(`GEO诊断报告-${res.url}-${today()}.md`, md, "text/markdown");
  });
  $("#dgCopy").addEventListener("click", () => {
    copyText(diagReportMd(res));
    toast("若浏览器未开始下载场景同此：已复制全文，可粘贴到任意文档保存");
  });
}
function diagReportMd(res) {
  const auto = res.auto_scores || (() => {   /* 历史记录未存auto_scores时从checks重算 */
    const m = {};
    (res.checks || []).forEach(c => Object.entries(c.score || {}).forEach(([k, v]) => { m[k] = Math.max(m[k] || 0, v); }));
    return m;
  })();
  return `# 园区GEO一键诊断报告\n> ${res.ts} · 对象 ${res.url} · 证据均来自真实探测\n\n` +
    res.checks.map(c => `- [${c.status.toUpperCase()}] ${c.id} ${c.name}：${c.evidence}`).join("\n") +
    `\n\n> 自动填入体检项：${JSON.stringify(auto)}\n> 下一步：诊断→报告→生成整改工单 派发执行；行动→优化文件 生成部署物料。`;
}

/* ══════ 物料生成器（优化文件与整改工单共用）════════ */
const OPS_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai",
  "PerplexityBot", "Perplexity-User", "Bytespider", "Google-Extended", "CCBot", "Applebot"];
function genRobotsTxt() {
  return "# ── AI 爬虫放行片段（追加到 robots.txt 末尾，勿整文件替换）──\n" +
    OPS_BOTS.map(b => `User-agent: ${b}\nAllow: /`).join("\n\n");
}
function genLlmsTxt(park, url) {
  const op = (typeof projCtx === "function") ? projCtx().operator : "招商蛇口产业园区（招商产园）";
  return `# ${park}\n\n> 官方承载页 https://${url}/ · 运营方：${op}\n\n## 核心事实（数据时点见口径表）\n- 入驻企业：【见口径表】\n- 产业聚集度：【见口径表】\n\n## 页面导航\n- [官方承载页](https://${url}/)\n\n<!-- 更新时间 ${today()} -->`;
}
function genSchema(park, url, city, industry) {
  const op = (typeof projCtx === "function") ? projCtx().operator : "招商蛇口产业园区（招商产园）";
  return `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "${park}",\n  "url": "https://${url}/",\n  "parentOrganization": { "@type": "Organization", "name": "${op}" },\n  "address": { "@type": "PostalAddress", "addressLocality": "${city}", "addressCountry": "CN" },\n  "description": "${park}是${city}${industry}产业园区。",\n  "telephone": "【待填：招商热线】",\n  "knowsAbout": ["${industry}", "产业园区", "企业选址"]\n}\n</script>`;
}

/* ══════ 整改工单（人话行动卡版：五要素+按业务价值排序+可直贴微信的转发消息）════════ */
const RST = ["待派单", "已派单", "已整改", "已验收"];
function rstOf(ts, id) {
  return ((state.remediation || {})[ts] || {})[id] || RST[0];
}
function cycleRst(ts, id) {
  state.remediation = state.remediation || {}; state.remediation[ts] = state.remediation[ts] || {};
  const cur = RST.indexOf(state.remediation[ts][id] || RST[0]);
  state.remediation[ts][id] = RST[(cur + 1) % RST.length];
  if (RST[(cur + 1) % RST.length] === "已验收") addEvent("wo", `工单验收 ${id}`, today());   /* V4 2.2：验收事件上曲线 */
  save(); render.report();
}
function woParts(e) {
  const park = e.brand || ([...new Set(state.caliber.map(r => r.park))][0] || "园区").split("（")[0];
  const city = (state.planInputs && state.planInputs.city) || "深圳";
  const industry = (state.planInputs && state.planInputs.industry) || "数智科技";
  const issues = (e.checks || []).filter(c => c.status !== "pass");
  const byOrder = GEO.woOrder.map(id => issues.find(c => c.id === id)).filter(Boolean)
    .concat(issues.filter(c => !GEO.woOrder.includes(c.id)));
  const SELF = byOrder.filter(c => c.id === "E2a");
  const IT = byOrder.filter(c => c.id !== "E2a");
  return { park, city, industry, issues, SELF, IT };
}
function woCard(c, e, idx) {
  const p = GEO.woPlain[c.id] || {};
  const isSelf = c.id === "E2a";
  const mat = c.id === "T4" ? genSchema(woParts(e).park, e.url, woParts(e).city, woParts(e).industry)
    : c.id === "T5" ? genLlmsTxt(woParts(e).park, e.url)
    : c.id === "T1" ? genRobotsTxt() : "";
  return `<div class="card" style="margin-bottom:12px;${isSelf ? "border-color:var(--color-accent)" : ""}">
    <h3 style="border:none;margin:0 0 4px">第${idx}件事 · ${esc(p.title || c.name)}
      <span class="tag ${rstOf(e.ts, c.id) === "已验收" ? "tag-ok" : rstOf(e.ts, c.id) === "待派单" ? "tag-bad" : "tag-warn"}" data-rst="${esc(e.ts)}|${esc(c.id)}" style="cursor:pointer" title="点击切换：待派单→已派单→已整改→已验收">${rstOf(e.ts, c.id)}</span></h3>
    ${p.what ? `<p style="font-size:var(--text-sm);margin:2px 0"><b>这是什么事：</b>${esc(p.what)}</p>` : ""}
    ${p.why ? `<p style="font-size:var(--text-sm);color:var(--color-ink-2)"><b>为什么值得做：</b>${esc(p.why)}</p>` : ""}
    <p style="font-size:var(--text-sm)"><b>谁来做：</b><span class="tag ${isSelf ? "tag-accent" : "tag-info"}">${esc(p.who || "网站管理员")}</span></p>
    <div style="font-size:var(--text-sm);margin:4px 0"><b>具体怎么做：</b>
      <ol style="margin:4px 0 4px 18px">${(p.steps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      ${mat ? `<pre class="prompt-view" style="max-height:180px;margin-top:6px">${esc(mat)}</pre>
        <button class="btn btn-sm btn-ghost" data-wocp="${c.id}">复制这段材料</button>` : ""}
    </div>
    <p class="muted" style="font-size:12px"><b>怎么算做完了：</b>${isSelf ? "两周后在本系统重跑「一键诊断」和「跑一轮30问」，看品牌词前10与命中率变化" : `回本系统重跑「一键诊断」，${c.id} 从 ✗/⚠ 变 ✓`} · <span class="num">系统编号 ${c.id}</span> · 诊断证据：${esc(c.evidence).slice(0, 60)}…</p>
  </div>`;
}
function buildItMessage(e) {
  const { park, city, industry, IT } = woParts(e);
  const seg = id => IT.find(c => c.id === id);
  let msg = `【请官网管理员（信息部/网站供应商）协助 · 约1小时内的三件小事，材料已是终稿，只需上传/粘贴】\n\n背景：我们做了一次AI搜索提及诊断（系统自动探测），官网以下几处需要技术侧处理：\n`;
  if (seg("T4")) msg += `\n1) 在官网公共模板（或园区介绍页）</head> 前加一段结构化数据，代码在文末①；\n`;
  if (seg("C6")) msg += `${seg("T4") ? "2" : "1"}) 首页6张图片在后台补alt文字（写图片关键信息即可）；\n`;
  if (seg("T5")) msg += `${(seg("T4") && seg("C6")) ? "3" : seg("T4") || seg("C6") ? "2" : "1"})（可选，5分钟）把文末②内容存为 llms.txt 上传到网站根目录。\n`;
  msg += `\n做完请回个消息，我们在系统里重跑诊断验收（对应项变✓即通过）。谢谢！\n`;
  if (seg("T4")) msg += `\n——————\n① 结构化数据代码：\n${genSchema(park, e.url, city, industry)}\n`;
  if (seg("T5")) msg += `\n——————\n② llms.txt 内容：\n${genLlmsTxt(park, e.url)}\n`;
  return msg;
}
function buildWorkOrderHtml(e) {
  const { issues, SELF, IT } = woParts(e);
  if (!issues.length) return '<div class="card"><p style="color:var(--color-ok);font-weight:600">✓ 本报告全部通过，无需整改。</p></div>';
  return `
  <div style="border:2px solid var(--color-accent-navy);border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--color-paper-2)">
    <div style="font-family:var(--font-display);font-weight:700;font-size:var(--text-md)">整改行动清单（共 ${issues.length} 件事，已按重要程度排序）</div>
    <p class="muted" style="margin-top:6px;font-size:13px">你的三步：<b>① 今天</b>做下面「不用等 IT」的第一件事 → <b>② 本周</b>把「转发消息」发给能登录官网后台的人（信息部/网站供应商）——材料系统已出终稿，对方只需上传/粘贴 → <b>③ 下周</b>回「一键诊断」重跑验收。每件事右上的状态标签点击可切换。</p>
  </div>
  <div class="card" style="margin-bottom:12px;border-color:var(--color-accent)">
    <h3>📤 给官网管理员的转发消息（贵司信息部/网站供应商，微信直接粘贴这段）</h3>
    <pre class="prompt-view" style="max-height:260px;white-space:pre-wrap">${esc(buildItMessage(e))}</pre>
    <button class="btn btn-primary btn-sm" id="woCopyMsg">复制整段转发消息</button>
  </div>
  ${SELF.length ? `<p class="kicker">第一部分 · 不用等技术，你自己今天就能做</p>` : ""}
  ${SELF.map((c, i) => woCard(c, e, i + 1)).join("")}
  ${IT.length ? `<p class="kicker" style="margin-top:12px">第二部分 · 需要能登录官网的人处理（终稿物料由本系统「一键优化文件」生成，转发消息里也含代码）</p>` : ""}
  ${IT.map((c, i) => woCard(c, e, (SELF.length ? SELF.length : 0) + i + 1)).join("")}
  <p class="muted" style="font-size:12px">生成 ${today()} · 基于 ${esc(e.ts)} 诊断 · 状态存在本系统 · 全部做完后重跑「跑一轮30问」看素材池变化</p>`;
}
function workOrderMd(e) {
  const { issues, SELF, IT } = woParts(e);
  let md = `# 整改行动清单（共${issues.length}件事，按重要程度排序）\n> 基于 ${e.ts} 诊断 · ${e.url}\n\n## 给网站管理员的转发消息（直接粘贴）\n\n${buildItMessage(e)}\n`;
  let n = 0;
  SELF.forEach(c => { n++; const p = GEO.woPlain[c.id] || {}; md += `\n## 第${n}件事（自己做）· ${p.title || c.name}\n${p.what || ""}\n怎么做：\n${(p.steps || []).map(s => "- " + s).join("\n")}\n验收：重跑诊断/30问\n`; });
  IT.forEach(c => { n++; const p = GEO.woPlain[c.id] || {}; md += `\n## 第${n}件事（IT）· ${p.title || c.name}\n${p.what || ""}\n怎么做：\n${(p.steps || []).map(s => "- " + s).join("\n")}\n验收：重跑一键诊断 ${c.id} 变✓\n`; });
  return md;
}
function woPrintDoc(e) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>整改工单-${e.url}</title>
  <style>body{font-family:"PingFang SC",sans-serif;max-width:820px;margin:24px auto;color:#1a2433;line-height:1.7;padding:0 16px}
  h1{font-size:20px;border-bottom:3px solid #014070;padding-bottom:8px}h2{font-size:15px;margin:16px 0 6px;color:#014070}
  pre{background:#f2f5f9;border:1px solid #ccd6e0;border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-all}
  .m{color:#5b6b7d;font-size:12px}</style></head><body>
  <h1>整改工单</h1><p class="m">基于 ${e.ts} 诊断 · ${e.url} · 证据均为真实探测</p>
  ${workOrderMd(e).split("\n").map(l => l.startsWith("## ") ? `<h2>${l.slice(3)}</h2>` : l.startsWith("```") ? "" : l ? `<p>${l}</p>` : "").join("").replace(/<p>#{1,2} /g, "<p>")}
  <script>window.onload=()=>window.print()<\/script></body></html>`;
}

/* ══════ ② 一键优化文件 ══════ */
function opsBuildToolkit() {
  const ctx = projCtx();
  const park = $("#tkPark").value.trim() || ctx.park || "试点园区";
  const city = $("#tkCity").value.trim() || ctx.city || "深圳";
  const industry = $("#tkIndustry").value.trim() || ctx.industry || "数智科技";
  const url = (state.parkUrl || curProject().url || "").trim() || "www.example.com";
  const op = ctx.operator, opShort = ctx.operatorShort;
  const rows = state.caliber.filter(r => r.park && (r.park.includes(park.slice(0, 2)) || park.includes(r.park.slice(0, 2))));
  const F = {}; rows.forEach(r => { F[r.field] = r.official; });
  const g = (k, d) => F[k] || d;

  const robots = `# ── AI 爬虫放行片段（追加到 robots.txt 末尾，勿整文件替换）──\n` +
    ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai",
     "PerplexityBot", "Perplexity-User", "Bytespider", "Google-Extended", "CCBot", "Applebot"]
      .map(b => `User-agent: ${b}\nAllow: /`).join("\n\n") +
    `\n\n# 提示：若官网使用 Cloudflare/阿里云WAF，还需在控制台「Bot管理」中将上述爬虫加入白名单\n# （Cloudflare 自 2025-07 对新域名默认封锁 AI 爬虫——这是最高频的技术翻车点）`;

  const llms = `# ${park}\n\n> ${city}${industry}产业园区 · 运营方：${op} · 官网 https://${url}\n\n## 核心事实（数据时点见口径表）\n\n- 入驻企业：${g("入驻企业数", "【待填：见口径表】")}\n- 产业聚集度：${g("产业聚集度", "【待填】")}\n- 运营面积：${g("面积", "【待填】")}㎡\n- 主导产业：${industry}\n- 权威背书：${g("行业排名", "【待填：榜单名+年份，引用须写明榜单名】")}\n\n## 页面导航\n\n- [园区官网](https://${url}/)\n- [一园一档页]（部署后把链接更新到这里）\n- [选址FAQ]（部署后把链接更新到这里）\n\n<!-- 更新时间 ${today()} · 责任人：__ -->`;

  const jsonld = `<!-- 结构化数据：贴到园区页面 </head> 前（部署前把【待填】补齐，并对照口径表逐项核对） -->\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "${park}",\n  "alternateName": "${park}（${opShort}）",\n  "url": "https://${url}/",\n  "parentOrganization": { "@type": "Organization", "name": "${op}" },\n  "address": { "@type": "PostalAddress", "addressLocality": "${city}", "addressCountry": "CN" },\n  "areaServed": "${city}",\n  "description": "${park}是${city}${industry}产业园区，入驻企业${g("入驻企业数", "【待填】")}，产业聚集度${g("产业聚集度", "【待填】")}。",\n  "telephone": "【待填：招商热线】",\n  "knowsAbout": ["${industry}", "产业园区", "企业选址"]\n}\n</script>`;

  const profile = `# ${park}（一园一档）\n> 数据截至 ${today()} · 责任人：__ · 数字均取自口径表，发布前逐项核对\n\n## 一句话\n${park}是${op}旗下园区，位于${city}，主导${industry}产业。\n\n## 基本信息表\n| 项目 | 数据 | 时点 |\n|---|---|---|\n| 运营主体 | ${op} | — |\n| 区位交通 | 【待填：地址/地铁线站/距离】 | — |\n| 运营面积 | ${g("面积", "【待填】")} | 【待填】 |\n| 入驻企业 | ${g("入驻企业数", "【待填】")} | 【待填】 |\n| 产业聚集度 | ${g("产业聚集度", "【待填】")} | 【待填】 |\n| 租金区间 | 【待填：元/㎡/月】 | 【待填】 |\n| 龙头企业 | 【待填：500强/上市公司名单】 | — |\n| 权威背书 | ${g("行业排名", "【待填：榜单名+年份】")} | — |\n\n## 选址者最关心的5个问题（FAQ骨架，逐问补答≤300字）\n${P_prompts().filter(p => p.cat === "选址决策").slice(0, 5).map(p => `### ${p.q}\n【答案前置：先给结论+2个硬数据，再展开】`).join("\n\n")}\n\n## 企业说\n${(() => { const qs = (typeof evidenceQuotes === "function") ? evidenceQuotes(park) : [];
  return qs.length ? qs.map(q => `> 「${q.content}」\n> —— ${q.person}${q.title ? "·" + q.title : ""}${q.source ? `（${q.source}）` : ""}`).join("\n\n") : "> 【待采集：入驻企业负责人原话，带姓名职务（在「诊断→证据库」录入已核验引言后，此处自动填充）】"; })()}\n\n*更新时间：${today()} · 责任人：__*`;

  const faqMd = `# ${park} 选址FAQ（20问）\n> 每问一答、答案前置、≤300字、数据取自口径表；答完贴入「诊断→内容评分」≥75分再发布\n\n${[...P_prompts().filter(p => p.cat === "选址决策"), ...P_prompts().filter(p => p.cat === "品牌认知")].slice(0, 20).map((p, i) => `## ${i + 1}. ${p.q}\n【结论句式：${park}……（首个数字：${g("入驻企业数", "企业数【待填】")}；第二个数字：${g("产业聚集度", "聚集度【待填】")}）】\n【展开：区位/载体/政策/服务各一句，数字优先】\n【出处：（来源：口径表/权威榜单，年份）】`).join("\n\n")}`;

  const channelPack = `# ${park} 渠道分发指南\n> 生成 ${today()} · 每个渠道都是真实入口，按顺序执行；先发布、后监测（监测页一键跑30问）\n\n## 第一周（基础层+自有渠道）\n1. 官网：部署 robots 片段 + 结构化数据 + 一园一档页 + FAQ页（文件在左侧已生成）\n2. 百度百科：按口径表更新词条，每个数字附权威来源\n3. 企查查/天眼查：核验运营主体信息\n\n## 第二周起（内容矩阵，按引擎偏好排序）\n${GEO.channels.map((c, i) => `${i + 1}. **${c.name}** — ${c.engine}\n   入口：${c.entry}\n   动作：${c.action}\n   首发：${c.first.replace("{园区}", park).replace("{产业}", industry).replace("{city}", city)}`).join("\n\n")}\n\n## 节奏与红线\n- 节奏：公众号双周 / 知乎月2 / 头条百家随发 / 抖音周1\n- 红线：同一事实多渠道口径必须一致（DeepSeek 对不一致品牌首选率暴跌82%）；禁堆砌夸饰；效果预期 10–15天首批引用、8–12周稳定（行业参考值，以监测台账为准）`;

  const files = [
    { name: "robots-AI放行片段.txt", desc: "追加到官网 robots.txt；若用 CDN/WAF 还需控制台白名单", content: robots },
    { name: "llms.txt", desc: "传到官网根目录（可选项，5分钟成本；Google声明不使用，勿指望它替代内容）", content: llms },
    { name: "schema-结构化数据.html", desc: "贴到园区页 </head> 前，补齐【待填】", content: jsonld },
    { name: "一园一档.md", desc: "官网/公众号/知乎通用的园区标准档案（GEO内容库最小单元）", content: profile },
    { name: "选址FAQ-20问.md", desc: "答案前置的FAQ页源稿，逐问补答后过评分器≥75再发", content: faqMd },
    { name: "渠道分发指南.md", desc: "8个渠道的真实入口、动作与首发内容，按周执行", content: channelPack },
  ];
  window.__tkFiles = files;
  $("#tkOut").innerHTML = files.map((f, i) => `
    <div class="card" style="margin-bottom:12px">
      <h3 style="border:none;margin:0 0 6px">${esc(f.name)}
        <span style="display:flex;gap:6px">
          <button class="btn btn-sm btn-primary" data-tkdl="${i}">下载</button>
          <button class="btn btn-sm btn-ghost" data-tkcp="${i}" title="浏览器限制下载时的兜底：复制全文自行粘贴保存">复制内容</button>
        </span></h3>
      <p class="muted" style="margin-bottom:6px">${esc(f.desc)}</p>
      <pre class="prompt-view" style="max-height:180px">${esc(f.content)}</pre>
    </div>`).join("") +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" id="tkDlAll">打包下载全部（6个文件清单）</button>
      <span class="muted" style="font-size:12px">若浏览器询问保存位置或未开始下载，用各文件「复制内容」即可</span></div>`;
  $$("#tkOut [data-tkdl]").forEach(b => b.addEventListener("click", () => {
    const f = files[+b.dataset.tkdl];
    download(`${park}-${f.name}`, f.content, "text/plain;charset=utf-8");
    registerWatch(`${park}-${f.name}`);   /* V4 2.4：下载即登记资产追踪（部署后补URL、查进榜） */
    renderWatch();
  }));
  $$("#tkOut [data-tkcp]").forEach(b => b.addEventListener("click", () => copyText(files[+b.dataset.tkcp].content)));
  $("#tkDlAll").addEventListener("click", () => {
    files.forEach((f, i) => setTimeout(() => download(`${park}-${f.name}`, f.content, "text/plain;charset=utf-8"), i * 350));
    files.forEach(f => registerWatch(`${park}-${f.name}`));   /* V4 2.4 */
    renderWatch();
    toast("已按顺序下载6个文件并登记资产追踪（浏览器多文件下载需允许）");
  });
  renderChannels(park, industry);
}

function renderChannels(park, industry) {
  const city = (state.planInputs && state.planInputs.city) || (projCtx().city) || "深圳";
  $("#channelBox").innerHTML = GEO.channels.map(c => `
    <div class="card agent-card">
      <h4>${esc(c.name)} <span class="tag tag-gold">${esc(c.engine)}</span></h4>
      <p>${esc(c.action)}</p>
      <p style="color:var(--color-ink-2)"><b>首发：</b>${esc(c.first.replace("{园区}", park).replace("{产业}", industry).replace("{city}", city))}</p>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <a class="btn btn-ghost btn-sm" href="${c.entry}" target="_blank" rel="noopener">打开入口 ↗</a>
        <span class="num" style="font-size:11px;color:var(--color-ink-3);word-break:break-all">${esc(c.entry.replace("https://", ""))}</span>
      </div>
    </div>`).join("");
}

/* ══════ ③ 一键跑30问（信源真实搜索，自动入账）═══════ */
let OPS_STOP = false;
async function opsBatch() {
  if (!SERVER_MODE) {
    toast("需要后台运行：终端执行 python3 server.py 后刷新");
    $("#batchTxt").textContent = "本地模式不可用；团队共享模式下此按钮将逐条真实搜索30问并自动写入台账。";
    return;
  }
  const todayRecs = state.ledger.filter(r => r.engine === "搜索通道" && r.date === today());
  const todayProbes = (state.probes || []).filter(p => p.date === today());
  if ((todayRecs.length || todayProbes.length) && !confirm(`今日已有 ${todayRecs.length} 条「搜索通道」记录。重跑会追加重复记录（对比趋势请隔日再跑，或先在台账删除今日旧记录）。\n\n确定继续追加一轮吗？`)) return;
  OPS_STOP = false;
  const btn = $("#batchRun");
  btn.classList.add("is-busy"); btn.textContent = "真实搜索中…";
  $("#batchStop").hidden = false;
  let done = 0, hits = 0, errs = 0;
  const results = [];
  const OWN = curOwn();   /* V4：自有渠道判定用当前项目域名 */
  state.probes = state.probes || [];   /* V4 1.4：探针全量持久化（top-10 域名+URL，引用诊断视图的数据基础） */
  for (const p of P_prompts()) {
    if (OPS_STOP) break;
    $("#batchBar").style.width = (done / P_prompts().length * 100) + "%";
    $("#batchPct").textContent = Math.round((done / P_prompts().length) * 100) + "%";
    $("#batchTxt").textContent = `${done}/${P_prompts().length} · ${p.id} ${p.q.slice(0, 18)}…`;
    try {
      const r = await fetch("/api/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: p.q, ownDomains: OWN }) });
      const d = await r.json();
      if (d.error) { errs++; }
      else {
        const tops = (d.results || []).slice(0, 10);
        const own = tops.find(t => t.own);        if (own) hits++;
        state.ledger.push({
          date: today(), engine: "搜索通道", promptId: p.id, channel: "src",
          mention: own ? 1 : 0, sentiment: own ? 1 : 0.5,
          url: own ? own.url : "",
          note: "信源自动：前10=" + tops.slice(0, 3).map(t => hostOf(t.url)).join(","),
        });
        state.probes.push({ date: today(), promptId: p.id,
          domains: tops.map(t => hostOf(t.url)), urls: tops.map(t => t.url), ownHit: !!own });
        results.push({ id: p.id, hit: !!own, tops: tops.map(t => hostOf(t.url)) });
      }
    } catch (e) { errs++; }
    done++; save();
    await new Promise(r => setTimeout(r, 250));
  }
  btn.classList.remove("is-busy"); btn.textContent = "跑一轮30问（真实搜索）";
  $("#batchStop").hidden = true;
  $("#batchBar").style.width = "100%";
  $("#batchPct").textContent = "100%";
  $("#batchTxt").innerHTML = `完成 <b class="num">${done}</b>/<span class="num">${P_prompts().length}</span> 问 · 前列出现自有渠道 <b class="num" style="color:${hits ? "var(--color-ok)" : "var(--color-bad)"}">${hits}</b> 问 · 失败 <b class="num">${errs}</b> · 已自动写入下方台账（引擎=搜索通道）` +
    (errs ? ' <span class="tag tag-warn">部分失败可稍后重跑，重复记录可在台账删除</span>' : "");
  pushSnapshot("round");   /* V4 2.1：监测轮完成自动记快照 */
  render.monitor(); render.dashboard();
}

/* ══════ 诊断报告查阅页 ══════ */
function rptCounts(e) {
  const c = { pass: 0, warn: 0, fail: 0 };
  (e.checks || []).forEach(x => c[x.status] = (c[x.status] || 0) + 1);
  return c;
}
let RPT_IDX = 0, RPT_MODE = "report";
render.report = () => {
  let H = state.diagHistory || [];
  if (!H.length && state.lastDiag) {   /* 兼容旧数据：把 lastDiag 升级为历史首条 */
    H = [state.lastDiag]; state.diagHistory = H; save();
  }
  RPT_IDX = Math.min(Math.max(RPT_IDX, 0), H.length - 1);
  if (new URLSearchParams(location.search).get("rpt") === "wo") RPT_MODE = "wo";
  $("#reportList").innerHTML = H.length ? H.map((e, i) => {
    const c = rptCounts(e);
    return `<div class="prompt-li" data-rp="${i}" style="cursor:pointer;${i === RPT_IDX ? "background:var(--color-accent-soft);border-radius:6px" : ""}">
      <span class="code num">${esc(e.ts)}</span>
      <span style="flex:1;min-width:0">${esc(e.url)}${e.brand ? ` ·「${esc(e.brand)}」` : ""}</span>
      <span class="tag ${c.fail ? "tag-bad" : c.warn ? "tag-warn" : "tag-ok"}">${c.fail ? `未过${c.fail}` : c.warn ? `警${c.warn}` : "全过"}</span></div>`;
  }).join("") : '<p class="muted" style="padding:16px 0;text-align:center">还没有诊断记录——先到「一键诊断」跑一次。</p>';
  $$("#reportList [data-rp]").forEach(el => el.addEventListener("click", () => { RPT_IDX = +el.dataset.rp; render.report(); }));
  const e = H[RPT_IDX];
  $("#rptMode").innerHTML = `<button class="chip ${RPT_MODE === "report" ? "on" : ""}" data-rm="report">📄 查阅报告</button>
    <button class="chip ${RPT_MODE === "wo" ? "on" : ""}" data-rm="wo">🛠 整改工单（可派发）</button>`;
  $$("#rptMode [data-rm]").forEach(b => b.addEventListener("click", () => { RPT_MODE = b.dataset.rm; render.report(); }));
  if (!e) { $("#reportView").innerHTML = '<p class="muted">暂无报告</p>'; $("#rptMeta").textContent = ""; return; }
  $("#rptMeta").textContent = `${e.ts} · ${e.url}`;
  if (RPT_MODE === "wo") {
    $("#reportView").innerHTML = buildWorkOrderHtml(e);
    $$("#reportView [data-rst]").forEach(t => t.addEventListener("click", () => {
      const [ts, id] = t.dataset.rst.split("|"); cycleRst(ts, id);
    }));
    const msgBtn = $("#woCopyMsg");
    if (msgBtn) msgBtn.addEventListener("click", () => copyText(buildItMessage(e)));
    $$("#reportView [data-wocp]").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.wocp;
      const mat = id === "T4" ? genSchema(woParts(e).park, e.url, woParts(e).city, woParts(e).industry)
        : id === "T5" ? genLlmsTxt(woParts(e).park, e.url) : genRobotsTxt();
      copyText(mat);
    }));
    $("#rptDl").onclick = () => download(`整改行动清单-${e.url}-${e.ts.slice(0, 10)}.md`, workOrderMd(e), "text/markdown");
    $("#rptCopy").onclick = () => copyText(workOrderMd(e));
    $("#rptPrint").onclick = () => {
      const w = window.open("", "_blank", "width=860,height=920");
      if (!w) { toast("浏览器拦截了打印窗口，请允许弹窗后重试"); return; }
      w.document.write(woPrintDoc(e)); w.document.close();
    };
  } else {
    $("#reportView").innerHTML = buildReportHtml(e);
    $("#rptDl").onclick = () => download(`GEO诊断报告-${e.url}-${e.ts.slice(0, 10)}.md`, diagReportMd(e), "text/markdown");
    $("#rptCopy").onclick = () => copyText(diagReportMd(e));
    $("#rptPrint").onclick = () => {
      const w = window.open("", "_blank", "width=860,height=920");
      if (!w) { toast("浏览器拦截了打印窗口，请允许弹窗后重试"); return; }
      w.document.write(rptPrintDoc(e)); w.document.close();
    };
  }
};
function buildReportHtml(e) {
  const c = rptCounts(e);
  const verdict = c.fail ? "存在阻断项，需整改后再评估内容投放" : (c.warn ? "基本健康，有可优化项" : "全部通过，技术面优秀");
  const vColor = c.fail ? "var(--color-bad)" : c.warn ? "var(--color-warn)" : "var(--color-ok)";
  const LV = { pass: "tag-ok", warn: "tag-warn", fail: "tag-bad" }, IC = { pass: "✓", warn: "⚠", fail: "✗" };
  const advices = (e.checks || []).filter(x => x.status !== "pass");
  return `
  <div style="border:2px solid var(--color-accent-navy);border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--color-paper-2)">
    <div style="font-family:var(--font-display);font-weight:700;font-size:var(--text-md)">园区 GEO 一键诊断报告</div>
    <div class="muted" style="margin:4px 0 10px">对象 <b class="num">${esc(e.url)}</b>${e.brand ? ` · 品牌词「${esc(e.brand)}」` : ""} · ${esc(e.ts)} · 真实 联网检查与搜索取证</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">
      <span style="font-family:var(--font-mono);font-size:var(--text-xl);font-weight:600;color:${vColor}">${verdict}</span>
      <span class="tag tag-ok">通过 ${c.pass}</span><span class="tag tag-warn">警告 ${c.warn}</span><span class="tag tag-bad">未过 ${c.fail}</span>
    </div>
  </div>
  <table class="tbl"><thead><tr><th style="width:44px"></th><th style="width:56px">编号</th><th>检查项</th><th>证据（真实探测）</th></tr></thead>
  <tbody>${(e.checks || []).map(x => `
    <tr><td><span class="tag ${LV[x.status]}">${IC[x.status]}</span></td>
    <td class="num">${esc(x.id)}</td><td><b>${esc(x.name)}</b></td>
    <td style="font-size:12px;color:var(--color-ink-2)">${esc(x.evidence)}</td></tr>`).join("")}
  </tbody></table>
  ${advices.length ? `
  <div class="card" style="margin-top:12px;border-color:var(--color-warn)">
    <h3>整改建议（按报告顺序，${advices.length} 项）</h3>
    <ul class="rule-list">${advices.map(x => `
      <li><b>${x.id} ${esc(x.name)}：</b>${esc(GEO.diagAdvice[x.id] || "见知识库对应条目")} ${x.id === "E2a" || x.id === "T4" || x.id === "T1" || x.id === "T5" ? '<a href="#/act/toolkit" style="color:var(--color-info)">去拿优化文件 →</a>' : ""}</li>`).join("")}
    </ul>
  </div>` : ""}
  <p class="muted" style="margin-top:10px;font-size:12px">建议节奏：技术项（T/C类）交 IT 一周内整改；内容项（E2a）进 90 天方案首批；整改后重跑一键诊断对比本报告。</p>`;
}
function rptPrintDoc(e) {
  const c = rptCounts(e);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>诊断报告-${e.url}-${e.ts}</title>
  <style>body{font-family:"Songti SC","PingFang SC",serif;max-width:820px;margin:24px auto;color:#1a2433;line-height:1.7;padding:0 16px}
  h1{font-size:22px;border-bottom:3px solid #014070;padding-bottom:8px}h3{font-size:15px;margin:18px 0 6px}
  .m{color:#5b6b7d;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#014070;color:#fff;padding:6px 8px;text-align:left}td{border-bottom:1px solid #ccd6e0;padding:6px 8px;vertical-align:top}
  .b{border:2px solid #014070;border-radius:8px;padding:12px 14px;margin:12px 0}
  .tag{display:inline-block;border:1px solid;border-radius:3px;padding:0 6px;font-size:12px;margin-right:4px}
  .ok{color:#1d7a4f;border-color:#1d7a4f}.warn{color:#9a6b0f;border-color:#9a6b0f}.bad{color:#a03030;border-color:#a03030}
  li{margin:6px 0}@media print{body{margin:0}}</style></head><body>
  <h1>园区 GEO 一键诊断报告</h1>
  <p class="m">对象 <b>${esc(e.url)}</b>${e.brand ? ` · 品牌词「${esc(e.brand)}」` : ""} · ${esc(e.ts)} · 证据均为真实探测</p>
  <div class="b"><b>总体结论：</b>${c.fail ? "存在阻断项，需整改后再评估内容投放" : c.warn ? "基本健康，有可优化项" : "全部通过"} —— 通过 ${c.pass} / 警告 ${c.warn} / 未过 ${c.fail}</div>
  <h3>逐项明细</h3><table><tr><th></th><th>编号</th><th>检查项</th><th>证据</th></tr>
  ${(e.checks || []).map(x => `<tr><td><span class="tag ${x.status === "pass" ? "ok" : x.status === "warn" ? "warn" : "bad"}">${x.status === "pass" ? "✓" : x.status === "warn" ? "⚠" : "✗"}</span></td><td>${esc(x.id)}</td><td><b>${esc(x.name)}</b></td><td style="font-size:12px;color:#41506b">${esc(x.evidence)}</td></tr>`).join("")}</table>
  ${(e.checks || []).some(x => x.status !== "pass") ? `<h3>整改建议</h3><ol>${(e.checks || []).filter(x => x.status !== "pass").map(x => `<li><b>${x.id} ${esc(x.name)}：</b>${esc(GEO.diagAdvice[x.id] || "")}</li>`).join("")}</ol>` : ""}
  <p class="m">招商产园 GEO 智控台 · 本报告由真实 联网检查与搜索取证生成</p>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
}
/* ══════ 渲染钩子 & 绑定（脚本置于 body 末尾，DOM 已就绪）═══════ */
render.scan = () => {
  if (state.parkUrl) $("#dgUrl").value = state.parkUrl;
  if (state.lastDiag) renderDiagResult(state.lastDiag, 0);
};
render.toolkit = () => {
  /* V4.2：园区名默认值跟随当前项目（品牌词/项目名），禁止把种子项目（蛇口网谷）带进其他项目 */
  const cur = curProject();
  const want = ((cur.brand || cur.name || "") + "").split("（")[0].trim();
  if ($("#tkPark").dataset.proj !== CUR) {
    const calPark = [...new Set(state.caliber.map(r => r.park))]
      .find(pk => want && (pk.includes(want) || want.includes(pk.split("（")[0])));
    $("#tkPark").value = calPark ? calPark.split("（")[0] : want;
    $("#tkPark").dataset.proj = CUR;
  }
  render.content();  /* 选题单 表单选项填充（复用） */
  if ($("#channelBox").children.length === 0) renderChannels(cur.brand || cur.name || "试点园区", "数智科技");
};
document.addEventListener("DOMContentLoaded", () => {
  const dg = $("#dgRun"); if (dg) dg.addEventListener("click", opsDiagnose);
  const tk = $("#tkBuild"); if (tk) tk.addEventListener("click", opsBuildToolkit);
  const br = $("#batchRun"); if (br) br.addEventListener("click", opsBatch);
  const bs = $("#batchStop"); if (bs) bs.addEventListener("click", () => { OPS_STOP = true; bs.hidden = true; });
  /* 复制兜底：方案与选题单 */
  const pc = $("#planCopy"); if (pc) pc.addEventListener("click", () => {
    const t = $("#planPreview").textContent || "";
    t.startsWith("# ") ? copyText(t) : toast("请先生成方案");
  });
  const bc = $("#briefCopy"); if (bc) bc.addEventListener("click", () => {
    const t = $("#briefOut").textContent || "";
    t.startsWith("# ") ? copyText(t) : toast("请先生成选题单");
  });
});
