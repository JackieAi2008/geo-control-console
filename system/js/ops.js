/* GEO智控台 V3.2 · 生产操作层（OPS）
 * 真实动作：一键诊断（后端真实HTTP探测）· 一键优化文件（可部署物料生成）· 一键跑30问（批量真实搜索自动入账）
 * 依赖 app.js 的全局：state/save/SERVER_MODE/render/GEO/download/toast/esc/today/SUBS（跨script共享全局词法环境）
 */
"use strict";

const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return u; } };

/* V5.1 档位感知的载体名词：轻量版（单楼宇/单体）用楼宇语境，其余用园区语境 */
function venueNoun() {
  try { return ((curProject() || {}).matrixTier === "lite") ? "商务楼宇" : "产业园区"; }
  catch (e) { return "产业园区"; }
}

/* ══════ ① 一键诊断（V4.5 双模式：官网体检 / 实体体检·无官网可做）══════ */
let DG_MODE = null;   /* null=跟随项目承载形态：无官网项目默认实体体检 */
let DG_FILL_FOR = null;   /* V0.1.11 诊断表单按项目隔离：SPA 切换不刷新页面，常驻 DOM 输入框会残留上个项目的值
                             （线上实例：进蛇口网谷，品牌词却显示新时代广场的「深圳新时代广场」）；
                             项目 id 变了→清空表单+模式回默认，再按当前项目重填 */
function dgMode() { return DG_MODE || (noSite() ? "entity" : "site"); }
function setDgMode(m) {
  DG_MODE = m;
  const isSite = m === "site";
  const bS = $("#dgModeSite"), bE = $("#dgModeEntity"), f = $("#dgSiteForm");
  if (!bS || !bE || !f) return;
  bS.classList.toggle("on", isSite); bE.classList.toggle("on", !isSite);   /* V4.7.5 chip→seg-item 同名 on 态 */
  f.hidden = !isSite;
  $("#dgHelp").hidden = !isSite; $("#dgHelpEntity").hidden = isSite;
  $("#dgRun").textContent = isSite ? "开始一键诊断" : "开始实体体检";
  renderDiagPreview();   /* V0.1.8：切模式同步刷新预检清单（有结果时结果区不被本函数触碰） */
}
/* V0.1.8 空态预检清单：只预告「将查什么」，不出示任何未测结果（不编造数据）。
   V0.1.12 串页修复：renderDiagResult 会整体替换 #dgOut（连带销毁内部 #dgPreview），
   故预览必须直接写 #dgOut——否则换个项目进来时旧项目的诊断结果残留在 DOM 里（BUG#1a）。 */
function renderDiagPreview() {
  const box = $("#dgOut"); if (!box) return;
  if (box.querySelector(".dg-head")) return;   /* 结果已显示时不覆盖（模式切换只刷新无结果时的预检清单，原 #dgPreview 销毁语义等价实现） */
  const isSite = dgMode() === "site";
  const PLAN = isSite ? [
    ["技术可达", ["网站可达性与 HTTPS 证书", "robots.txt 是否放行 AI 爬虫", "llms.txt AI 说明文件（可选项）", "首页源码正文量（是否依赖 JS 渲染）", "Schema 结构化数据标记"]],
    ["内容可摘录", ["标题与页面描述", "图片 alt 覆盖率"]],
    ["实体与权威", ["品牌词真实搜索：自有阵地是否进前 10"]],
  ] : [
    ["实体与权威", ["品牌词真实搜索：自有渠道是否进前 10", "百科词条", "企业信息平台", "权威信源覆盖"]],
  ];
  box.innerHTML = `<div class="dg-preview">
    <h3 style="border:none;margin:0">将检查什么 <span class="hint">预检清单 · 真实探测完成后，结果按维度分组显示在这里，每项附证据</span></h3>
    <div class="dg-grid">${PLAN.map(([dim, items]) => `
      <div class="card dg-dim"><h3>${dim} <span class="hint">${items.length} 项</span></h3>
        ${items.map(t => `<div class="chk is-todo"><span class="ico">·</span><div><b>${t}</b></div></div>`).join("")}
      </div>`).join("")}</div>
    <p class="muted" style="font-size:var(--text-xs);margin:10px 0 0">${isSite
      ? "以上为预检清单——点上方「开始一键诊断」发起真实联网检查（约 10–30 秒）；结果可直接下载报告发给网站管理员或外包执行整改。"
      : "实体体检另附 <b>12 项实体资产核对清单</b>（地图POI/百科/公众号等人工核对项），探测完成后出现在结果下方，打分直接计入体检表。"}</p>
  </div>`;
}
async function opsDiagnose() {
  if (!SERVER_MODE) {
    toast("一键诊断需要后台：终端执行 python3 server.py 后刷新本页");
    $("#dgOut").innerHTML = '<p style="color:var(--color-bad)">当前为本地模式，无法发起真实探测。请在本文件夹终端运行 <b class="num">python3 server.py</b>，然后浏览器打开 <b class="num">http://localhost:8340</b>。</p>';
    return;
  }
  const mode = dgMode();
  const url = $("#dgUrl").value.trim(), brand = $("#dgBrand").value.trim();
  if (mode === "site" && !url) { toast("请先填写官方承载页域名（如 www.cmsk1979.com）；确实没有官网就切「实体体检」"); return; }
  if (mode === "entity" && !brand) { toast(`实体体检以品牌词为检查对象，请先填写品牌词（如：${projCtx().park}）`); return; }
  const btn = $("#dgRun");
  btn.classList.add("is-busy"); btn.textContent = mode === "site" ? "真实探测中（约10–30秒）…" : "真实搜索中（约5–15秒）…";
  $("#dgOut").innerHTML = mode === "site"
    ? `<p class="muted">正在对 <b class="num">${esc(url)}</b> 发起真实联网检查：网站可达性 → AI 爬取许可 → AI 说明文件 → 首页源码分析（内容可读性/结构化数据/标题/图片说明）${brand ? " → 品牌词真实搜索" : ""}。每项结果都附证据，可点开复核。</p>`
    : `<p class="muted">正在以品牌词「<b class="num">${esc(brand)}</b>」做真实搜索，检查本项目在网上的存在感：自有渠道是否进前 10 → 百科词条 → 企业信息平台 → 权威信源覆盖。每项结果都附证据与人工核实方法。</p>`;
  let res;
  try {
    const r = await fetch("/api/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, brand, ownDomains: curOwn(), mode }) });
    res = await r.json();
  } catch (e) { res = { error: String(e) }; }
  btn.classList.remove("is-busy"); btn.textContent = mode === "site" ? "开始一键诊断" : "开始实体体检";
  if (res.error) { $("#dgOut").innerHTML = `<p style="color:var(--color-bad)">诊断失败：${esc(res.error)}</p>`; return; }

  const { filled, kept } = applyAutoScores(res.auto_scores);   /* V0.1.10：稀疏 audit 也认合法体检项 id；填入记「自动」痕 */
  res.brand = brand;   /* V4.5：实体体检报告/历史记录展示用 */
  /* V0.1.12 头条口径修复（BUG#1b）：填入结果随诊断结果一起持久化——
     重渲染（切项目回来/刷新）时头条如实反映该次诊断的事实，而不是按 0/0 重算成「本次无自动可评项」 */
  res.autoFilled = filled; res.autoKept = kept;
  state.lastDiag = { ts: res.ts, url: res.url, brand, checks: res.checks, mode: res.mode || "site",
                    autoFilled: filled, autoKept: kept };
  state.diagHistory = [JSON.parse(JSON.stringify(state.lastDiag)), ...(state.diagHistory || [])].slice(0, 20);
  if ((res.mode || "site") === "site") state.parkUrl = url;   /* 实体体检不动承载页地址 */
  save();
  pushSnapshot("diag");   /* V4 2.1：诊断完成自动记快照（发展曲线数据点） */
  renderDiagResult(res, filled, kept);
  render.dashboard();
}

/* V4.5 实体资产核对清单（无官网项目主战场）：核对后打分直接计入体检表同编号项
   V0.1.8：改为维度卡分组（与检查结果/体检表同构），打分键并入行内右对齐 */
function entityChecklistHtml() {
  return GEO.entityChecklist.map(g => `
    <div class="card dg-dim"><h3>${esc(g.dim)} <span class="hint">${g.items.length} 项</span></h3>
    ${g.items.map(i => `
      <div class="audit-item">
        <div class="q"><span class="code">${i.id}</span><span class="t">${esc(i.t)}</span>
          <span class="score-seg" role="radiogroup" aria-label="${esc(i.id)}打分">
          ${[0, 1, 2].map(v => `<button data-echk="${i.id}" data-v="${v}" class="${state.audit[i.id] === v ? "on-" + v : ""}" aria-pressed="${state.audit[i.id] === v}">${v}</button>`).join("")}
          </span></div>
        <div class="std"><b>核对什么：</b>${esc(i.what)}　<b>怎么核对：</b>${esc(i.how)}</div>
      </div>`).join("")}</div>`).join("");
}
function bindEntityChecklist() {
  $$("#dgChk [data-echk]").forEach(b => b.addEventListener("click", () => {
    state.audit[b.dataset.echk] = +b.dataset.v;
    if (state.autoAudit) delete state.autoAudit[b.dataset.echk];   /* 人工点分=转人工 */
    save();
    $("#dgChk").innerHTML = entityChecklistHtml();
    bindEntityChecklist();
    render.dashboard();
  }));
}
/* ═══ V6 1.4「现在网上谁在替你说话」分析卡 ═══
 * 分类规则透明可解释（按优先级先命中先归类）；系统不自动定性"代建站"——
 * 陌生域名逐个给「是我们的→」归位按钮（可控阵地/集团信源），人工确认为准。 */
function classifyReferrer(host) {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  const rules = GEO.referrerRules || {};
  const hit = arr => (arr || []).some(d => { d = String(d).toLowerCase(); return h === d || h.endsWith("." + d) || h.includes(d); });
  if (hit(rules.agency)) return { k: "agency", t: "中介平台" };
  if (hit(rules.ugc)) return { k: "ugc", t: "网友点评" };
  if (hit(rules.authority)) return { k: "authority", t: "权威平台" };
  return { k: "other", t: "其他网站" };
}
function referrerCardHtml(res) {
  const e2a = (res.checks || []).find(c => c.id === "E2a");
  const tops = (e2a && e2a.tops) || [];
  if (tops.length < 3) return "";   /* 数据不足不渲染（不编造） */
  const own = curOwn(), grp = (curProject() || {}).groupDomains || [];
  const isOurs = h => own.some(d => h === d || h.endsWith("." + d)) || grp.some(d => h === d || h.endsWith("." + d));
  const KN = { own: "自有·可控阵地", group: "集团信源", authority: "权威平台", ugc: "网友点评", agency: "中介平台", other: "其他网站" };
  const CL = { own: "tag-ok", group: "tag-gold", authority: "tag-info", ugc: "tag-warn", agency: "tag-warn", other: "tag" };
  const rows = tops.map(t => {
    let host = t.url; try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch (e) {}
    let k;
    if (isOurs(host)) k = grp.some(d => host === d || host.endsWith("." + d)) ? "group" : "own";
    else k = classifyReferrer(host).k;
    return { host, k, title: (t.title || "").slice(0, 40) };
  });
  const cnt = {}; rows.forEach(r => cnt[r.k] = (cnt[r.k] || 0) + 1);
  const order = ["own", "group", "authority", "ugc", "agency", "other"];
  const statLine = order.filter(k => cnt[k]).map(k => `${KN[k]} ${cnt[k]}`).join(" · ");
  const thirdN = (cnt.agency || 0) + (cnt.other || 0);
  const concl = thirdN >= Math.ceil(tops.length / 2)
    ? `——现在替你说话的主要是中介和第三方网站，<b>它们的错误信息（旧租金/空置情况）会被 AI 直接当作官方数据引用</b>`
    : (cnt.own || cnt.group) ? "——我们这边的阵地已在场，保持口径一致并持续更新" : "";
  return `<div class="card" id="dgRefCard" style="margin-top:var(--space-md);border-color:var(--color-accent)">
    <h3 style="border:none;margin:0 0 4px">现在网上谁在替你说话 <span class="hint">品牌词前 ${tops.length} 条信源分类 · 点「是我们的」归位后即时重算</span></h3>
    <p style="margin:6px 0">${statLine}${concl}</p>
    <div class="ref-rows">${rows.map((r, i) => `
      <div class="ref-row">
        <span class="tag ${CL[r.k]}">${KN[r.k]}</span>
        <b class="num host">${esc(r.host)}</b>
        <span class="rtitle">${esc(r.title)}</span>
        ${r.k === "other" || r.k === "agency" ? `<button class="btn btn-sm btn-ghost" data-refclaim="${esc(r.host)}">是我们的 →</button>` : ""}
      </div>`).join("")}</div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">分类依据域名规则库（透明可查）；「其他网站」里若有专门做本项目内容的陌生站，而你们没建过——那就是第三方在替你说话，<a href="#/monitor" style="color:var(--color-info)">看场景词上谁在赢 →</a></p>
  </div>`;
}
/* V6 1.5 友军归位（二选一：可控阵地 / 集团信源），归位后该次结果即时重算 */
async function referrerClaim(host) {
  const kind = confirm(`「${host}」是我们这边的吗？\n\n点「确定」= 可控阵地（能发布内容：官网/公众号）\n点「取消」= 集团信源（可信但不能发布：集团官网/披露页）\n（都不是就关闭本弹窗的父提示框）`);
  const p = curProject() || {};
  const list = kind ? (p.ownDomains || []) : (p.groupDomains || []);
  if (!list.includes(host)) list.push(host);
  await saveProjMeta(kind ? { ownDomains: list } : { groupDomains: list });
  /* 前端即时重算该次结果的重分类展示 */
  if (state.lastDiag) renderDiagResult(state.lastDiag, 0, 0);
  toast(`已归位为「${kind ? "自有·可控阵地" : "集团信源"}」——E2a 与命中统计按新口径生效`);
}
function renderDiagResult(res, filled, kept) {
  /* V0.1.12：头条三态优先读该次诊断持久化的填入事实（autoFilled/autoKept）；
     旧数据没存这两个字段时，从 checks 的 score 映射重推可自动评分项数（与 diagReportMd 同源逻辑），
     不再按调用方缺省 0/0 重算成「本次无自动可评项」（BUG#1b：跨项目切换后头条被改写） */
  if (res.autoFilled == null) {
    const ks = new Set();
    (res.checks || []).forEach(c => Object.keys(c.score || {}).forEach(k => ks.add(k)));
    res.autoFilled = ks.size;
  }
  filled = res.autoFilled; kept = (res.autoKept != null) ? res.autoKept : (kept || 0);
  const LV = { pass: "pass", warn: "warn", fail: "fail" }, IC = { pass: "✓", warn: "⚠", fail: "✗" };
  const isEnt = res.mode === "entity";
  const checks = res.checks || [];
  /* V0.1.8：结果头条（时间/对象/自动填入 + 三态计数 + 动作组前置）；
     检查项按编号前缀归维（与体检表五维同构），分组多列展示替代单列长条 */
  const cnt = { pass: 0, warn: 0, fail: 0 };
  checks.forEach(c => { cnt[c.status] = (cnt[c.status] || 0) + 1; });
  const DIM = { T: "技术可达", C: "内容可摘录", E: "实体与权威", D: "生态布源", M: "监测治理" };
  const groups = [];
  checks.forEach(c => {
    const dim = DIM[(c.id || "X")[0]] || "其他检查";
    let g = groups.find(x => x.dim === dim);
    if (!g) groups.push(g = { dim, items: [] });
    g.items.push(c);
  });
  const chkHtml = c => `<div class="chk ${LV[c.status] || ""}"><span class="ico">${IC[c.status] || "·"}</span>
    <div><b>${c.id} ${esc(c.name)}</b><span class="why" style="color:var(--color-ink-2)">${esc(c.evidence)}</span></div></div>`;
  $("#dgOut").innerHTML =
    `<div class="dg-head">
      <div style="min-width:0">
        <p class="dg-meta">${isEnt ? "实体体检" : "诊断"}时间 <b class="num">${res.ts}</b> · 检查对象 <b class="num">${isEnt ? "品牌词「" + esc(res.brand || res.url) + "」" : esc(res.url)}</b> · ${filled > 0 ? `已自动填入体检表 <b>${filled}</b> 项（体检表中标「自动」，人工可覆盖）` : kept > 0 ? `本次无新增填入：${kept} 项此前已有人工评分，未覆盖` : "本次无自动可评项"}</p>
        <div class="dg-counts">
          <span class="tag tag-ok">✓ 通过 ${cnt.pass}</span>
          <span class="tag tag-warn">⚠ 待改进 ${cnt.warn}</span>
          <span class="tag tag-bad">✗ 未通过 ${cnt.fail}</span>
        </div>
      </div>
      <div class="dg-actions">
        <button class="btn btn-primary" id="dgDl">下载${isEnt ? "实体体检" : "诊断"}报告(.md)</button>
        <button class="btn btn-ghost" id="dgCopy">复制报告内容</button>
        <a class="btn btn-primary" href="#/diag/report" onclick="RPT_MODE='wo'">生成整改工单 →</a>
        <a class="btn btn-ghost" href="#/diag/report">查阅完整报告 →</a>
        <a class="btn btn-ghost" href="#/diag/audit" onclick="window.__auditAuto=1">去体检表看填入 →</a>
      </div>
    </div>
    <div class="dg-grid">${groups.map(g => `<div class="card dg-dim"><h3>${g.dim} <span class="hint">${g.items.length} 项</span></h3>${g.items.map(chkHtml).join("")}</div>`).join("")}</div>` +
    referrerCardHtml(res) +
    (isEnt ? `<div class="card" style="margin-top:var(--space-md);border-color:var(--color-accent)">
      <h3 style="border:none;margin:0 0 4px">实体资产核对清单（12 项 · 无官网项目的主战场）</h3>
      <p class="muted" style="font-size:var(--text-sm);margin:0 0 4px">上面是系统自动查的；下面 12 项需要你按提示人工核对后打分（0=没做，1=做了一半，2=做到了），分数直接计入体检表与发展曲线。</p>
      <div id="dgChk" class="dg-grid" style="margin-top:var(--space-xs)">${entityChecklistHtml()}</div></div>` : "");
  if (isEnt) bindEntityChecklist();
  $("#dgDl").addEventListener("click", () => {
    const md = diagReportMd(res);
    download(`${isEnt ? "GEO实体体检报告" : "GEO诊断报告"}-${(res.brand || res.url)}-${today()}.md`, md, "text/markdown");
  });
  $("#dgCopy").addEventListener("click", () => {
    copyText(diagReportMd(res));
    toast("若浏览器未开始下载场景同此：已复制全文，可粘贴到任意文档保存");
  });
  /* V6 1.3：品牌词唯一性观察行（异步取 brandcheck 缓存，不阻塞渲染；V6.1 引导演示态不发真实外呼） */
  if (isEnt && SERVER_MODE && res.brand && !(window.Tour && window.Tour.active)) {
    fetch("/api/brandcheck", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand: res.brand, city: (projCtx().city || "") }) })
      .then(r => r.json()).then(d => {
        if (d && d.ambiguity) {
          const line = document.createElement("p");
          line.className = "muted"; line.style.cssText = "font-size:12px;margin:4px 0";
          line.innerHTML = `⚠ 品牌词唯一性：搜「${esc(res.brand)}」混入了其他城市同名项目${(d.samples || [])[0] ? `（例：${esc(d.samples[0])}…）` : ""}——建议在项目设置改为「${esc(d.suggestion)}」`;
          const out = $("#dgOut"); out && out.insertBefore(line, out.firstChild);
        }
      }).catch(() => {});
  }
  /* V6 1.4/1.5：分析卡归位按钮绑定 */
  $$("#dgOut [data-refclaim]").forEach(b => b.addEventListener("click", () => referrerClaim(b.dataset.refclaim)));
}
function diagReportMd(res) {
  const auto = res.auto_scores || (() => {   /* 历史记录未存auto_scores时从checks重算 */
    const m = {};
    (res.checks || []).forEach(c => Object.entries(c.score || {}).forEach(([k, v]) => { m[k] = Math.max(m[k] || 0, v); }));
    return m;
  })();
  const isEnt = res.mode === "entity";
  return `# 园区GEO${isEnt ? "实体体检" : "一键诊断"}报告\n> ${res.ts} · 检查对象 ${isEnt ? `品牌词「${res.brand || res.url}」（无官网实体体检）` : res.url} · 证据均来自真实探测\n\n` +
    res.checks.map(c => `- [${c.status.toUpperCase()}] ${c.id} ${c.name}：${c.evidence}`).join("\n") +
    (isEnt ? `\n\n## 实体资产核对清单（12 项人工核对，分数见体检表）\n` +
      GEO.entityChecklist.map(g => `### ${g.dim}\n` + g.items.map(i => `- ${i.id} ${i.t}：${i.what}（核对方法：${i.how}）`).join("\n")).join("\n") : "") +
    `\n\n> 自动填入体检项：${JSON.stringify(auto)}\n> 下一步：诊断→报告→生成整改工单 派发执行；行动→优化文件 生成${isEnt ? "百科/公众号/地图" : "部署"}物料。`;
}

/* ══════ 物料生成器（优化文件与整改工单共用）════════ */
const OPS_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai",
  "PerplexityBot", "Perplexity-User", "Bytespider", "Google-Extended", "CCBot", "Applebot"];
function genRobotsTxt() {
  return "# ── AI 爬虫放行片段（追加到 robots.txt 末尾，勿整文件替换）──\n" +
    OPS_BOTS.map(b => `User-agent: ${b}\nAllow: /`).join("\n\n");
}
function genLlmsTxt(park, url) {
  const op = (typeof projCtx === "function" ? projCtx().operator : "") || "【待补：运营主体全称（项目设置里填）】";
  return `# ${park}\n\n> 官方承载页 https://${url}/ · 运营方：${op}\n\n## 核心事实（数据时点见口径表）\n- 入驻企业：【见口径表】\n- 产业聚集度：【见口径表】\n\n## 页面导航\n- [官方承载页](https://${url}/)\n\n<!-- 更新时间 ${today()} -->`;
}
function genSchema(park, url, city, industry) {
  const op = (typeof projCtx === "function" ? projCtx().operator : "") || "【待补：运营主体】";
  /* V0.1.12 F5 修复：knowsAbout 第二槽位此前把函数名 venueNoun() 以文本形式漏进 JSON（模板串里漏了 ${}），
     用户照「可直接使用」贴进官网会得到非法 JSON-LD。两处生成器（genSchema/opsBuildToolkit）同修。 */
  return `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "${park}",\n  "url": "https://${url}/",\n  "parentOrganization": { "@type": "Organization", "name": "${op}" },\n  "address": { "@type": "PostalAddress", "addressLocality": "${city}", "addressCountry": "CN" },\n  "description": "${park}是${city}${industry}${venueNoun()}。",\n  "telephone": "【待填：招商热线】",\n  "knowsAbout": ["${industry}", "${venueNoun()}", "企业选址"]\n}\n</script>`;
}
/* V0.1.12 F5 防回归：生成的结构化数据必须能通过本地 JSON-LD 解析校验——
   非法即禁用下载/复制并明示（「可直接使用」的承诺要经得起校验） */
function validJsonld(text) {
  const m = String(text || "").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return false;
  try { JSON.parse(m[1]); return true; } catch (e) { return false; }
}
/* V4.5 无官网实体物料（不依赖官网承载页，品宣自己可执行）*/
function genBaikeDraft(park, F, op) {
  const g = (k, d) => F[k] || d;
  const VN = venueNoun();
  return `# 百科词条更新稿：${park}\n> 生成 ${today()} · 百度百科是各 AI 引擎交叉对照的基础层。每个数字必须与口径表一致并附权威来源链接，无来源的数字百科审核不过、AI 也不敢引用。\n\n## 词条正文（按百科惯例结构，逐段替换）\n\n${g("实体全称", "") ? g("实体全称", "") : park}是${op}运营的${VN}，位于${g("详细地址", "") || "【待填：详细地址（口径表锚定区）】"}，主导${g("主导产业", "【待填】")}产业。\n\n【基本信息】\n- 运营面积：${g("面积", "【待填：见口径表】")}\n- 入驻企业：${g("入驻企业数", "【待填：见口径表】")}\n- 产业聚集度：${g("产业聚集度", "【待填：见口径表】")}\n- 权威背书：${g("行业排名", "【待填：榜单名+年份，必须写明榜单名】")}\n\n【区位交通】\n【待填：地址/地铁线站/主干道/距离机场高铁站】\n\n【产业定位】\n【待填：主导产业+代表企业，数据取口径表】\n\n## 参考资料清单（百科正文每个关键数字都要能对到一条）\n1. 【政府网站/权威媒体名】报道标题，日期，链接\n2. 【REIT公告/榜单发布方】文件名，日期，链接\n3. 【待补：逐条补齐后才能提交】\n\n## 提交方法\n1. 打开 baike.baidu.com 搜「${park}」：有词条→「编辑」逐项更新；无词条→「创建词条」\n2. 正文按上述结构粘贴，【待填】全部补齐\n3. 参考资料逐条添加来源链接（政府网站、权威媒体、REIT 公告优先）\n\n*更新时间：${today()} · 责任人：__*`;
}
function genMapChecklist(park) {
  const addr = ((state.caliber || []).find(r => r.field === "详细地址") || {}).official || "";
  return `# 地图信息核对清单：${park}\n> AI 与搜索引擎回答「在哪儿 / 怎么去 / 周边有什么」类问题时高度依赖地图数据。三个平台逐项核对，约 30 分钟，不需要任何技术。\n\n## 三个平台逐项核对\n\n| 平台 | 入口 | 动作 |\n|---|---|---|\n| 高德地图 | https://ditu.amap.com 搜「${park}」 | 认领主体 → 核对名称/地址/电话 → 补实景照片 → 类目选「${venueNoun() === "商务楼宇" ? "商务写字楼/商业楼宇" : "产业园区"}」 |\n| 百度地图 | https://map.baidu.com 搜「${park}」 | 同上（百度系数据同时喂给文心一言） |\n| 腾讯地图 | https://map.qq.com 搜「${park}」 | 同上 |\n\n## 核对项（三平台必须完全一致）\n- 名称：与品牌词一字不差（无错别字/无旧名）\n- 地址：与官方口径一致${addr ? "（" + addr + "）" : ""}\n- 电话：招商热线（与口径表同一号码）\n- 类目：${venueNoun() === "商务楼宇" ? "商务写字楼/商业楼宇（勿选「写字楼出租」等杂类）" : "产业园区/产业园（勿选「写字楼出租」等杂类）"}\n- 照片：≥3 张实景（${venueNoun() === "商务楼宇" ? "楼栋外立面/大堂/办公场景" : "园区门头/办公场景/区位交通"}）\n- 营业状态：正常营业\n\n## 常见问题\n- 搜不到 → 先创建地点并认领（需营业执照）\n- 名称对但信息是旧的 → 平台内「报错/反馈」提交更正\n- 三平台信息互相矛盾 → 以口径表为准逐个改齐（AI 交叉验证不一致会降权）\n\n*核对完成 ${today()} · 责任人：__*`;
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
/* V5 工单事实层（通用化红线）：what 一律写该次诊断的真实证据；种子卡里蛇口实况描述不再使用。
 * 无证据=该项未被本轮体检覆盖 → 明示引导去跑体检，绝不编造"官网缺XX"之类的假现状。 */
function factWhat(c, e) {
  const ev = String(c.evidence || "").trim();
  if (ev) return ev;
  return `本次体检没有覆盖到这项。先到「诊断 → ${e && e.mode === "entity" ? "实体体检" : "一键诊断"}」跑一次（约10–30秒），这里会自动写明本项目的实际情况。`;
}
function woParts(e) {
  const ctx = projCtx();
  const park = e.brand || (ctx.park !== "本园区" ? ctx.park : "园区");
  const city = ctx.city || "【待补：城市，见项目设置】";
  const industry = ctx.industry || "【待补：主导产业，见项目设置】";
  const issues = (e.checks || []).filter(c => c.status !== "pass");
  const byOrder = GEO.woOrder.map(id => issues.find(c => c.id === id)).filter(Boolean)
    .concat(issues.filter(c => !GEO.woOrder.includes(c.id)));
  const isEnt = e.mode === "entity";   /* V4.5：实体体检的整改全部品宣自己能做，无「找官网管理员」组 */
  const SELF = isEnt ? byOrder : byOrder.filter(c => c.id === "E2a");
  const IT = isEnt ? [] : byOrder.filter(c => c.id !== "E2a");
  return { park, city, industry, issues, SELF, IT, isEnt };
}
function woCard(c, e, idx) {
  const raw = GEO.woPlain[c.id] || {};
  const parkNow = woParts(e).park;
  /* V4.6.1 行动卡项目化：种子卡文案里的「蛇口网谷」替换为本项目名（与生成器模板参数化同一红线）
     V5：what 走 factWhat（该次诊断真实证据），只有 title/why/steps 保留通用模板+名字替换 */
  const sub = s => String(s).split("蛇口网谷").join(parkNow);
  const p = { title: sub(raw.title), what: factWhat(c, e), why: sub(raw.why), who: raw.who, steps: (raw.steps || []).map(sub) };
  const isSelf = (e.mode === "entity") || c.id === "E2a";
  const mat = c.id === "T4" ? genSchema(parkNow, e.url, woParts(e).city, woParts(e).industry)
    : c.id === "T5" ? genLlmsTxt(parkNow, e.url)
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
    <p class="muted" style="font-size:12px"><b>怎么算做完了：</b>${isSelf
      ? `两周后在本系统重跑「${e.mode === "entity" ? "实体体检" : "一键诊断"}」和「跑一轮30问」，看品牌词前10与命中率变化`
      : `回本系统重跑「${e.mode === "entity" ? "实体体检" : "一键诊断"}」，${c.id} 从 ✗/⚠ 变 ✓`} · <span class="num">系统编号 ${c.id}</span> · 诊断证据：${esc(c.evidence).slice(0, 60)}…</p>
  </div>`;
}
function buildItMessage(e) {
  const { park, city, industry, IT, isEnt } = woParts(e);
  if (isEnt) {
    /* V4.5 无官网实体体检：整改=品宣自查清单，可整段贴进工作群 */
    const seg = id => (e.checks || []).find(c => c.id === id && c.status !== "pass");
    let n = 0, msg = `【${park} 网上存在感执行清单 · 品宣自己就能做，不依赖官网/技术】\n\n背景：实体体检（用品牌词真实搜索）发现本项目在网上可被 AI 引用的官方信息不足。以下事项按优先级执行：\n`;
    if (seg("E2a")) { n++; msg += `\n${n}) 品牌词搜索前 10 没有我们的官方内容——开通官方公众号并把《一园一档（公众号版）》作为首篇发布（物料在系统「执行→优化文件」已是终稿）；\n`; }
    if (seg("E1")) { n++; msg += `\n${n}) 百度百科词条：按口径表更新/创建，每个数字附权威来源链接（用《百科词条更新稿》）；\n`; }
    if (seg("E6")) { n++; msg += `\n${n}) 企业信息平台：企查查/天眼查核对运营主体名称、法人、地址并更正不一致；\n`; }
    if (seg("E4")) { n++; msg += `\n${n}) 权威背书：把榜单/资质整理成带年份出处的文字，公众号发布并进百科参考资料；\n`; }
    if (!n) msg += `\n本轮自动检查全部通过——重点做实体资产核对清单的 12 项人工打分（诊断页）。`;
    msg += `\n做完每件事，回系统「诊断 → 实体体检」重跑验收（对应项变✓）。三平台地图信息认领也别忘了（清单在优化文件里）。\n`;
    return msg;
  }
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
  const { issues, SELF, IT, isEnt, park } = woParts(e);
  if (!issues.length) return '<div class="card"><p style="color:var(--color-ok);font-weight:600">✓ 本报告全部通过，无需整改。</p></div>';
  return `
  <div style="border:2px solid var(--color-accent-navy);border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--color-paper-2)">
    <div style="font-family:var(--font-display);font-weight:700;font-size:var(--text-md)">整改行动清单（共 ${issues.length} 件事，已按重要程度排序）</div>
    <p class="muted" style="margin-top:6px;font-size:13px">${isEnt
      ? `你的三步：<b>① 今天</b>做下面第一件事（都是品宣自己能做的，不需要任何技术） → <b>② 本周</b>把「执行清单」贴进工作群分工执行——物料在「执行→优化文件」已是终稿 → <b>③ 下周</b>回「诊断→实体体检」重跑验收。每件事右上的状态标签点击可切换。`
      : `你的三步：<b>① 今天</b>做下面「不用等 IT」的第一件事 → <b>② 本周</b>把「转发消息」发给能登录官网后台的人（信息部/网站供应商）——材料系统已出终稿，对方只需上传/粘贴 → <b>③ 下周</b>回「一键诊断」重跑验收。每件事右上的状态标签点击可切换。`}</p>
  </div>
  <div class="card" style="margin-bottom:12px;border-color:var(--color-accent)">
    <h3>${isEnt ? `📤 ${esc(park)} 执行清单（整段复制，贴进工作群即可分工）` : "📤 给官网管理员的转发消息（贵司信息部/网站供应商，微信直接粘贴这段）"}</h3>
    <pre class="prompt-view" style="max-height:260px;white-space:pre-wrap">${esc(buildItMessage(e))}</pre>
    <button class="btn btn-primary btn-sm" id="woCopyMsg">${isEnt ? "复制整段执行清单" : "复制整段转发消息"}</button>
  </div>
  ${SELF.length ? `<p class="kicker">第一部分 · 不用等技术，你自己今天就能做</p>` : ""}
  ${SELF.map((c, i) => woCard(c, e, i + 1)).join("")}
  ${IT.length ? `<p class="kicker" style="margin-top:12px">第二部分 · 需要能登录官网的人处理（终稿物料由本系统「一键优化文件」生成，转发消息里也含代码）</p>` : ""}
  ${IT.map((c, i) => woCard(c, e, (SELF.length ? SELF.length : 0) + i + 1)).join("")}
  <p class="muted" style="font-size:12px">生成 ${today()} · 基于 ${esc(e.ts)} ${isEnt ? "实体体检" : "诊断"} · 状态存在本系统 · 全部做完后重跑「跑一轮30问」看素材池变化</p>`;
}
function workOrderMd(e) {
  const { issues, SELF, IT, isEnt, park: parkNow } = woParts(e);
  /* V4.6.1 行动卡项目化（与 woCard 同规则）：种子文案「蛇口网谷」→本项目名；V5：what 走 factWhat */
  const card = c => { const r = GEO.woPlain[c.id] || {}; const sub = s => String(s).split("蛇口网谷").join(parkNow);
    return { title: sub(r.title) || c.name, what: factWhat(c, e), steps: (r.steps || []).map(sub) }; };
  let md = `# 整改行动清单（共${issues.length}件事，按重要程度排序）\n> 基于 ${e.ts} ${isEnt ? "实体体检" : "诊断"} · ${e.mode === "entity" ? `品牌词「${e.brand || e.url}」` : e.url}\n\n${isEnt ? "## 执行清单（贴进工作群）" : "## 给网站管理员的转发消息（直接粘贴）"}\n\n${buildItMessage(e)}\n`;
  let n = 0;
  SELF.forEach(c => { n++; const p = card(c); md += `\n## 第${n}件事（自己做）· ${p.title}\n${p.what || ""}\n怎么做：\n${p.steps.map(s => "- " + s).join("\n")}\n验收：重跑${e.mode === "entity" ? "实体体检" : "诊断"}/30问\n`; });
  IT.forEach(c => { n++; const p = card(c); md += `\n## 第${n}件事（IT）· ${p.title}\n${p.what || ""}\n怎么做：\n${p.steps.map(s => "- " + s).join("\n")}\n验收：重跑${e.mode === "entity" ? "实体体检" : "一键诊断"} ${c.id} 变✓\n`; });
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
  const city = $("#tkCity").value.trim() || ctx.city;
  const industry = $("#tkIndustry").value.trim() || ctx.industry;
  if (!city || !industry) { toast("城市与主导产业必填——顶部「项目设置」补一次，以后自动带出"); return; }
  /* V5：表单值回写项目元数据（单一事实源；下次任何表单自动带出） */
  saveProjMeta({ city: city.slice(0, 40), industries: industry.split(/[,，、;；\s]+/).filter(Boolean).slice(0, 5) });
  const url = (state.parkUrl || curProject().url || "").trim();
  const hasSite = !!url;   /* V4.5：无官网项目不再回退假域名——官网三件物料不生成，改出百科/地图/公众号实体物料 */
  const op = ctx.operator || "【待补：运营主体全称（项目设置里填）】", opShort = ctx.operatorShort || "";
  const rows = state.caliber.filter(r => r.park && (r.park.includes(park.slice(0, 2)) || park.includes(r.park.slice(0, 2))));
  const F = {}; rows.forEach(r => { F[r.field] = r.official; });
  const g = (k, d) => F[k] || d;

  const robots = `# ── AI 爬虫放行片段（追加到 robots.txt 末尾，勿整文件替换）──\n` +
    ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai",
     "PerplexityBot", "Perplexity-User", "Bytespider", "Google-Extended", "CCBot", "Applebot"]
      .map(b => `User-agent: ${b}\nAllow: /`).join("\n\n") +
    `\n\n# 提示：若官网使用 Cloudflare/阿里云WAF，还需在控制台「Bot管理」中将上述爬虫加入白名单\n# （Cloudflare 自 2025-07 对新域名默认封锁 AI 爬虫——这是最高频的技术翻车点）`;

  const llms = `# ${park}\n\n> ${city}${industry}产业园区 · 运营方：${op} · 官网 https://${url}\n\n## 核心事实（数据时点见口径表）\n\n- 入驻企业：${g("入驻企业数", "【待填：见口径表】")}\n- 产业聚集度：${g("产业聚集度", "【待填】")}\n- 运营面积：${g("面积", "【待填】")}㎡\n- 主导产业：${industry}\n- 权威背书：${g("行业排名", "【待填：榜单名+年份，引用须写明榜单名】")}\n\n## 页面导航\n\n- [园区官网](https://${url}/)\n- [一园一档页]（部署后把链接更新到这里）\n- [选址FAQ]（部署后把链接更新到这里）\n\n<!-- 更新时间 ${today()} · 责任人：__ -->`;

  const jsonld = `<!-- 结构化数据：贴到园区页面 </head> 前（部署前把【待填】补齐，并对照口径表逐项核对） -->\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "${park}",\n  "alternateName": "${park}（${opShort}）",\n  "url": "https://${url}/",\n  "parentOrganization": { "@type": "Organization", "name": "${op}" },\n  "address": { "@type": "PostalAddress", "addressLocality": "${city}", "addressCountry": "CN" },\n  "areaServed": "${city}",\n  "description": "${park}是${city}${industry}${venueNoun()}，入驻企业${g("入驻企业数", "【待填】")}，产业聚集度${g("产业聚集度", "【待填】")}。",\n  "telephone": "【待填：招商热线】",\n  "knowsAbout": ["${industry}", "${venueNoun()}", "企业选址"]\n}\n</script>`;

  const profile = `# ${park}（一园一档）\n> 数据截至 ${today()} · 责任人：__ · 数字均取自口径表，发布前逐项核对\n\n## 一句话\n${park}是${op}旗下园区，位于${city}，主导${industry}产业。\n\n## 基本信息表\n| 项目 | 数据 | 时点 |\n|---|---|---|\n| 运营主体 | ${op} | — |\n| 区位交通 | 【待填：地址/地铁线站/距离】 | — |\n| 运营面积 | ${g("面积", "【待填】")} | 【待填】 |\n| 入驻企业 | ${g("入驻企业数", "【待填】")} | 【待填】 |\n| 产业聚集度 | ${g("产业聚集度", "【待填】")} | 【待填】 |\n| 租金区间 | 【待填：元/㎡/月】 | 【待填】 |\n| 龙头企业 | 【待填：500强/上市公司名单】 | — |\n| 权威背书 | ${g("行业排名", "【待填：榜单名+年份】")} | — |\n\n## 选址者最关心的5个问题（FAQ骨架，逐问补答≤300字）\n${P_prompts().filter(p => p.cat === "选址决策").slice(0, 5).map(p => `### ${p.q}\n【答案前置：先给结论+2个硬数据，再展开】`).join("\n\n")}\n\n## 企业说\n${(() => { const qs = (typeof evidenceQuotes === "function") ? evidenceQuotes(park) : [];
  return qs.length ? qs.map(q => `> 「${q.content}」\n> —— ${q.person}${q.title ? "·" + q.title : ""}${q.source ? `（${q.source}）` : ""}`).join("\n\n") : "> 【待采集：入驻企业负责人原话，带姓名职务（在「诊断→证据库」录入已核验引言后，此处自动填充）】"; })()}\n\n*更新时间：${today()} · 责任人：__*`;

  const faqMd = `# ${park} 选址FAQ（20问）\n> 每问一答、答案前置、≤300字、数据取自口径表；答完贴入「诊断→内容评分」≥75分再发布\n\n${[...P_prompts().filter(p => p.cat === "选址决策"), ...P_prompts().filter(p => p.cat === "品牌认知")].slice(0, 20).map((p, i) => `## ${i + 1}. ${p.q}\n【结论句式：${park}……（首个数字：${g("入驻企业数", "企业数【待填】")}；第二个数字：${g("产业聚集度", "聚集度【待填】")}）】\n【展开：区位/载体/政策/服务各一句，数字优先】\n【出处：（来源：口径表/权威榜单，年份）】`).join("\n\n")}`;

  const channelPack = `# ${park} 渠道分发指南\n> 生成 ${today()} · 每个渠道都是真实入口，按顺序执行；先发布、后监测（监测页一键跑30问）\n\n## 第一周（基础层+自有渠道）\n${hasSite
      ? "1. 官网：部署 robots 片段 + 结构化数据 + 一园一档页 + FAQ页（文件在左侧已生成）\n2. 百度百科：按口径表更新词条，每个数字附权威来源\n3. 企查查/天眼查：核验运营主体信息\n4. 三大地图：按《地图信息核对清单》在高德/百度/腾讯认领并核对信息（实体一致性层，约30分钟）"
      : `1. 官方承载：按《百科词条更新稿》更新/创建百度百科词条（本项目暂无官网，百科就是第一官方门面）\n2. 三大地图：按《地图信息核对清单》在高德/百度/腾讯认领并核对信息\n3. 公众号：注册认证官方号，把《一园一档（公众号版）》作为首篇发布`}\n\n## 第二周起（内容矩阵，按引擎偏好排序）\n${GEO.channels.map((c, i) => `${i + 1}. **${c.name}** — ${c.engine}\n   入口：${c.entry}\n   动作：${c.action}\n   首发：${c.first.replace("{园区}", park).replace("{产业}", industry).replace("{city}", city)}`).join("\n\n")}\n\n## 节奏与红线\n- 节奏：公众号双周 / 知乎月2 / 头条百家随发 / 抖音周1 / B站月1 / 搜狐网易企鹅随公众号同步\n- 红线：同一事实多渠道口径必须一致（DeepSeek 对不一致品牌首选率暴跌82%）；禁堆砌夸饰；效果预期 10–15天首批引用、8–12周稳定（行业参考值，以监测台账为准）`;

  const files = hasSite ? [
    { name: "robots-AI放行片段.txt", desc: "追加到官网 robots.txt；若用 CDN/WAF 还需控制台白名单", content: robots },
    { name: "llms.txt", desc: "传到官网根目录（可选项，5分钟成本；Google声明不使用，勿指望它替代内容）", content: llms },
    { name: "schema-结构化数据.html", desc: "贴到园区页 </head> 前，补齐【待填】", content: jsonld },
    { name: "一园一档.md", desc: "园区标准介绍页：一段介绍+一张数据表+五个常见问题（官网/公众号/知乎通用）", content: profile },
    { name: "选址FAQ-20问.md", desc: "答案前置的FAQ页源稿，逐问补答后过评分器≥75再发", content: faqMd },
    { name: "地图信息核对清单.md", desc: "高德/百度/腾讯三平台认领与核对（约30分钟，不需要技术；全项目基础层）", content: genMapChecklist(park) },
    { name: "渠道分发指南.md", desc: `${GEO.channels.length}个渠道的真实入口、动作与首发内容，按周执行`, content: channelPack },
  ] : [
    { name: "百科词条更新稿.md", desc: "百度百科词条的创建/更新终稿——无官网项目的第一官方门面，数字全部取口径表", content: genBaikeDraft(park, F, op) },
    { name: "地图信息核对清单.md", desc: "高德/百度/腾讯三平台认领与核对（约30分钟，不需要技术）", content: genMapChecklist(park) },
    { name: "一园一档（公众号版）.md", desc: "公众号/知乎通用的园区标准档案——作为官方公众号首篇发布", content: profile },
    { name: "选址FAQ-20问.md", desc: "答案前置的FAQ源稿，逐问补答后过评分器≥75再发（公众号/知乎均适用）", content: faqMd },
    { name: "渠道分发指南.md", desc: "无官网路线：百科+地图+公众号起步，再按引擎偏好铺内容", content: channelPack },
  ];
  /* V0.1.12 F5：JSON-LD 本地校验——非法即标记禁用下载/复制并明示（「可直接使用」的文件要经得起校验，绝不给用户可贴坏官网的物料） */
  const jsonldBad = [];
  files.forEach(f => { if (f.name.includes("结构化数据")) { f.invalid = !validJsonld(f.content); if (f.invalid) jsonldBad.push(f.name); } });
  if (jsonldBad.length) toast("⚠ " + jsonldBad.join("、") + " 未通过 JSON-LD 校验，已禁用下载——请把此提示截图反馈");
  window.__tkFiles = files;
  $("#tkOut").innerHTML = files.map((f, i) => `
    <div class="card" style="margin-bottom:12px">
      <h3 style="border:none;margin:0 0 6px">${esc(f.name)}${f.invalid ? ' <span class="tag tag-bad">校验未过 · 已禁用下载</span>' : ""}
        <span style="display:flex;gap:6px">
          <button class="btn btn-sm btn-primary" data-tkdl="${i}" ${f.invalid ? "disabled" : ""}>下载</button>
          <button class="btn btn-sm btn-ghost" data-tkcp="${i}" ${f.invalid ? "disabled" : ""} title="浏览器限制下载时的兜底：复制全文自行粘贴保存">复制内容</button>
        </span></h3>
      <p class="muted" style="margin-bottom:6px">${esc(f.desc)}</p>
      <pre class="prompt-view" style="max-height:180px">${esc(f.content)}</pre>
    </div>`).join("") +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" id="tkDlAll">打包下载全部（${files.length}个文件清单）</button>
      <span class="muted" style="font-size:12px">${hasSite ? "若浏览器询问保存位置或未开始下载，用各文件「复制内容」即可" : "本项目暂无官网——已跳过官网部署三件（robots/说明文件/结构化数据），有官网后回来重新生成为 6 件"}</span></div>`;
  $$("#tkOut [data-tkdl]").forEach(b => b.addEventListener("click", () => {
    const f = files[+b.dataset.tkdl];
    if (f.invalid) { toast("该文件未通过 JSON-LD 校验，已禁用下载——请反馈给管理员"); return; }
    download(`${park}-${f.name}`, f.content, "text/plain;charset=utf-8");
    registerWatch(`${park}-${f.name}`);   /* V4 2.4：下载即登记资产追踪（部署后补URL、查进榜） */
    renderWatch();
  }));
  $$("#tkOut [data-tkcp]").forEach(b => b.addEventListener("click", () => {
    const f = files[+b.dataset.tkcp];
    if (f.invalid) { toast("该文件未通过 JSON-LD 校验，已禁用复制——请反馈给管理员"); return; }
    copyText(files[+b.dataset.tkcp].content);
  }));
  $("#tkDlAll").addEventListener("click", () => {
    files.forEach((f, i) => setTimeout(() => download(`${park}-${f.name}`, f.content, "text/plain;charset=utf-8"), i * 350));
    files.forEach(f => registerWatch(`${park}-${f.name}`));   /* V4 2.4 */
    renderWatch();
    toast(`已按顺序下载${files.length}个文件并登记资产追踪（浏览器多文件下载需允许）`);
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
let RPT_FILL_FOR = null;   /* V0.1.11 报告索引按项目隔离：跨项目切换回到最新一条，不指向别项目的历史序号 */
render.report = () => {
  if (RPT_FILL_FOR !== curProjectId()) { RPT_FILL_FOR = curProjectId(); RPT_IDX = 0; }
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
      <span style="flex:1;min-width:0">${e.mode === "entity" ? `<span class="tag tag-accent" style="margin-right:4px">实体体检</span>` : ""}${esc(e.url)}${e.brand ? ` ·「${esc(e.brand)}」` : ""}</span>
      <span class="tag ${c.fail ? "tag-bad" : c.warn ? "tag-warn" : "tag-ok"}">${c.fail ? `未过${c.fail}` : c.warn ? `警${c.warn}` : "全过"}</span></div>`;
  }).join("") : '<p class="muted" style="padding:16px 0;text-align:center">还没有诊断记录——先到「一键诊断」跑一次。</p>';
  $$("#reportList [data-rp]").forEach(el => el.addEventListener("click", () => { RPT_IDX = +el.dataset.rp; render.report(); }));
  const e = H[RPT_IDX];
  $("#rptMode").innerHTML = `<button class="seg-item ${RPT_MODE === "report" ? "on" : ""}" data-rm="report">查阅报告</button>
    <button class="seg-item ${RPT_MODE === "wo" ? "on" : ""}" data-rm="wo">整改工单</button>`;
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
  const isEnt = e.mode === "entity";
  const verdict = c.fail ? "存在阻断项，需整改后再评估内容投放" : (c.warn ? "基本健康，有可优化项" : "全部通过，技术面优秀");
  const vColor = c.fail ? "var(--color-bad)" : c.warn ? "var(--color-warn)" : "var(--color-ok)";
  const LV = { pass: "tag-ok", warn: "tag-warn", fail: "tag-bad" }, IC = { pass: "✓", warn: "⚠", fail: "✗" };
  const advices = (e.checks || []).filter(x => x.status !== "pass");
  return `
  <div style="border:2px solid var(--color-accent-navy);border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--color-paper-2)">
    <div style="font-family:var(--font-display);font-weight:700;font-size:var(--text-md)">园区 GEO ${isEnt ? "实体体检" : "一键诊断"}报告</div>
    <div class="muted" style="margin:4px 0 10px">检查对象 <b class="num">${isEnt ? `品牌词「${esc(e.brand || e.url)}」（无官网实体体检）` : esc(e.url)}</b>${e.brand && !isEnt ? ` · 品牌词「${esc(e.brand)}」` : ""} · ${esc(e.ts)} · 真实 联网检查与搜索取证</div>
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
  /* V0.1.11 跨项目守卫：换了项目先清空（旧值=别的项目的残留，非用户输入），模式回项目默认 */
  if (DG_FILL_FOR !== curProjectId()) {
    DG_FILL_FOR = curProjectId();
    DG_MODE = null;
    const uEl = $("#dgUrl"); if (uEl) uEl.value = "";
    const bEl = $("#dgBrand"); if (bEl) bEl.value = "";
  }
  const pf = diagPrefill(state, curProject());
  if (pf.url) $("#dgUrl").value = pf.url;   /* state.parkUrl 优先（本项目上次诊断保存的），项目 url 兜底 */
  const brandInp = $("#dgBrand");
  if (brandInp && !brandInp.value.trim() && pf.brand) brandInp.value = pf.brand;   /* 同项目内不覆盖已输入 */
  setDgMode(dgMode());   /* V4.5：双入口默认跟随项目承载形态（无官网项目直接落在实体体检） */
  /* V0.1.8：有结果重演结果区（原行为）；无结果时按当前模式重建空态预检清单 */
  if (state.lastDiag && state.lastDiag.checks) renderDiagResult(state.lastDiag, 0);
  else renderDiagPreview();
};
render.toolkit = () => {
  /* V4.2：园区名默认值跟随当前项目（品牌词/项目名），禁止把种子项目（蛇口网谷）带进其他项目
     V5：城市/主导产业一并从项目元数据预填（元数据空则留空待补，不再默认深圳/数智科技） */
  const cur = curProject();
  const ctx = projCtx();
  /* V5 双形态说明文案（V4.6.1 只改了工作台，此处曾漏改）：按项目承载形态三态渲染 */
  const tkHelp = $("#tkHelpLine");
  if (tkHelp) tkHelp.textContent = noSite()
    ? "生成5个不依赖官网、品宣自己就能执行的文件：百科词条更新稿（数字全部取口径表）· 地图信息核对清单（约30分钟）· 一园一档公众号版 · 选址FAQ20问（过评分器再发）· 渠道分发指南。"
    : "生成7个可直接使用的文件：网站 AI 可读配置（交网站管理员）· AI 说明文件（传官网根目录）· 结构化数据标签（贴页面）· 一园一档（内容库最小单元）· 选址FAQ20问（过评分器再发）· 渠道分发指南 · 地图信息核对清单（全项目基础层，约30分钟）。";
  const want = ((cur.brand || cur.name || "") + "").split("（")[0].trim();
  if ($("#tkPark").dataset.proj !== CUR) {
    const calPark = [...new Set(state.caliber.map(r => r.park))]
      .find(pk => want && (pk.includes(want) || want.includes(pk.split("（")[0])));
    $("#tkPark").value = calPark ? calPark.split("（")[0] : want;
    $("#tkCity").value = ctx.city; $("#tkCity").placeholder = "如：深圳南山（项目设置里补一次，以后自动带出）";
    $("#tkIndustry").value = ctx.industry; $("#tkIndustry").placeholder = "如：数字经济、人工智能（项目设置里补一次，以后自动带出）";
    $("#tkPark").dataset.proj = CUR;
  }
  render.content();  /* 选题单 表单选项填充（复用） */
  if ($("#channelBox").children.length === 0) renderChannels(cur.brand || cur.name || "试点园区", ctx.industry || "");
};
document.addEventListener("DOMContentLoaded", () => {
  const dg = $("#dgRun"); if (dg) dg.addEventListener("click", opsDiagnose);
  const dgS = $("#dgModeSite"); if (dgS) dgS.addEventListener("click", () => setDgMode("site"));
  const dgE = $("#dgModeEntity"); if (dgE) dgE.addEventListener("click", () => setDgMode("entity"));
  const npM = $("#npMode");   /* V4.5：新建弹窗承载形态联动官网域名输入提示 */
  if (npM) npM.addEventListener("change", () => {
    const m = document.querySelector('input[name="npMode"]:checked');
    const lb = $("#npUrlLb");
    if (m && lb) lb.firstChild.textContent = m.value === "none"
      ? "官方承载页域名（暂时没有可留空——先做实体体检与百科/公众号/地图；有了官网再补）"
      : "官方承载页域名（可后补，用于一键诊断）";
  });
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
