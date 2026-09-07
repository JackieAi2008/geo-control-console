/* GEO智控台 V3 · 应用逻辑（纯原生JS，无外部依赖） */
"use strict";

/* ── 工具 ─────────────────────────────────── */
const $  = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => new Date().toISOString().slice(0, 10);

const STORE_KEY = "geodesk.v3";                 // 旧单项目键（迁移源，保留兜底）
const PKEY = "geodesk.projects";                // V4 项目层：{list, current}
const DEFAULT_OWN = ["cmsk1979.com", "cmhk.com", "mp.weixin.qq.com", "weixin.qq.com"];
const defaultState = (fresh, meta) => ({
  audit: Object.fromEntries(GEO.audit.flatMap(d => d.items.map(i => [i.id, 0]))),
  autoAudit: {},   /* V0.1.10：一键诊断自动填入的体检项（id→1）；人工点分即移除=转人工 */

  caliber: fresh ? buildCaliberScaffold(meta) : JSON.parse(JSON.stringify(GEO.caliberSeed)),   // V5 不带蛇口种子；V6 生成待填骨架（锚定+档位字段）
  prompts: fresh ? instPrompts(meta || {}, (meta || {}).matrixTier)    // V5：新项目按元数据实例化模板（不再继承蛇口30问）
                 : GEO.prompts.map(p => ({ id: p.id, cat: p.cat, q: p.q,
      severity: { "对比竞品": 5, "选址决策": 4, "品牌认知": 3, "产业服务": 3 }[p.cat] || 3 })),  // 非 fresh 仅作老项目/本地模式兼容基底
  ledger: [],
  battlefield: {},
  planInputs: {},
});

/* ── V4 项目层（多园区隔离）────────────────── */
let PROJECTS = [];   // [{id,name,url,brand,entityMode,ownDomains,createdAt,lastOpen}]
let ARCHIVED_PROJS = [];   // V4.6 归档项目（服务器返回，项目库「含已归档」开关下展示/恢复）
let CUR = null;      // 当前项目 id
/* V4.6 项目库工具栏状态：搜索/形态/状态/排序/含归档（大白话标签，形态=承载形态） */
const ENT_LABEL = { own: "有官网", parent: "挂上级官网", none: "无官网" };
const PJ_FILTERS = { q: "", mode: "all", status: "all", sort: "recent", archived: false };
const PJ_SORTS = [["recent", "最近活动"], ["stale", "最久未测"], ["score", "体检分"], ["created", "创建时间"], ["name", "名称"]];
const projKey = id => STORE_KEY + "." + id;
function curProjectId() { return CUR; }
function curProject() { return PROJECTS.find(p => p.id === CUR) || { id: CUR, name: "当前项目", url: "", brand: "", ownDomains: DEFAULT_OWN }; }
function curOwn() { const d = curProject().ownDomains; return (d && d.length) ? d : DEFAULT_OWN; }
/* V6 R5：判定合并——自有可控阵地 + 集团信源（解读分层见 ledgerStats/分析卡） */
function curOwnAll() { return [...new Set([...curOwn(), ...((curProject() || {}).groupDomains || [])])]; }
/* V4.5 承载形态：own=有独立官网 / parent=上级官网承载页 / none=暂无官网（实体体检路线，官网专属项不进分母）
   老项目无此字段时按 url 推导，蛇口网谷（填了上级官网）→parent */
function entMode() {
  const p = curProject();
  if (p.entityMode && ["own", "parent", "none"].includes(p.entityMode)) return p.entityMode;
  return (p.url || "").trim() ? "parent" : "none";
}
function noSite() { return entMode() === "none"; }
/* V6.0.1：体检文案分母跟承载形态（与计分口径一致：none=24，其余=30） */
function auditN() { return noSite() ? 24 : 30; }
/* V0.1.11 诊断表单预填（纯函数，e2e 可测）：值只来自当前项目——state.parkUrl 优先（本项目上次诊断保存的），
   其次项目元数据 url；品牌词=项目 brand||name。跨项目切换时调用方必须先清空表单再取本函数结果。 */
function diagPrefill(stateObj, proj) {
  return {
    url: String(((stateObj && stateObj.parkUrl) || (proj && proj.url) || "")).trim(),
    brand: String(((proj && (proj.brand || proj.name)) || "")).trim(),
  };
}
function projCtx() {
  const p = curProject() || {};
  const op = (p.operator || "").trim();
  return {
    park: (p.brand || p.name || "本园区").trim(),
    city: (p.city || "").trim(),
    industry: (p.industries && p.industries[0]) || "",
    competitors: (p.competitors || []).slice(0, 5),
    operator: op,
    operatorShort: op.replace(/（.*?）/g, "")
  };
}
/* V5 通用化文案本地化：知识库答案/Agent提示词里的种子项目（蛇口网谷）表述，
 * 仅在当前项目不是种子项目时替换为当前项目语境；蛇口网谷项目本身保持原文（背景对它是正确的）。 */
function isSeedParkCtx() {
  const p = curProject() || {};
  return (p.operator || "").includes("招商蛇口") || (p.brand || p.name || "") === "蛇口网谷";
}
function seedLocalize(text) {
  if (!text || isSeedParkCtx()) return text;
  const ctx = projCtx();
  const op = ctx.operator || ctx.park;
  let s = String(text);
  s = s.split("招商蛇口产业园区（招商产园）").join(op);
  s = s.split("招商产园").join(op);
  s = s.split("蛇口网谷").join(ctx.park);
  s = s.replace(/5）招商产园背景：[\s\S]*?(?=【工作方式】)/,
    `5）项目背景：${ctx.park}（${ctx.city || "城市待补"}，主导${ctx.industry || "产业待补"}）${ctx.competitors.length ? "；主要竞品：" + ctx.competitors.join("、") : ""}。涉及本项目的事实一律以系统口径表为准，不确定时明说。\n`);
  return s;
}
function saveProjectsMeta() { try { localStorage.setItem(PKEY, JSON.stringify({ list: PROJECTS, current: CUR })); } catch (e) {} }
/* V5：更新当前项目元数据（本地 PROJECTS 即时生效；服务器模式落库）。partial 只含变更字段。 */
async function saveProjMeta(partial) {
  const p = PROJECTS.find(x => x.id === CUR);
  if (!p) return;
  Object.assign(p, partial);
  saveProjectsMeta();
  if (SERVER_MODE) await API.updateProject(Object.assign({ id: CUR }, partial));
}
function loadCurrentState() {
  try { state = Object.assign(defaultState(), JSON.parse(localStorage.getItem(projKey(CUR)) || "{}")); }
  catch (e) { state = defaultState(); }
  /* V0.2.2 F3：承载形态唯一真相=项目元数据——每次装载无条件对齐 state.entityMode。
     此前仅在为空时回填：项目库内改非当前项目形态后，该项目 state 残留旧值，
     computeSnapshot（工作台体检成熟度/发展曲线分母）按 30 项计，与体检页 24 项口径不一致 */
  const _mode = entMode();
  if (state.entityMode !== _mode) { state.entityMode = _mode; try { save(); } catch (e) {} }
  migrateProbes();
  migrateStatsV2();
}
/* V4.2 一次性口径迁移：①信源记录补 channel="src"；②按新口径重算全部快照（保留原日期/ts/基线标记） */
function migrateStatsV2() {
  if (state.statsV2) return;
  let dirty = false;
  (state.ledger || []).forEach(r => { if ((r.engine === "搜索通道") && r.channel !== "src") { r.channel = "src"; dirty = true; } });
  if ((state.snapshots || []).length) {
    state.snapshots = state.snapshots.map(s => {
      const ns = computeSnapshot(s.type || "diag", state, s.date);
      ns.ts = s.ts || ns.ts; ns.baseline = !!s.baseline; dirty = true; return ns;
    });
  }
  state.statsV2 = true;
  save();
}
/* V4 1.4：历史「搜索通道」台账 note 里的前3域名 → probes 一次性填入（幂等：标志位 + 日期×问题ID 双保险去重） */
function migrateProbes() {
  /* 自愈：flag=true 但 probes 为空且台账仍有可填入 note（旧版曾把默认true同步上服务器）→ 照样填入 */
  const backfillable = (state.ledger || []).some(r => r.engine === "搜索通道" && (r.note || "").includes("前10="));
  if (state.probesBackfilled && ((state.probes || []).length > 0 || !backfillable)) return;
  state.probes = state.probes || [];
  const has = new Set(state.probes.map(p => p.date + "|" + p.promptId));
  (state.ledger || []).forEach(r => {
    if (r.engine === "搜索通道" && (r.note || "").includes("前10=")) {
      const key = r.date + "|" + r.promptId;
      if (has.has(key)) return;
      const doms = (r.note.split("前10=")[1] || "").split(/[，,]/).map(s => s.trim()).filter(Boolean);
      if (doms.length) { state.probes.push({ date: r.date, promptId: r.promptId, domains: doms, urls: [], ownHit: +r.mention === 1, partial: true }); has.add(key); }
    }
  });
  state.probesBackfilled = true; save();
}

/* V4 1.3：监测工具项目化——读点统一走当前项目 state.prompts（缺省时自愈拷贝，编辑不污染全局模板） */
const SEV_SEED = { "对比竞品": 5, "选址决策": 4, "品牌认知": 3, "产业服务": 3 };
function P_prompts() {
  if (state.prompts && state.prompts.length) return state.prompts;
  /* V5 通用化：空矩阵不再继承蛇口种子，按当前项目元数据实例化模板 */
  state.prompts = instPrompts(Object.assign({}, curProject() || {}, { district: caliberDistrict() }), (curProject() || {}).matrixTier);
  return state.prompts;
}
/* V5 模板实例化器：项目元数据 → 问题矩阵（缺参走各模板自带兜底问法） */
function instPrompts(meta, tier) {
  const bank = (GEO.promptTemplates || {})[tier] || (GEO.promptTemplates || {}).park || [];
  const m = {
    park: (meta.brand || meta.name || "本项目").trim(),
    city: (meta.city || "").trim(),
    district: (meta.district || meta.city || "").trim(),   /* V6 R3：区位词数据源=口径「所在片区/商圈」，由调用方注入（新建=城市兜底，重建=口径值） */
    industry: (meta.industries || []).map(s => String(s).trim()).filter(Boolean),
    competitors: (meta.competitors || []).map(s => String(s).trim()).filter(Boolean),
    operator: (meta.operator || "").trim(),
  };
  return bank.map(t => ({ id: t.id, cat: t.cat, q: t.q(m), severity: SEV_SEED[t.cat] || 3 }));
}
/* V6：读口径表锚定区的片区值（official 已填才算） */
function caliberDistrict() {
  try {
    const r = (state.caliber || []).find(x => x.field === "所在片区/商圈");
    return (r && r.official || "").trim();
  } catch (e) { return ""; }
}
/* V6 1.1：口径骨架——锚定区 + 档位字段（official 留空=待填，hint 放 source 列展示指引） */
function buildCaliberScaffold(meta) {
  const tier = ((meta || {}).matrixTier === "lite") ? "lite" : "park";
  const park = ((meta || {}).brand || (meta || {}).name || "本项目").trim();
  const mk = spec => ({ park, field: spec.field, official: "", asOf: "", source: "", hint: spec.hint, scaffold: true, conflicts: [] });
  return [
    ...(GEO.caliberScaffold.anchor || []).map(mk),
    ...(GEO.caliberScaffold[tier] || []).map(mk),
  ];
}
function P_cats() { const c = [...new Set(P_prompts().map(p => p.cat))]; return c.length ? c : GEO.promptCats; }

/* V4 1.6：批量粘贴解析（纯函数，node 可测）。列：日期 引擎 问题ID 提及 倾向 链接 竞品同时出现 备注（制表符或逗号分隔，首行可为表头） */
const BATCH_MENTION = { "提及": 1, "1": 1, "提及（含引用链接）": 1, "相似": 0.5, "0.5": 0.5, "仅相似表述": 0.5, "未提及": 0, "0": 0 };
const BATCH_SENT = { "正面": 1, "1": 1, "推荐": 1, "正面推荐": 1, "中性": 0.5, "0.5": 0.5, "负面": 0, "0": 0, "负面/错误信息": 0 };
function parseBatchRows(text, prompts) {
  const ids = new Set((prompts || P_prompts()).map(p => p.id));
  const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const rows = [], bad = [];
  lines.forEach((ln, i) => {
    const cols = ln.includes("\t") ? ln.split("\t") : ln.split(",");
    if (i === 0 && /日期|引擎/.test(cols[0] || "")) return;   // 表头行
    const c = cols.map(x => (x || "").trim());
    let date = /^\d{4}-\d{2}-\d{2}$/.test(c[0] || "") ? c[0] : null;
    let k = date ? 1 : 0;
    const row = {
      date: date || today(),
      engine: c[k] || "", promptId: c[k + 1] || "",
      mention: BATCH_MENTION[c[k + 2]], sentiment: BATCH_SENT[c[k + 3]] ?? 0.5,
      url: (c[k + 4] || "").replace(/^"|"$/g, ""),
      cooccur: (c[k + 5] || "").split(/[、;；\s]+/).map(s => s.trim()).filter(Boolean),
      note: (c[k + 6] || "").replace(/^"|"$/g, ""),
    };
    if (!row.engine || !ids.has(row.promptId) || row.mention === undefined) {
      bad.push(`第${i + 1}行：${ln.slice(0, 40)}…`);
    } else rows.push(row);
  });
  return { rows, bad };
}
/* V4 1.7：采样选择器（纯函数）——高严重度优先 + 覆盖最少的问题优先；引擎取人工记录最少的 2 个 */
function pickSample(prompts, ledger, engines) {
  const manual = (ledger || []).filter(r => r.engine !== "搜索通道");
  const cnt = pid => manual.filter(r => r.promptId === pid).length;
  const qs = (prompts || []).slice().sort((a, b) =>
    (+b.severity || 3) - (+a.severity || 3) || cnt(a.id) - cnt(b.id) || String(a.id).localeCompare(b.id))
    .slice(0, Math.min(10, (prompts || []).length));
  const engs = (engines || []).map(e => ({ e, n: manual.filter(r => r.engine === e).length }))
    .sort((a, b) => a.n - b.n || String(a.e).localeCompare(b.e, "zh")).slice(0, 2).map(x => x.e);
  return { qs, engs };
}

/* ══ V4 2.1 快照机制（GEO 发展曲线的数据基础）══ */
function computeSnapshot(type, st, asOf) {
  /* 纯函数（node 可测）：通道分层口径——答案侧（六引擎人工）与信源（搜索通道）分开，禁止混均。
     asOf：迁移历史快照时传入原日期，保证快照日期不漂移。 */
  const audit = st.audit || {};
  /* V4.5：无官网项目官网专属项（T1–T6）不进分母——30项里其余24项照常计分 */
  const siteIds = GEO.SITE_IDS || [];
  const ids = Object.keys(audit).filter(k => !(st.entityMode === "none" && siteIds.includes(k)));
  const auditPct = ids.length ? Math.round(ids.reduce((a, k) => a + (audit[k] || 0), 0) / (ids.length * 2) * 100) : 0;
  const ld = (st.ledger || []).filter(r => r.channel !== "src" && r.engine !== "搜索通道");
  const sd = (st.ledger || []).filter(r => r.channel === "src" || r.engine === "搜索通道");
  const mentionAns = ld.length ? Math.round(ld.reduce((a, r) => a + (+r.mention || 0), 0) / ld.length * 100) : null;
  const mentionSrc = sd.length ? Math.round(sd.reduce((a, r) => a + (+r.mention || 0), 0) / sd.length * 100) : null;
  const sdates = [...new Set(sd.map(r => r.date))].sort();
  const lastSd = sdates.length ? sd.filter(r => r.date === sdates[sdates.length - 1]) : [];
  /* V4.2 口径修正：「品牌词自有渠道」只统计品牌认知类问题的最近一轮命中，分母=当轮实测的品牌题数 */
  const brandIds = new Set(P_prompts().filter(p => p.cat === "品牌认知").map(p => p.id));
  const brandSd = lastSd.filter(r => brandIds.has(r.promptId));
  const ownHitN = brandSd.length ? brandSd.filter(r => +r.mention === 1).length : null;
  return { ts: Date.now(), date: asOf || today(), type, auditPct,
           diagFails: ((st.lastDiag || {}).checks || []).filter(x => x.status === "fail").length,
           mentionAns, mentionAnsN: ld.length, mentionSrc, mentionSrcN: sd.length,
           ownHitN, ownHitTotal: brandSd.length || null, ownHitDate: sdates[sdates.length - 1] || null };
}
function pushSnapshot(type) {
  state.snapshots = state.snapshots || [];
  const s = computeSnapshot(type, state);
  const i = state.snapshots.findIndex(x => x.date === s.date && x.type === type);
  if (i >= 0) state.snapshots[i] = s; else state.snapshots.push(s);
  state.snapshots.sort((a, b) => a.ts - b.ts);
  if (!state.snapshots.some(x => x.baseline)) state.snapshots[0].baseline = true;   /* 首个快照锁定为起始数据 */
  save();
}
function addEvent(type, label, date) {
  state.events = state.events || [];
  const d = date || today();
  if (state.events.some(e => e.date === d && e.label === label && e.type === type)) return;
  state.events.push({ date: d, type, label });
  state.events.sort((a, b) => a.date < b.date ? -1 : 1);
  save();
}
function initProjects() {
  let old = null, oldState = {};
  try { old = localStorage.getItem(STORE_KEY); if (old) oldState = JSON.parse(old) || {}; } catch (e) {}
  try {
    const meta = JSON.parse(localStorage.getItem(PKEY) || "null");
    if (meta && Array.isArray(meta.list) && meta.list.length) {
      PROJECTS = meta.list;
      CUR = (meta.current && meta.list.some(p => p.id === meta.current)) ? meta.current : meta.list[0].id;
    } else if (old) {
      /* 旧单项目数据 → 默认项目（一次性迁移；旧键保留兜底，不删）。名字用可读名，域名落 url 字段 */
      const pid = "p_default";
      PROJECTS = [{ id: pid, name: "蛇口网谷", url: String(oldState.parkUrl || "").slice(0, 120),
                    brand: "", ownDomains: DEFAULT_OWN, createdAt: today() }];
      CUR = pid;
      try { localStorage.setItem(projKey(pid), old); } catch (e) {}
      saveProjectsMeta();
    } else {
      /* V0.1.13 F2：全新本地（无旧数据）不再凭空造「蛇口网谷」——与服务器口径一致给示例项目 */
      PROJECTS = [{ id: "p_default", name: "示例项目", url: "", brand: "示例园区",
                    ownDomains: [], entityMode: "none", sample: true, createdAt: today() }];
      CUR = "p_default";
      saveProjectsMeta();
    }
  } catch (e) {
    PROJECTS = [{ id: "p_default", name: "示例项目", url: "", brand: "示例园区",
                  ownDomains: [], entityMode: "none", sample: true, createdAt: today() }];
    CUR = "p_default";
  }
  normalizeProjects();
  loadCurrentState();
}
/* 迁移期遗留：域名被直接当项目名 → 归一为可读名（域名不丢，落 url 字段；服务器返回的原始列表同样先过这里） */
const isDomainName = s => /^[\w-]+(\.[\w-]+)+$/.test(String(s || "").trim());
function normalizeProjects() {
  let dirty = false;
  PROJECTS.forEach(p => {
    if (p.id === "p_default" && !(p.brand || "").trim()) { p.brand = "蛇口网谷"; dirty = true; }   /* V4.2：种子项目品牌词补齐（供元数据同步与品牌词搜索使用） */
    if (!isDomainName(p.name)) return;
    if (!p.url) { p.url = p.name; dirty = true; }
    const pretty = (p.brand && p.brand.trim()) || (p.id === "p_default" ? "蛇口网谷" : p.name.replace(/^www\./, "").split(".")[0]);
    if (pretty && pretty !== p.name) { p.name = pretty; dirty = true; }
  });
  if (dirty) saveProjectsMeta();
}
async function switchProject(pid) {
  if (!pid) return;
  if (pid !== CUR) {
    CUR = pid;
    const pm = PROJECTS.find(p => p.id === pid);
    if (pm) pm.lastOpen = Date.now();   /* V4.6 项目库「上次处理」置顶数据（本机个人视角） */
    saveProjectsMeta();
    try { localStorage.setItem("geodesk.visited", "1"); } catch (e) {}   /* V4.7 进过项目即视为老用户，欢迎区不再显示 */
    /* V0.1.12 串页根治（BUG#1a）：诊断结果是「整体替换 #dgOut」的常驻 DOM 区，不随项目切换自动清空——
       换项目时先清空，进入诊断子页由 render.scan 按当前项目重建（有历史=重演结果，无历史=空态预检清单） */
    const dgOutEl = $("#dgOut"); if (dgOutEl) dgOutEl.innerHTML = "";
    loadCurrentState();
    renderProjectContext(); renderAllViews();
    if (SERVER_MODE) { await loadProjectFromServer(); renderProjectContext(); renderAllViews(); }
  }
  go("dashboard");
}
function renderAllViews() {
  render.dashboard(); render.caliber(); render.audit(); render.content(); render.plan(); render.agents(); render.knowledge(); render.projects();
  route();
}
function renderProjectContext() {
  document.title = "GEO 智控台 · " + (curProject().name || "");
  updateProjChip(CUR_VIEW);
}
/* 项目总览卡片的数据快照：读各项目本机缓存（进入项目后与系统同步为最新），无数据返回 null */
function projectSnapshot(p) {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(projKey(p.id)) || "null"); } catch (e) {}
  if (!st) return null;
  /* V4.5：none 项目官网专属项不进分母（与主体检表同口径） */
  const siteIds = GEO.SITE_IDS || [];
  const mode = st.entityMode || ((p.url || "").trim() ? "parent" : "none");
  const ids = Object.keys(st.audit || {}).filter(k => !(mode === "none" && siteIds.includes(k)));
  const got = ids.reduce((a, k) => a + (st.audit[k] || 0), 0);
  const led = st.ledger || [];
  const dates = led.map(r => r && r.date).filter(Boolean);
  (st.diagHistory || []).forEach(d => { if (d && d.date) dates.push(d.date); if (d && d.ts) dates.push(String(d.ts).slice(0, 10)); });
  dates.sort();
  /* V4.6 待办（与 server proj_summary 同口径）：整改工单未验收 + 修复队列未验证 */
  let wo = 0;
  Object.values(st.remediation || {}).forEach(per => { Object.values(per || {}).forEach(s => { if (s !== "已验收") wo++; }); });
  (st.fixQueue || []).forEach(o => { if ((o || {}).status !== "已验证") wo++; });
  const dh = st.diagHistory || [];
  return { pct: ids.length ? Math.round(got / (ids.length * 2) * 100) : null, n: led.length,
           last: dates.length ? dates[dates.length - 1] : null,
           woPending: wo, lastDiag: dh.length ? String(dh[0].ts || "").slice(0, 10) : "", entMode: mode };
}
async function submitNewProject() {
  const name = $("#npName").value.trim();
  if (!name) { toast("请填写项目名称"); return; }
  const modeEl = document.querySelector('input[name="npMode"]:checked');
  const mode = modeEl ? modeEl.value : "parent";
  const urlRaw = $("#npUrl").value.trim().slice(0, 120);
  if (mode !== "none" && !urlRaw) { toast("请填官方承载页域名；确实没有就选「暂时都没有」"); return; }
  const meta = {
    name: name.slice(0, 60),
    url: mode === "none" ? "" : urlRaw,
    brand: $("#npBrand").value.trim().slice(0, 60),
    operator: ($("#npOperator") ? $("#npOperator").value.trim() : "").slice(0, 60),
    entityMode: mode,
    city: ($("#npCity") ? $("#npCity").value.trim() : "").slice(0, 40),
    industries: ($("#npInd") ? $("#npInd").value : "").split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5),
    competitors: ($("#npComp") ? $("#npComp").value : "").split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5),
    matrixTier: (document.querySelector('input[name="npTier"]:checked') || {}).value || "park",
    ownDomains: $("#npOwn").value.split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean).slice(0, 20),
    createdAt: today(),
  };
  if (SERVER_MODE) {
    const r = await API.createProject(meta);
    if (!r || r.error || !r.id) { toast("服务器新建失败：" + ((r && r.error) || "未知错误")); return; }
    meta.id = r.id;
    PROJECTS.push(meta);
  } else {
    meta.id = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    PROJECTS.push(meta);
  }
  CUR = meta.id; saveProjectsMeta();
  REV_BASE = 0; SERVER_BASE = null;   /* V4修复①：新项目系统 rev 从 0 起，必须重置乐观锁起始数据（否则沿用上一项目 REV_BASE → 永久 409） */
  state = defaultState(true, meta);
  state.entityMode = mode;            /* V4.5：快照分母感知承载形态（none 时 T1–T6 不计分） */
  state.probesBackfilled = true;   /* V4修复③（正确层级）：新建项目无 V3 历史note，免填入；老项目state无此键→正常填入 */
  save();
  closeProjModal();   /* V0.1.12 BUG#2：创建成功也清空表单——防旧草稿残留到下次新建 */
  /* V5：新建即按元数据实例化问题矩阵（模板自带兜底问法，不再需要 V4.2 的名字替换补丁） */
  renderProjectContext(); renderAllViews();
  go("dashboard");
  /* V0.1.12 F6：指引统一为「起步四步」顺序（先口径后体检，与物料取数的数据依赖一致），消除与工作台清单的矛盾 */
  toast(`项目「${meta.name}」已创建，问题矩阵已按本项目生成（${state.prompts.length} 问）。下一步：先到「口径表」把最关键的几项数据定下来（约10分钟），${mode === "none" ? "再到「诊断 → 实体体检」用品牌词查网上存在感" : "再到「诊断 → 一键诊断」跑体检"}`);
  brandCheckHint(meta.brand, meta.city, async nb => { meta.brand = nb; await saveProjMeta({ brand: nb }); state.prompts = instPrompts(Object.assign({}, meta, { district: caliberDistrict() }), meta.matrixTier); save(); renderAllViews(); });
}
let state = {};   /* 由 initProjects() → loadCurrentState() 按 CUR 填充（调用在文件末尾，save 定义之后，避免 TDZ） */
/* save() 定义在服务器模式区块（本地即时存 + 服务器防抖同步） */

/* ── V0.1.12 新建弹窗纪律（BUG#2/3）：取消/创建成功/ESC 关闭一律清空草稿，
   弹窗打开期间捕获键盘焦点（Tab 循环 + ESC 关闭）——键盘用户不再散焦到背景页 ── */
function resetNewProjForm() {
  ["npName", "npUrl", "npBrand", "npCity", "npInd", "npComp", "npOperator", "npOwn", "npGroup"]
    .forEach(id => { const el = $("#" + id); if (el) el.value = ""; });
  const m = document.querySelector('input[name="npMode"][value="parent"]'); if (m) m.checked = true;
  const t = document.querySelector('input[name="npTier"][value="park"]'); if (t) t.checked = true;
  const lb = $("#npUrlLb"); if (lb) lb.firstChild.textContent = "官网网址（可后补，用于一键诊断）";
}
function closeProjModal() { $("#projModal").hidden = true; resetNewProjForm(); }
function openModalMask() {
  const pm = $("#projModal"), em = $("#projEditModal");
  if (pm && !pm.hidden) return pm;
  if (em && !em.hidden) return em;
  return null;
}
function bindModalKeyboard() {
  document.addEventListener("keydown", e => {
    const mask = openModalMask(); if (!mask) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (mask.id === "projModal") closeProjModal();
      else mask.hidden = true;   /* 编辑弹窗：ESC=取消（未保存的修改丢弃，与取消钮一致） */
      return;
    }
    if (e.key !== "Tab") return;
    const f = $$("button, input, select, textarea, [href]", mask)
      .filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!mask.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function download(filename, content, mime) {
  const blob = new Blob(["\uFEFF" === content.slice(0,1) ? content : content], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast("已复制 ✓"); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("已复制 ✓"); } catch (e2) { toast("复制失败，请手动选择文本"); }
    ta.remove();
  }
}

/* ── 服务器模式（可选后台）─────────────────── */
let SERVER_MODE = false;
let REV_BASE = null;        // 服务器版本号（乐观锁）
let SERVER_BASE = null;     // 最近一次与服务器一致的快照（用于冲突时字段级合并）
const API = {
  async ping() { try { const r = await fetch("/api/ping", { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; } },
  async load(pid) { try { const r = await fetch("/api/data" + (pid ? "?project=" + encodeURIComponent(pid) : "")); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } },
  async projects() { try { const r = await fetch("/api/projects"); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } },
  async createProject(p) { try { const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); return await r.json(); } catch (e) { return { error: String(e) }; } },
  async updateProject(p) { try { const r = await fetch("/api/projects/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); return await r.json(); } catch (e) { return { error: String(e) }; } },
  async save(obj, baseRev, audit) {
    try {
      const body = { project: CUR, state: obj, base_rev: baseRev, operator: (localStorage.getItem("geodesk.operator") || "") };
      /* V0.1.13 F7：批任务静默保存（不逐条留痕）或聚合留痕（一条带动作名的记录） */
      if (audit && audit.silent) body.auditSilent = true;
      if (audit && audit.action) { body.auditAction = audit.action; body.auditDetail = audit.detail || ""; }
      return await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { return null; }
  },
  async probe(q, ownDomains) { try { const r = await fetch("/api/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, ownDomains: ownDomains || curOwn() }) }); return await r.json(); } catch (e) { return { error: String(e) }; } },
  async botStart(payload) { try { const r = await fetch("/api/answerbot/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); return await r.json(); } catch (e) { return { error: String(e) }; } },
  async botStatus(runId) { try { const r = await fetch("/api/answerbot/status?runId=" + encodeURIComponent(runId), { signal: AbortSignal.timeout(8000) }); if (!r.ok) return { error: "进度查询失败" }; return await r.json(); } catch (e) { return { error: String(e) }; } },
  async botConfig() { try { const r = await fetch("/api/answerbot/config", { signal: AbortSignal.timeout(4000) }); if (!r.ok) return { configured: false }; return await r.json(); } catch (e) { return { configured: false }; } },
  async botSaveConfig(cfg) { try { const r = await fetch("/api/answerbot/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }); return await r.json(); } catch (e) { return { configured: false, error: String(e) }; } },
};
/* 冲突合并：本机改过的字段以本机为准，未改字段用服务器新版；台账取并集（不丢任何人的记录） */
function mergeServerState(server, local, base) {
  const merged = Object.assign({}, server);
  for (const k of ["audit", "caliber", "prompts", "battlefield", "planInputs", "lastDiag", "diagHistory", "parkUrl"]) {
    if (JSON.stringify(local[k]) !== JSON.stringify(base ? base[k] : undefined)) merged[k] = local[k];
  }
  if (JSON.stringify(local.ledger) !== JSON.stringify(base ? base.ledger : undefined)) {
    const sLedger = Array.isArray(server.ledger) ? server.ledger : [];   /* V4修复②：新建项目系统 state={} 无 ledger 键，防 undefined.concat */
    const seen = new Set(sLedger.map(r => JSON.stringify(r)));
    merged.ledger = sLedger.concat((local.ledger || []).filter(r => !seen.has(JSON.stringify(r))));
  }
  /* V4 二期：快照/事件/资产等 append-only 结构同样取并集（不丢任何一端的记录） */
  for (const k of ["snapshots", "events", "watchPages", "evidence", "fixQueue", "business"]) {
    const sv = Array.isArray(server[k]) ? server[k] : [];
    const lv = Array.isArray(local[k]) ? local[k] : [];
    if (JSON.stringify(lv) !== JSON.stringify(base ? base[k] : undefined)) {
      const seen = new Set(sv.map(x => JSON.stringify(x)));
      merged[k] = sv.concat(lv.filter(x => !seen.has(JSON.stringify(x))));
    }
  }
  delete merged._rev;
  return merged;
}
async function serverSave() {
  const r = await API.save(state, REV_BASE, SAVE_AUDIT);
  SAVE_AUDIT = null;   /* V0.1.13 F7：留痕指令一次性消费（防后续普通保存误带聚合动作名） */
  if (!r) return;
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (r.status === 409 && d.state) {
    const merged = mergeServerState(d.state, state, SERVER_BASE);
    state = merged; REV_BASE = d.rev; SERVER_BASE = JSON.parse(JSON.stringify(merged));
    try { localStorage.setItem(projKey(CUR), JSON.stringify(state)); } catch (e) {}
    toast("检测到他人更新，已自动合并保存（台账取并集）");
    return serverSave();
  }
  if (d.rev) { REV_BASE = d.rev; SERVER_BASE = JSON.parse(JSON.stringify(state)); }
}
let saveTimer;
let SAVE_AUDIT = null;   /* V0.1.13 F7：save({silent}) 批内不留痕 / save({action,detail}) 聚合一条留痕（防抖合并后最后一次生效） */
const save = (opts) => {
  if (window.Tour && window.Tour.active) return;   /* V6.1 引导演示态只读：演示数据绝不写入本机/服务器 */
  if (opts) SAVE_AUDIT = opts.silent ? { silent: true } : (opts.action ? { action: opts.action, detail: opts.detail || "" } : null);
  try { localStorage.setItem(projKey(CUR), JSON.stringify(state)); } catch (e) {}
  if (SERVER_MODE) { clearTimeout(saveTimer); saveTimer = setTimeout(serverSave, 400); }
};
/* V0.2.2 F4：页面卸载/切后台时强制 flush 防抖中的保存（keepalive）——
   此前 400ms 防抖窗口内刷新/关闭，服务器旧态会在下次装载时整包覆盖本地新态，最后一次改动丢失 */
async function serverSaveFlush(keepalive) {
  if (!SERVER_MODE || !saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  try {
    const body = { project: CUR, state, base_rev: REV_BASE, operator: (localStorage.getItem("geodesk.operator") || "") };
    if (SAVE_AUDIT && SAVE_AUDIT.silent) body.auditSilent = true;
    if (SAVE_AUDIT && SAVE_AUDIT.action) { body.auditAction = SAVE_AUDIT.action; body.auditDetail = SAVE_AUDIT.detail || ""; }
    await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), keepalive: !!keepalive });
    SAVE_AUDIT = null;
  } catch (e) { /* flush 失败不打断卸载；localStorage 仍保有数据 */ }
}
async function loadProjectFromServer() {
  const remote = await API.load(CUR);
  if (!remote || typeof remote !== "object") return;
  const rev = remote._rev ?? null;
  delete remote._rev; delete remote._project;
  REV_BASE = rev;
  const hasRemote = remote.audit || remote.ledger || remote.caliber || remote.diagHistory;
  let localRaw = null;
  try { localRaw = localStorage.getItem(projKey(CUR)); } catch (e) {}
  if (!hasRemote && localRaw && localRaw !== "{}") {
    /* 服务器空、本机有未同步数据 → 静默保留本机（保存时走合并协议上传），不打扰用户 */
    loadCurrentState();
    SERVER_BASE = JSON.parse(JSON.stringify(state));
  } else {
    state = Object.assign(defaultState(), remote);
    try { localStorage.setItem(projKey(CUR), JSON.stringify(state)); } catch (e) {}
    migrateProbes();   /* V4修复：服务器分支也要走历史note填入（老项目首载即填入并同步） */
    migrateStatsV2();  /* V4.2：服务器分支同样执行口径迁移（channel标记+快照重算） */
    SERVER_BASE = JSON.parse(JSON.stringify(state));
  }
  /* V0.2.2 F3：服务器态装载后再对齐承载形态——此刻 PROJECTS 元数据已从服务器刷新，
     项目库内改非当前项目形态后进入该项目，state.entityMode 不再残留旧值（快照/体检分母一致） */
  const _mode2 = entMode();
  if (state.entityMode !== _mode2) { state.entityMode = _mode2; try { save(); } catch (e) {} }
}
async function initServerMode() {
  if (!(await API.ping())) return;
  SERVER_MODE = true;
  const remote = await API.projects();
  if (remote && Array.isArray(remote.projects)) {
    /* 本地独有项目（离线创建）首次连服务器时上传归档 */
    const have = new Set(remote.projects.map(p => p.id));
    for (const p of PROJECTS) {
      if (have.has(p.id)) continue;
      const cr = await API.createProject(p);
      if (cr && cr.id) {
        let st = {}; try { st = JSON.parse(localStorage.getItem(projKey(p.id)) || "{}"); } catch (e) {}
        try {
          await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project: cr.id, state: Object.assign(defaultState(), st), base_rev: 0 }) });
        } catch (e) {}
      }
    }
    /* V4.2 元数据单一真相：本机此前显示的可读名/品牌词/运营主体一次性回写服务器，
       修复服务器端仍存域名式旧名（如 p_default name=www.cmsk1979.com）的历史遗留 */
    const localMeta = Object.fromEntries(PROJECTS.map(p => [p.id, p]));
    const fresh0 = await API.projects();
    for (const sp of fresh0.projects) {
      const lm = localMeta[sp.id];
      if (!lm) continue;
      const diff = (lm.name && lm.name !== sp.name) || ((lm.brand || "") !== (sp.brand || "")) ||
        ((lm.operator || "") !== (sp.operator || "")) || ((lm.entityMode || "") !== (sp.entityMode || "")) ||
        ((lm.city || "") !== (sp.city || "")) || JSON.stringify(lm.industries || []) !== JSON.stringify(sp.industries || []) ||
        JSON.stringify(lm.competitors || []) !== JSON.stringify(sp.competitors || []) || ((lm.matrixTier || "park") !== (sp.matrixTier || "park")) ||
        JSON.stringify(lm.groupDomains || []) !== JSON.stringify(sp.groupDomains || []) ||
        JSON.stringify(lm.ownDomains || []) !== JSON.stringify(sp.ownDomains || []);
      if (diff) await API.updateProject({ id: sp.id, name: lm.name, brand: lm.brand || "", operator: lm.operator || "", entityMode: lm.entityMode || "",
        city: lm.city || "", industries: lm.industries || [], competitors: lm.competitors || [], matrixTier: lm.matrixTier || "park",
        groupDomains: lm.groupDomains || [], ownDomains: lm.ownDomains || sp.ownDomains || [] });
    }
    const fresh = await API.projects();
    /* V4.6 活跃/归档分离：PROJECTS=可进入项目；ARCHIVED_PROJS=项目库「含已归档」开关下灰显+可恢复 */
    const mapP = p => ({ id: p.id, name: p.name, url: p.url || "", brand: p.brand || "",
                         operator: p.operator || "", entityMode: p.entityMode || "", archived: !!p.archived,
                         city: p.city || "", industries: p.industries || [], competitors: p.competitors || [],
                         matrixTier: p.matrixTier || "park",
                         groupDomains: p.groupDomains || [],
                         ownDomains: p.ownDomains || [], createdAt: p.createdAt });
    ARCHIVED_PROJS = fresh.projects.filter(p => p.archived).map(mapP);
    PROJECTS = fresh.projects.filter(p => !p.archived).map(p => {
      const local = PROJECTS.find(x => x.id === p.id);
      return Object.assign(mapP(p), local && local.lastOpen ? { lastOpen: local.lastOpen } : {});
    });
    if (!PROJECTS.some(p => p.id === CUR) && PROJECTS.length) CUR = PROJECTS[0].id;
    saveProjectsMeta();
  }
  await loadProjectFromServer();
  normalizeProjects();          /* 兜底：服务器列表若仍有域名式旧名（离线时未同步），展示前归一 */
  renderProjectContext();
  $("#probeCard").hidden = false;
}
async function runProbe() {
  const q = $("#probeQ").value.trim();
  if (!q) { toast("请输入查询词"); return; }
  const out = $("#probeOut");
  const btn = $("#probeRun");
  btn.classList.add("is-busy"); btn.textContent = "检测中…";
  out.innerHTML = '<p class="muted">真实搜索中（调用本机搜索通道，约2–5秒）…</p>';
  const res = await API.probe(q);
  btn.classList.remove("is-busy"); btn.textContent = "检测";
  if (res.error) { out.innerHTML = `<p class="muted" style="color:var(--color-bad)">检测失败：${esc(res.error)}</p>`; return; }
  const OWN = curOwn();   /* V4：自有渠道判定用当前项目的域名 */
  /* V0.2.2 F10：括号修复——原 `join("") || '<p>' + 脚注` 因 || 优先于 + 生效，有结果时口径脚注被短路永不渲染 */
  out.innerHTML = ((res.results || []).map((r, i) => {
    const own = OWN.some(d => (r.url || "").includes(d));
    return `<div class="prompt-li"><span class="code num">${String(i + 1).padStart(2, "0")}</span>
      <span style="flex:1;min-width:0">${own ? '<span class="tag tag-ok">自有渠道</span> ' : ""}${esc(r.title || "(无标题)")}<br>
      <a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--color-info);font-size:12px;word-break:break-all">${esc(r.url)}</a></span></div>`;
  }).join("") || '<p class="muted">无结果</p>') +
    `<p class="muted" style="margin-top:8px">信源口径：这是实时检索通道的素材池。若前10无自有渠道，AI 引用时只能依赖第三方信源——与 2026-09-04 起始数据同方法。</p>`;
}

/* ── 路由（金字塔：一级阶段 + 二级子页）──── */
const VIEWS = ["projects", "dashboard", "diag", "act", "monitor", "knowledge"];
const SUBS = { diag: ["scan", "report", "audit", "caliber", "score", "evidence"], act: ["toolkit", "plan", "agent"] };
const LEGACY = { caliber: "diag/caliber", audit: "diag/audit", content: "diag/score", plan: "act/plan", agents: "act/agent", brief: "act/toolkit", scan: "diag/scan", toolkit: "act/toolkit" };
function go(v) { location.hash = "#/" + v; }
/* V4.7 落地分流：回访者直进上次项目工作台（连续工作零成本）；新用户/新设备进项目库
   （有真实项目卡片+全貌导航，不再是空白墙）；全新部署进项目库空态=欢迎页 */
function landingView() {
  if (!PROJECTS.length) return "projects";
  const cur = PROJECTS.find(p => p.id === CUR);
  return (cur && cur.lastOpen) ? "dashboard" : "projects";
}
function route() {
  { const nb = document.querySelector('[data-sub="audit"]'); if (nb) { const i = nb.querySelector("i"); nb.textContent = ""; if (i) nb.appendChild(i); nb.appendChild(document.createTextNode(auditN() + "项体检")); } }
  let path = (location.hash || "").replace(/^#\/?/, "");
  if (LEGACY[path]) { location.hash = "#/" + LEGACY[path]; return; }
  const [view, subRaw] = path.split("/");
  if (!VIEWS.includes(view)) { go(landingView()); return; }   /* V4.7：空 hash 按身份分流（原默认 projects） */
  const v = view;
  CUR_VIEW = v;
  updateProjChip(v);
  const subs = SUBS[v] || null;
  let sub = null;
  if (subs) {
    sub = subs.includes(subRaw) ? subRaw : subs[0];
    $$(".sub-view", $("#view-" + v)).forEach(s => s.hidden = s.id !== "sub-" + sub);
    $$("[data-subnav=" + v + "] button").forEach(b => b.classList.toggle("on", b.dataset.sub === sub));
  }
  /* V4.2：#/act/brief 直达「内容选题单」卡（原为死路由，只落到子页顶部） */
  if (v === "act" && subRaw === "brief") {
    setTimeout(() => {
      const card = $("#briefCard");
      if (!card) return;
      card.scrollIntoView({ behavior: "auto", block: "start" });   /* instant：后台标签页 rAF 暂停会卡住 smooth 动画 */
      card.style.outline = "2px solid var(--color-accent)";
      setTimeout(() => { card.style.outline = ""; }, 2200);
    }, 120);
  }
  $$(".view").forEach(s => s.hidden = s.id !== "view-" + v);
  /* V4.7 主导航全站常驻：项目库页也显示（新人一眼看到系统全貌，点导航即进当前项目对应功能）；
     项目库页无 tab 高亮（它是入口层不是功能页） */
  $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.view === v));
  window.scrollTo(0, 0);
  if (v === "projects") render.projects();
  else if (v === "dashboard") render.dashboard();
  else if (v === "monitor") render.monitor();
  else if (v === "knowledge") render.knowledge();
  else if (v === "diag") {
    if (sub === "scan") render.scan && render.scan();
    if (sub === "report") render.report && render.report();
    if (sub === "audit") render.audit();
    if (sub === "caliber") render.caliber();
    if (sub === "score") render.content();
    if (sub === "evidence") render.evidence && render.evidence();
  }
  else if (v === "act") {
    if (sub === "toolkit") { render.toolkit && render.toolkit(); renderWatch(); }
    if (sub === "plan") render.plan();
    if (sub === "agent") render.agents();
  }
}

/* ── 计算 ─────────────────────────────────── */
/* V0.1.10 诊断自动填入（纯函数，e2e 可驱动）。修复：老项目 doc 的 audit 字段可能稀疏
   （Object.assign 覆盖默认 30 键），旧逻辑用 hasOwnProperty 判定 → 全部跳过 →「填入 0 项」
   的假闭环。现在只认 GEO.audit 的合法 id，0 分（=未评分，含缺失）即填入并记 autoAudit 痕；
   ≥1 分视为已有人工评分保持不覆盖。 */
function applyAutoScores(map) {
  const out = { filled: 0, kept: 0 };
  const ids = new Set(GEO.audit.flatMap(d => d.items.map(i => i.id)));
  state.autoAudit = state.autoAudit || {};
  Object.entries(map || {}).forEach(([k, v]) => {
    if (!ids.has(k)) return;
    if ((state.audit[k] || 0) === 0) {
      state.audit[k] = v;
      state.autoAudit[k] = 1;   /* 0 分也留痕：该项系统实测未通过，可溯源 */
      out.filled++;
    } else out.kept++;
  });
  return out;
}
function auditScore() {
  /* V4.5：无官网项目官网专属项不进分母（与 computeSnapshot 同口径）；分母为空时按 0 分防 NaN */
  const ids = Object.keys(state.audit).filter(k => !(noSite() && (GEO.SITE_IDS || []).includes(k)));
  const got = ids.reduce((a, k) => a + (state.audit[k] || 0), 0);
  return { got, full: ids.length * 2, pct: ids.length ? Math.round(got / (ids.length * 2) * 100) : 0 };
}
function auditDims() {
  const skip = noSite() ? (GEO.SITE_IDS || []) : [];
  return GEO.audit.map(d => {
    const items = d.items.filter(i => !skip.includes(i.id));
    const got = items.reduce((a, i) => a + (state.audit[i.id] || 0), 0);
    return { dim: d.dim, got, full: items.length * 2, pct: items.length ? Math.round(got / (items.length * 2) * 100) : 0, skipped: d.items.length - items.length };
  });
}
/* V0.2.4 体检读分说明：按当前打分实时生成的大白话诊断叙述——分数怎么来 / 说明了什么 / 优先补哪里。
   全部由数据推导（无预置结论），分数变叙述跟着变；品宣岗不用问人也能读懂这份分数。 */
function auditStory(s, dims) {
  const skip = noSite() ? (GEO.SITE_IDS || []) : [];
  const flat = GEO.audit.flatMap(d => d.items.filter(i => !skip.includes(i.id))
    .map(i => ({ dim: d.dim, id: i.id, t: esc(i.t), v: +(state.audit[i.id] || 0) })));
  const scored = flat.filter(i => i.v > 0), zeros = flat.filter(i => i.v === 0);
  const autoN = Object.keys(state.autoAudit || {}).filter(k => flat.some(i => i.id === k)).length;
  const lv = s.pct >= 80 ? "优秀" : s.pct >= 60 ? "良好" : s.pct >= 40 ? "待改进" : s.pct > 0 ? "起步" : "未开始";
  const LV_SAY = {
    未开始: "还没有起始数据。先跑一次诊断或实体体检，系统会自动填入一部分分，再逐项补。",
    起步: "分数很低，该做的事大部分还没做。AI 回答选址类问题时基本不会提到这个园区，也没有可引用的出处。",
    待改进: "有基础了。AI 有时会提到这个园区，但信息零散，排位常在竞品和中介后面。",
    良好: "AI 能比较稳定地提到这个园区，各处说法基本一致。差的是覆盖面：被提到的场景和可引用的权威出处还不够多。",
    优秀: "AI 回答选址类问题时会稳定提到这个园区，各处口径一致。接下来是日常维护：保持内容更新，双周跑一轮监测。",
  };
  /* ① 分数怎么来 */
  let p1 = `计分 ${flat.length} 项 × 每项 0/1/2 分，满分 ${flat.length * 2}；左边环上的大数字是同一分数的百分制（${s.pct}/100）。`;
  p1 += s.got === 0 ? "目前 0 分：所有计分项都未得分。"
    : `现在的 ${s.got} 分来自${scored.length > 4
        ? scored.slice(0, 4).map(i => `「${i.t}」${i.v} 分`).join("、") + ` 等 ${scored.length} 项`
        : scored.map(i => `「${i.t}」${i.v} 分`).join("、")}；其余 ${zeros.length} 项还是 0 分。`;
  if (autoN) p1 += `其中 ${autoN} 项由诊断自动填入（重跑诊断自动更新，人工点分即转为人工）。`;
  if (noSite()) p1 += "本项目无官网：「技术可达」6 项不计数、不拖分，有官网后回来补测。";
  /* ② 说明了什么 */
  const counted = dims.filter(d => d.full > 0), zeroDims = counted.filter(d => d.got === 0);
  let p2 = `当前等级「${lv}」：${LV_SAY[lv]}`;
  if (zeroDims.length && zeroDims.length < counted.length) {
    p2 += ` 完全空白的是${zeroDims.slice(0, 3).map(d => `「${d.dim}」：${(GEO.dimMeans || {})[d.dim] || ""}`).join("；")}${zeroDims.length > 3 ? ` 等 ${zeroDims.length} 组` : ""}。`;
  } else if (zeroDims.length) {
    p2 += " 五个方向都还是 0 分。";
  }
  const lead = counted.filter(d => d.got > 0).sort((a, b) => a.pct - b.pct)[0];
  if (lead && lead.pct <= 50) p2 += ` 开了头的「${lead.dim}」也只有 ${lead.got}/${lead.full}，刚起步。`;
  /* ③ 优先补哪里（按最空白优先；同分按方法论顺序） */
  const TIE = noSite() ? ["实体与权威", "内容可摘录", "生态布源", "监测治理"] : ["技术可达", "内容可摘录", "实体与权威", "生态布源", "监测治理"];
  const todo = counted.filter(d => d.pct < 100)
    .sort((a, b) => a.pct - b.pct || TIE.indexOf(a.dim) - TIE.indexOf(b.dim)).slice(0, 2);
  const act = d => (GEO.dimActions || {})[d.dim] || "对照该组各项小字标准逐项补齐";
  const p3 = todo.length
    ? `按「最空白、最影响被 AI 引用」排序，先补这两组：<br>① 「${todo[0].dim}」（${todo[0].got}/${todo[0].full}）：${act(todo[0])}` +
      (todo[1] ? `<br>② 「${todo[1].dim}」（${todo[1].got}/${todo[1].full}）：${act(todo[1])}` : "") +
      `<br>每完成一组回来逐项打分，分数如实上涨；带「自动」标的项重跑诊断即自动更新。`
    : "五个方向都已满分——保持双周监测与季度复盘即可。";
  return `<div class="card audit-story">
    <h3>这份分数说明什么 <span class="hint">随打分实时更新 · 数字怎么读 / 问题在哪 / 先补哪里</span></h3>
    <p><span class="st-lb">分数怎么来：</span>${p1}</p>
    <p><span class="st-lb">说明了什么：</span>${p2}</p>
    <p><span class="st-lb">优先补哪里：</span>${p3}</p>
  </div>`;
}
function ledgerStats() {
  /* V4.2 口径分层：答案侧=六引擎人工轮；信源侧=搜索通道自动轮（channel="src"）。
     所有指标只统计答案侧；信源命中单独由快照/computeSnapshot 的 mentionSrc 表达，禁止混均。
     V0.1.12（BUG#4）：答案侧再分层——人工行才是「人工实测」基线，AI代问行（src=api）单独计数
     （与 server 写入口径一致：AI 行 src="api"），KPI 文案分开报数，不再把 AI 行冒充人工实测。 */
  const L = state.ledger;
  const isSrc = r => r.channel === "src" || r.engine === "搜索通道";
  const isAI = r => r.src === "api" || /AI代问/.test(r.note || "");
  if (!L.length) return { n:0, ansN:0, aiN:0, mention:null, pos:null, engines:new Set(), share:null };
  const ans = L.filter(r => !isSrc(r) && !isAI(r));
  const mention = ans.length ? ans.reduce((a, r) => a + (+r.mention || 0), 0) / ans.length : null;
  const posBase = ans.filter(r => +r.mention > 0);
  const pos = posBase.length ? posBase.reduce((a, r) => a + (+r.sentiment || 0), 0) / posBase.length : null;
    const withUrl = ans.filter(r => (r.url || "").trim());
    const OWN = curOwn();   /* V4：引用份额按当前项目自有域名计算；V5：hostname 后缀匹配（与 server _own_hit 同口径） */
    const GRP = (curProject() || {}).groupDomains || [];   /* V6 R5：集团信源——判定合并、解读分层 */
  const hitOwn = r => { try { const h = new URL(r.url).hostname.toLowerCase(); return OWN.some(d => h === d.toLowerCase() || h.endsWith("." + d.toLowerCase())); } catch (e) { return false; } };
  const hitGrp = r => { try { const h = new URL(r.url).hostname.toLowerCase(); return !hitOwn(r) && GRP.some(d => h === d.toLowerCase() || h.endsWith("." + d.toLowerCase())); } catch (e) { return false; } };
  const own = withUrl.filter(hitOwn), grp = withUrl.filter(hitGrp);
  return { n:L.length, ansN:ans.length, aiN:L.filter(r => !isSrc(r) && isAI(r)).length, mention, pos, engines:new Set(L.map(r => r.engine)), share: withUrl.length ? (own.length + grp.length) / withUrl.length : null,
           ownC: own.length, ownG: grp.length };
}
function heatData() {
  /* 引擎(+搜索通道+台账中出现的其他引擎) × 问题类别 提及率（来自台账，问题取当前项目矩阵） */
  const extra = [...new Set(state.ledger.map(r => r.engine))]
    .filter(e => e !== "搜索通道" && !GEO.engines.some(g => g.name === e));
  const rows = GEO.engines.concat(extra.map(n => ({ name: n })), [{ name: "搜索通道" }]);
  const cells = {};
  rows.forEach(e => P_cats().forEach(c => cells[e.name + "|" + c] = { hit: 0, n: 0 }));
  state.ledger.forEach(r => {
    const p = P_prompts().find(x => x.id === r.promptId);
    if (!p || !cells[r.engine + "|" + p.cat]) return;
    cells[r.engine + "|" + p.cat].n++;
    cells[r.engine + "|" + p.cat].hit += +r.mention || 0;
  });
  return cells;
}

/* ── SVG 生成 ─────────────────────────────── */
function ringSvg(pct, color) {
  const R = 52, C = 2 * Math.PI * R, off = C * (1 - pct / 100);
  return `<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="得分 ${pct}%">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--color-paper-3)" stroke-width="12"/>
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 70 70)"/>
    <text x="70" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="30" font-weight="600" fill="var(--color-ink)">${pct}</text>
    <text x="70" y="90" text-anchor="middle" font-size="11" fill="var(--color-ink-3)">/ 100</text>
  </svg>`;
}
function radarSvg(dims) {
  const cx = 130, cy = 115, R = 80, n = dims.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const rings = [0.33, 0.66, 1].map(f =>
    `<polygon points="${dims.map((_, i) => pt(i, R * f).map(x => x.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--color-line)"/>`).join("");
  const axes = dims.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--color-line)"/>`; }).join("");
  const val = dims.map((d, i) => pt(i, R * Math.max(0.04, d.pct / 100)).map(x => x.toFixed(1)).join(",")).join(" ");
  const labels = dims.map((d, i) => {
    const [x, y] = pt(i, R + 18);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--color-ink-2)">${esc(d.dim)} ${d.pct}</text>`;
  }).join("");
  return `<svg width="260" height="235" viewBox="0 0 260 235" role="img" aria-label="五维雷达图">${rings}${axes}
    <polygon points="${val}" fill="color-mix(in oklab, var(--color-accent) 14%, transparent)" stroke="var(--color-accent)" stroke-width="2"/>${labels}</svg>`;
}
function trendSvg() {
  /* V4 2.2 起由 renderCurve() 取代（旧版把信源/答案侧混均在一条线里，违反口径红线，仅留空壳防旧引用） */
  return "";
}

/* ══ V4 2.2 GEO 发展曲线（口径红线：信源与答案侧分线，禁止混均）══ */
const CURVE_SERIES = [
  { key: "audit", name: "体检成熟度", color: "var(--color-accent)", dash: "" },
  { key: "ans",   name: "提及率·答案侧", color: "var(--color-info)", dash: "" },
  { key: "src",   name: "命中·信源", color: "var(--color-warn)", dash: "5 3" },
  { key: "own",   name: "自有渠道", color: "var(--color-ok)", dash: "" },
  { key: "share", name: "引用份额", color: "var(--color-gold-bright)", dash: "" },
  { key: "comp",  name: "竞品同时出现率·参照", color: "var(--color-ink-3)", dash: "2 3" },
  { key: "biz",   name: "AI线索·副轴", color: "var(--color-bad)", dash: "1 2" },
];
let CURVE_ENGINE = "全部";   /* V4 4.2：引擎分层筛选（单引擎提及率曲线） */
let CURVE_ON = null;
function curveSeriesOn() {
  if (!CURVE_ON) {
    const mobile = window.matchMedia && window.matchMedia("(max-width:768px)").matches;
    CURVE_ON = Object.fromEntries(CURVE_SERIES.map(s => [s.key, mobile ? ["audit", "ans"].includes(s.key) : s.key !== "comp"]));
  }
  return CURVE_ON;
}
function movingAvg(arr, w) {
  return arr.map((_, i) => {
    const seg = arr.slice(Math.max(0, i - w + 1), i + 1).filter(v => v !== null && v !== undefined);
    return seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : null;
  });
}
function renderCurve() {
  const box = $("#curveBox"); if (!box) return;
  /* 并集合并后数组可能乱序，渲染前按时间重排 */
  const snaps = (state.snapshots || []).slice().sort((a, b) => a.ts - b.ts);
  const events = (state.events || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const chips = $("#curveChips");
  if (chips) {
    chips.innerHTML = CURVE_SERIES.map(s =>
      `<button class="chip ${curveSeriesOn()[s.key] ? "on" : ""}" data-cv="${s.key}"><span style="display:inline-block;width:14px;${s.dash ? "height:0;border-top:3px dashed" : "height:3px;background"}:${s.color};vertical-align:middle;margin-right:4px"></span>${s.name}</button>`).join("") +
      `<select id="cvEngine" class="sel" style="min-width:96px;min-height:32px;font-size:12px" title="引擎分层：选中后「提及率·答案侧」只统计该引擎">
        ${["全部", ...ENGINE_LIST].map(e => `<option${e === CURVE_ENGINE ? " selected" : ""}>${e}</option>`).join("")}</select>
      <button class="btn btn-sm btn-ghost" id="cvAddEvent" style="margin-left:4px">＋记事件</button>`;
    $$("#curveChips [data-cv]").forEach(b => b.addEventListener("click", () => {
      curveSeriesOn()[b.dataset.cv] = !curveSeriesOn()[b.dataset.cv];
      renderCurve();
    }));
    const eng = $("#cvEngine");
    if (eng) eng.addEventListener("change", () => { CURVE_ENGINE = eng.value; renderCurve(); });
    const aeb = $("#cvAddEvent");
    if (aeb) aeb.addEventListener("click", () => {
      const label = prompt("事件说明（如：部署一园一档 / 豆包信源规则变动 / T4工单验收）"); if (!label) return;
      const type = prompt("类型：deploy部署 / wo工单 / engine引擎规则 / custom自定义", "deploy") || "deploy";
      const date = prompt("日期 YYYY-MM-DD（留空=今天）", today()) || today();
      addEvent(type, label, date); renderCurve(); toast("事件已标注到曲线");
    });
  }
  /* x 轴 = 快照日期 ∪ 事件日期；每个日期取当日最新快照 */
  const byDate = {}; snaps.forEach(s => { byDate[s.date] = s; });   /* snaps 已按 ts 升序，后写覆盖=当日最新 */
  const compByDate = {}, engByDate = {}, shareByDate = {};
  (state.ledger || []).filter(r => r.engine !== "搜索通道").forEach(r => {
    const c = compByDate[r.date] = compByDate[r.date] || { hit: 0, n: 0 };
    c.n++; if ((r.cooccur || []).length) c.hit++;
    const e = engByDate[r.engine] = engByDate[r.engine] || {};
    const ee = e[r.date] = e[r.date] || { hit: 0, n: 0 };
    ee.n++; ee.hit += (+r.mention || 0);
    if ((r.url || "").trim()) {
      const sh = shareByDate[r.date] = shareByDate[r.date] || { own: 0, all: 0 };
      sh.all++;
      if (curOwn().some(d => (r.url || "").includes(d))) sh.own++;
    }
  });
  const bizMonths = {};
  (state.business || []).forEach(b => { if (b.month && (+b.aiLeads || +b.aiVisits)) bizMonths[b.month] = b; });
  const bizMax = Math.max(1, ...Object.values(bizMonths).map(b => +b.aiLeads || 0));
  const dates = [...new Set([...Object.keys(byDate), ...events.map(e => e.date),
    ...Object.keys(bizMonths).map(m => m + "-01")])].sort();
  if (dates.length < 2) {
    box.innerHTML = `<p class="muted" style="padding:24px 0;text-align:center">监测/诊断快照 ≥2 个日期后自动生成 GEO 发展曲线（当前 ${snaps.length} 个快照${snaps.length ? `，首个已锁定起始数据 ${snaps[0].date}` : ""}）。跑一轮30问或一键诊断即产生快照。</p>`;
    return;
  }
  const W = 680, H = 240, P = 44, PW = W - 2 * P, PH = H - 2 * P - 8;
  const x = i => P + i * PW / (dates.length - 1);
  const y = v => H - P - Math.max(0, Math.min(100, v)) / 100 * PH;
  const val = (d, key) => {
    if (key === "comp") { const c = compByDate[d]; return (c && c.n) ? Math.round(c.hit / c.n * 100) : null; }
    if (key === "share") { const sh = shareByDate[d]; return (sh && sh.all) ? Math.round(sh.own / sh.all * 100) : null; }
    if (key === "biz") { const b = bizMonths[d.slice(0, 7)]; return b ? Math.round((+b.aiLeads || 0) / bizMax * 100) : null; }
    if (key === "ans" && CURVE_ENGINE !== "全部") {
      const e = (engByDate[CURVE_ENGINE] || {})[d];
      return e ? Math.round(e.hit / e.n * 100) : null;
    }
    const s = byDate[d]; if (!s) return null;
    if (key === "audit") return s.auditPct;
    if (key === "ans") return s.mentionAns;
    if (key === "src") return s.mentionSrc;
    if (key === "own") return (s.ownHitN !== null && s.ownHitTotal) ? Math.round(s.ownHitN / s.ownHitTotal * 100) : null;
    return null;
  };
  const nOf = (d, key) => {
    if (key === "comp") return (compByDate[d] || {}).n || 0;
    if (key === "share") return (shareByDate[d] || {}).all || 0;
    if (key === "biz") return (bizMonths[d.slice(0, 7)] || {}).aiLeads || 0;
    if (key === "ans" && CURVE_ENGINE !== "全部") return ((engByDate[CURVE_ENGINE] || {})[d] || {}).n || 0;
    const s = byDate[d] || {};
    return key === "ans" ? (s.mentionAnsN || 0) : key === "src" ? (s.mentionSrcN || 0) : (s.ownHitTotal || 0);
  };
  const nameOf = { audit: "体检成熟度", ans: "提及率(答案侧)", src: "命中率(信源)", own: "自有渠道命中率",
                   share: "引用份额(自有/全部被引)", comp: "竞品同时出现率", biz: "AI线索(副轴·归一化)" };
  let lines = "", dots = "";
  CURVE_SERIES.filter(s => curveSeriesOn()[s.key]).forEach(s => {
    let vals = dates.map(d => val(d, s.key));
    /* 水平型指标（体检分/自有渠道）前向填充：状态在下一测前持续有效；期间型指标（提及率/命中/同时出现率）保持断线 */
    if (s.key === "audit" || s.key === "own") {
      let last = null;
      vals = vals.map(v => (v === null ? last : (last = v, v)));
    }
    let seg = [];
    const flush = () => {
      if (seg.length > 1) lines += `<polyline points="${seg.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.key === "ans" ? 2.5 : 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
      seg = [];
    };
    vals.forEach((v, i) => {
      if (v === null) { flush(); return; }
      seg.push([x(i), y(v)]);
      const n = nOf(dates[i], s.key);
      const low = n > 0 && n < 10;   /* 统计诚实：n<10 空心降权 */
      dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${low ? 3 : 4}" fill="${low ? "var(--color-paper)" : s.color}" stroke="${s.color}" stroke-width="1.5"><title>${dates[i]} · ${nameOf[s.key]} ${v}% · 样本量 n=${n}${low ? "（n<10，空心降权显示）" : ""}</title></circle>`;
    });
    flush();
  });
  if (curveSeriesOn().ans) {   /* 答案侧 3 点移动平均（宽半透明线，抗单轮方差） */
    const ma = movingAvg(dates.map(d => val(d, "ans")), 3);
    let seg = [];
    const flush = () => { if (seg.length > 1) lines += `<polyline points="${seg.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--color-info)" stroke-width="5" opacity=".16"/>`; seg = []; };
    ma.forEach((v, i) => { if (v === null) { flush(); return; } seg.push([x(i), y(v)]); });
    flush();
  }
  /* 起始数据竖线 */
  const base = snaps.find(s => s.baseline) || snaps[0];
  let marks = "";
  if (base) {
    const bi = dates.indexOf(base.date);
    if (bi >= 0) marks += `<line x1="${x(bi).toFixed(1)}" y1="${y(100)}" x2="${x(bi).toFixed(1)}" y2="${y(0)}" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="1 4"/><text x="${x(bi).toFixed(1)}" y="${(y(100) - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--color-accent)">起始数据</text>`;
  }
  /* 日期→x 坐标（允许落在相邻两点之间） */
  const dayMs = 864e5, t0 = dates.map(d => new Date(d + "T00:00:00").getTime());
  const dIndex = t => {
    if (t <= t0[0]) return P;
    if (t >= t0[t0.length - 1]) return W - P;
    for (let i = 1; i < t0.length; i++) if (t <= t0[i]) return x(i - 1) + (t - t0[i - 1]) / (t0[i] - t0[i - 1]) * (x(i) - x(i - 1));
    return W - P;
  };
  /* 预期窗口带：部署/工单事件后 0–15天（首批引用）与 15–56天（至稳定期） */
  let bands = "";
  events.filter(e => e.type === "deploy" || e.type === "wo").forEach(e => {
    const te = new Date(e.date + "T00:00:00").getTime();
    const x0 = dIndex(te), x15 = dIndex(te + 15 * dayMs), x56 = dIndex(te + 56 * dayMs);
    bands += `<rect x="${x0.toFixed(1)}" y="${y(100).toFixed(1)}" width="${Math.max(0, x15 - x0).toFixed(1)}" height="${PH.toFixed(1)}" fill="var(--color-gold-bright)" opacity=".10"/>` +
             `<rect x="${x15.toFixed(1)}" y="${y(100).toFixed(1)}" width="${Math.max(0, x56 - x15).toFixed(1)}" height="${PH.toFixed(1)}" fill="var(--color-gold-bright)" opacity=".05"/>`;
  });
  events.forEach(e => {
    marks += `<line x1="${dIndex(new Date(e.date + "T00:00:00").getTime()).toFixed(1)}" y1="${y(100)}" x2="${dIndex(new Date(e.date + "T00:00:00").getTime()).toFixed(1)}" y2="${y(0)}" stroke="var(--color-ink-3)" stroke-width="1" stroke-dasharray="3 3"><title>${e.date} · ${e.type} · ${esc(e.label)}</title></line>`;
  });
  const xlabels = dates.map((d, i) => (dates.length > 8 && i % 2) ? "" : `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="9" fill="var(--color-ink-3)">${d.slice(5)}</text>`).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="GEO发展曲线">
    <line x1="${P}" y1="${y(100)}" x2="${W - P}" y2="${y(100)}" stroke="var(--color-line)"/>
    <line x1="${P}" y1="${y(50)}" x2="${W - P}" y2="${y(50)}" stroke="var(--color-line)" stroke-dasharray="2 4"/>
    <line x1="${P}" y1="${y(0)}" x2="${W - P}" y2="${y(0)}" stroke="var(--color-line-2)"/>
    <text x="${P - 6}" y="${(y(100) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--color-ink-3)">100</text>
    <text x="${P - 6}" y="${(y(50) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--color-ink-3)">50</text>
    ${bands}${lines}${marks}${dots}${xlabels}</svg>
    <p class="muted" style="font-size:11px;margin:6px 0 0">口径：答案侧（AI 回答里提没提咱们）=六引擎人工轮，信源侧（搜索结果里排没排咱们）=搜索通道自动轮——分线独立解读，禁止混均。金色带=部署/工单事件预期窗口（深色 0–15 天首批引用，浅色至 8–12 周稳定）。空心点=样本量 n&lt;10（悬浮看点位值与 n）。竞品同时出现率=答案同时提及竞品的比例，归因参照：我们涨了还是整个品类都被提得多了。引用份额=被引链接中自有域名占比。AI线索为副轴归一化（悬浮看绝对值），月度数据来自「业务结果」卡。</p>`;
}

/* ══ V4 2.4 资产追踪（Watched Pages：物料部署→进榜/被引时间线）══ */
function registerWatch(name) {
  state.watchPages = state.watchPages || [];
  if (state.watchPages.some(w => w.name === name && w.deployedAt === today())) return;
  state.watchPages.push({ name, url: "", deployedAt: today(), promptIds: [], hits: [] });
  addEvent("deploy", name);
  save();
}
function hostOf2(u) { try { return new URL(u).hostname; } catch (e) { return String(u || "").replace(/^https?:\/\//, "").split("/")[0]; } }
function checkWatch(idx) {
  const w = (state.watchPages || [])[idx];
  if (!w) return;
  if (!w.url) { toast("先补该物料的部署 URL（官网页/公众号文章链接）"); return; }
  const host = hostOf2(w.url);
  const fresh = (state.probes || []).filter(p => (Date.now() - new Date(p.date + "T00:00:00").getTime()) <= 7 * 864e5);
  if (!fresh.length) { toast("无 ≤7 天内的探针数据——先在监测页跑一轮30问，再来查排名"); return; }
  const scope = w.promptIds && w.promptIds.length ? fresh.filter(p => w.promptIds.includes(p.promptId)) : fresh;
  if (!scope.length) { toast("≤7 天探针中没有该物料关联的问题——先跑一轮30问或清空关联问题"); return; }
  let seen = 0, firstRank = null;
  scope.forEach(p => {
    const rank = (p.domains || []).indexOf(host);
    if (rank >= 0) { seen++; if (firstRank === null || rank < firstRank) firstRank = rank; }
  });
  w.hits = (w.hits || []).filter(h => h.date !== today());
  w.hits.push({ date: today(), seen: seen > 0, rank: firstRank !== null ? firstRank + 1 : null, n: scope.length });
  if (seen > 0 && !(w.firstSeenAt)) { w.firstSeenAt = today(); addEvent("wo", `「${w.name}」首次进入排名`); }
  save(); renderWatch();
  toast(seen > 0 ? `✓ 在 ${seen}/${scope.length} 个问题的前10发现该域名（最高第 ${firstRank + 1} 位）` : `未进入排名（0/${scope.length}）——对照预期窗口：部署后 10–15 天首批引用`);
}
function renderWatch() {
  const box = $("#watchBox"); if (!box) return;
  const ws = state.watchPages || [];
  box.innerHTML = ws.length ? ws.map((w, i) => `
    <div class="prompt-li" style="align-items:flex-start">
      <span style="flex:1;min-width:0">
        <b>${esc(w.name)}</b> <span class="muted num" style="font-size:11px">部署 ${esc(w.deployedAt)}${w.firstSeenAt ? ` · 首次进入排名 ${esc(w.firstSeenAt)}` : ""}</span><br>
        <span style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          <input class="inp wp-url" data-wp="${i}" value="${esc(w.url || "")}" placeholder="部署后的 URL（官网页/公众号文章链接）" style="flex:1;min-width:220px">
          <button class="btn btn-sm btn-primary" data-wpchk="${i}">查排名</button>
          <button class="btn btn-sm btn-danger" data-wpdel="${i}">删</button>
        </span>
        ${w.hits && w.hits.length ? `<span class="muted" style="font-size:11px">排名记录：${w.hits.slice(-6).map(h => `${h.date} ${h.seen ? "✓" + (h.rank ? "第" + h.rank + "位" : "") : "✗"}(${h.n})`).join(" · ")}</span>` : '<span class="muted" style="font-size:11px">尚无排名记录</span>'}
      </span>
    </div>`).join("") : '<p class="muted" style="padding:12px 0">还没有登记的物料——在上方生成优化文件并点「下载」即自动登记，部署后补 URL、定期「查排名」看它是否进入搜索前10。</p>';
  $$("#watchBox [data-wp]").forEach(inp => inp.addEventListener("change", () => {
    (state.watchPages || [])[+inp.dataset.wp].url = inp.value.trim(); save(); toast("URL 已保存");
  }));
  $$("#watchBox [data-wpchk]").forEach(b => b.addEventListener("click", () => checkWatch(+b.dataset.wpchk)));
  $$("#watchBox [data-wpdel]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("删除该资产追踪记录？")) return;
    state.watchPages.splice(+b.dataset.wpdel, 1); save(); renderWatch();
  }));
}

/* ══ V4 2.5 操作留痕 + 备份恢复（项目总览页）══ */
/* V4.7.1 留痕大白话化：技术操作串→人话（显示侧翻译，不动存储；原始值放悬浮提示供排查） */
function auditActionText(a) {
  const m = {
    "POST /api/projects": "新建项目",
    "POST /api/projects/update": "更新项目信息",
    "POST /api/projects/archive": "归档 / 恢复项目",
    "POST /api/restore": "恢复备份",
    "PUT /api/data": "保存数据",
    "LLM配置": "AI 模型设置",
  };
  return m[a] || a;
}
function auditProjectName(pid) {
  const all = PROJECTS.concat(ARCHIVED_PROJS || []);
  const p = all.find(x => x.id === pid);
  return p ? p.name : (pid || "—");
}
async function renderAuditBox() {
  const box = $("#auditBox"); if (!box) return;
  if (!SERVER_MODE) { box.innerHTML = '<p class="muted">团队共享模式下自动记录每次数据保存。</p>'; return; }
  let op = ""; try { op = localStorage.getItem("geodesk.operator") || ""; } catch (e) {}
  let d = null;
  try { const r = await fetch("/api/audit"); d = r.ok ? await r.json() : null; } catch (e) {}
  const list = (d && d.audit) || [];
  box.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <label style="font-size:var(--text-sm)">操作员署名</label>
      <input id="opName" class="inp" style="max-width:140px" placeholder="你的名字" value="${esc(op)}">
      <span class="muted" style="font-size:11px">写入每次保存的留痕（本机记忆）</span>
    </div>
    ${list.length ? `<div class="tbl-wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th>时间</th><th>项目</th><th>做了什么</th><th>详情</th></tr></thead>
      <tbody>${list.slice().reverse().map(a => `<tr><td class="num" style="white-space:nowrap">${esc(a.ts)}</td><td>${esc(auditProjectName(a.project))}</td><td title="系统记录值：${esc(a.action)}">${esc(auditActionText(a.action))}</td><td style="max-width:220px;font-size:12px">${esc(a.detail || "")}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="muted">暂无留痕（数据保存后自动记录）。</p>'}`;
  const opn = $("#opName");
  if (opn) opn.addEventListener("change", () => { try { localStorage.setItem("geodesk.operator", opn.value.trim()); } catch (e) {} toast("署名已保存"); });
}
async function doRestore(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = async () => {
    let payload; try { payload = JSON.parse(rd.result); } catch (e) { toast("文件不是合法 JSON"); return; }
    if (!payload.projects || !payload.docs) { toast("格式不符：需要 projects + docs（来自 backups/geodesk-*.json）"); return; }
    if (!confirm(`确定用该备份覆盖服务器全部项目数据？（${payload.projects.length} 个项目，此操作会替换现有全部数据）`)) return;
    try {
      const r = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, payload, operator: (localStorage.getItem("geodesk.operator") || "") }) });
      const d = await r.json();
      if (r.ok && d.ok) { toast(`已恢复 ${d.projects} 个项目，即将刷新`); setTimeout(() => location.reload(), 900); }
      else toast("恢复失败：" + (d.error || r.status));
    } catch (e) { toast("恢复失败：" + e); }
  };
  rd.readAsText(file);
}

/* ══ V4 3.1 引用诊断（谁在赢我们的30问）══ */
function domainType(h) {
  const host = String(h || "").toLowerCase();
  if (/(csdn\.net|sohu\.com|163\.com|toutiao\.com|new\.qq\.com|bilibili\.com)/.test(host)) return ["通吃平台", "tag-ok"];
  if (/(baike\.baidu\.com|qcc\.com|tianyancha\.com)/.test(host)) return ["基础层", "tag-warn"];
  return ["其他", ""];
}
function winBoardData() {
  /* 信源：probes 域名聚合；答案侧：台账 url 域名聚合 */
  const owns = curOwn().map(d => d.toLowerCase());
  const board = {};
  const add = (host, src, qid, date) => {
    if (!host) return;
    const b = board[host] = board[host] || { host, src: new Set(), count: 0, qs: new Set(), last: "" };
    b.src.add(src); b.count++; b.qs.add(qid); if (date > b.last) b.last = date;
  };
  (state.probes || []).forEach(p => (p.domains || []).forEach(d => add(d, "信源", p.promptId, p.date)));
  (state.ledger || []).forEach(r => { if (r.url) { try { add(hostOf2(r.url), "被引", r.promptId, r.date); } catch (e) {} } });
  return Object.values(board).map(b => ({
    host: b.host, src: [...b.src].join("/"), count: b.count, qn: b.qs.size, last: b.last,
    own: owns.some(d => b.host.includes(d)),
  })).sort((a, b) => b.count - a.count);
}
function matrixData() {
  const prompts = P_prompts(), q = id => (prompts.find(p => p.id === id) || {}).q || "";
  const manual = (state.ledger || []).filter(r => r.engine !== "搜索通道");
  const mNoCite = {}, absentComp = {};
  manual.forEach(r => {
    if ((+r.mention || 0) >= 0.5 && !(r.url || "").trim()) mNoCite[r.promptId] = (mNoCite[r.promptId] || 0) + 1;
    if ((+r.mention || 0) === 0 && (r.cooccur || []).length) absentComp[r.promptId] = (absentComp[r.promptId] || 0) + 1;
  });
  /* 信源：按问题取最近一轮探针 */
  const byQ = {};
  (state.probes || []).forEach(p => { byQ[p.promptId] = byQ[p.promptId] || []; byQ[p.promptId].push(p); });
  const srcIn = [], srcOut = [];
  Object.keys(byQ).forEach(pid => {
    const last = byQ[pid].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    (last.ownHit ? srcIn : srcOut).push(pid);
  });
  return [
    { key: "mNoCite", label: "提及但未被引用", ch: "答案侧·台账", tone: "tag-warn",
      desc: "AI 谈论我们但不引用我们的信源——补可摘录的证据块（数据/引言/对比表）",
      items: Object.keys(mNoCite).map(id => ({ id, n: mNoCite[id], q: q(id) })) },
    { key: "absentComp", label: "缺席且竞品在场", ch: "答案侧·台账", tone: "tag-bad",
      desc: "竞品被提及而我们缺席——shortlist 缺席，最高优先：对比类内容+第三方背书",
      items: Object.keys(absentComp).map(id => ({ id, n: absentComp[id], q: q(id) })) },
    { key: "srcIn", label: "信源在榜·答案未引", ch: "信源·搜索轮（30问top-10域名）", tone: "tag-ok",
      desc: "素材已在检索池前列，AI 没引——强化证据层（口径一致+多源同步触发交叉验证加分）",
      items: srcIn.map(id => ({ id, n: 1, q: q(id) })) },
    { key: "srcOut", label: "信源完全缺席", ch: "信源·搜索轮（30问top-10域名）", tone: "tag-bad",
      desc: "素材池里就没有我们——先布源（一园一档+FAQ+渠道矩阵），其他都白搭",
      items: srcOut.map(id => ({ id, n: 1, q: q(id) })) },
  ];
}
function renderWinCard() {
  const box = $("#winBox"); if (!box) return;
  const board = winBoardData();
  const matrix = matrixData().filter(m => m.items.length);
  const boardHtml = board.length ? `<div class="tbl-wrap" style="max-height:280px;overflow:auto"><table class="tbl"><thead><tr><th>域名</th><th>类型</th><th>来源</th><th>出现</th><th>覆盖问题</th><th>最近</th><th>策略含义</th></tr></thead><tbody>
    ${board.slice(0, 15).map(b => { const [tn, cls] = domainType(b.host);
      return `<tr style="${b.own ? "background:color-mix(in oklab, var(--color-ok) 10%, transparent)" : ""}">
        <td class="num" style="font-size:12px;word-break:break-all">${esc(b.host)}${b.own ? ' <span class="tag tag-ok">自有</span>' : ""}</td>
        <td><span class="tag ${cls}">${tn}</span></td><td>${esc(b.src)}</td>
        <td class="num">${b.count}</td><td class="num">${b.qn}</td><td class="num" style="font-size:11px">${esc(b.last.slice(5))}</td>
        <td style="font-size:11px">${b.own ? "守住并扩大" : tn === "通吃平台" ? "入驻它（开号分发）" : tn === "基础层" ? "口径一致+词条更新" : "PR 目标：争取被引"}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="muted" style="font-size:11px;margin-top:6px">数据：信源=每轮30问的top-10域名（probes）；被引=台账录入的AI引用链接。自有域名绿底。通吃平台=六引擎均引用（起步优先入驻）；基础层=百科/企查查（口径必须一致）。台账「AI」标=AI代问自动录入（豆包·联网检索），与人工记录同口径统计。</p>`
    : '<p class="muted">先跑一轮30问积累探针数据，域名榜自动生成——"哪些域名正在赢走我们的问题"，这就是修复路线图。</p>';
  const matrixHtml = matrix.length ? matrix.map(m => `
    <div style="border-top:1px solid var(--color-line);padding:10px 0 4px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="tag ${m.tone}">${m.label}</span><span class="muted num" style="font-size:11px">${m.ch}</span>
        <b class="num">${m.items.length}</b><span class="muted" style="font-size:12px">个问题</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-primary" data-mkwo="${m.key}">生成工单</button>
      </div>
      <p class="muted" style="font-size:11px;margin:4px 0">${esc(m.desc)}</p>
      <div style="font-size:12px">${m.items.slice(0, 3).map(i => `<span class="code num" style="cursor:pointer" data-drill="${i.id}" title="点击下钻看该问题的探针历史">${i.id}</span> `).join("")}${m.items.length > 3 ? `<span class="muted">+${m.items.length - 3}</span>` : ""}</div>
    </div>`).join("") : '<p class="muted" style="border-top:1px solid var(--color-line);padding-top:8px">诊断矩阵需要答案侧台账（含竞品同时出现）与信源探针数据——按⑥采样卡录入几条即可点亮。</p>';
  box.innerHTML = `
    <p class="muted" style="margin-top:0;font-size:var(--text-sm)">监测数据 → 修复路线图。域名榜回答"谁在赢"；诊断矩阵回答"下一步修什么"（每类标明数据通道，不混淆口径）。</p>
    <h4 style="margin:8px 0 6px">① 域名榜（被谁赢走）</h4>${boardHtml}
    <h4 style="margin:14px 0 2px">② 诊断矩阵（修什么）</h4>${matrixHtml}
    <div id="drillBox" style="margin-top:6px"></div>
    <h4 style="margin:14px 0 2px">③ 修复队列 <span class="hint">优先级=业务价值×可见度缺口×可修复性×准确性风险÷工作量</span></h4>
    <div id="fixQueueBox"></div>`;
  renderFixQueue();
  $$("#winBox [data-mkwo]").forEach(b => b.addEventListener("click", () => {
    const m = matrixData().find(x => x.key === b.dataset.mkwo);
    if (!m || !m.items.length) return;
    addFixOrder({ title: m.label, channel: m.ch, prompts: m.items.map(i => i.id), detail: m.desc });
    toast(`已生成工单：「${m.label}」覆盖 ${m.items.length} 个问题，去下方修复队列填责任人与期限`);
    renderFixQueue();
  }));
  $$("#winBox [data-drill]").forEach(el => el.addEventListener("click", () => renderDrill(el.dataset.drill)));
}

/* V4 3.1 下钻：单问题的探针历史 */
function renderDrill(pid) {
  const box = $("#drillBox"); if (!box) return;
  const p = P_prompts().find(x => x.id === pid) || { q: "" };
  const hist = (state.probes || []).filter(x => x.promptId === pid).sort((a, b) => (a.date < b.date ? 1 : -1));
  box.innerHTML = `<div class="card" style="margin-top:8px;background:var(--color-paper-2,var(--color-paper))">
    <h4>${pid} ${esc(p.q)} <button class="btn btn-sm btn-ghost" id="drillX" style="float:right">收起</button></h4>
    ${hist.length ? hist.map(h => `<p style="font-size:12px;margin:4px 0"><b class="num">${h.date}</b> 前10：${(h.domains || []).map((d, i) => `<span class="num" style="margin-right:6px;${curOwn().some(o => d.includes(o)) ? "color:var(--color-ok);font-weight:700" : ""}">${i + 1}.${esc(d)}</span>`).join("")}${h.partial ? ' <span class="tag tag-warn">历史填入(仅前3)</span>' : ""}${h.ownHit ? ' <span class="tag tag-ok">自有在榜</span>' : ""}</p>`).join("") : '<p class="muted">该问题无探针记录</p>'}
  </div>`;
  $("#drillX").addEventListener("click", () => { box.innerHTML = ""; });
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ══ V4 3.2 修复队列（fixQueue：owner/期限/优先级公式/部署后验证）══ */
const FIX_STATUS = ["待派单", "已派单", "已整改", "已验证"];
function fixPriority(f) {
  const v = k => Math.max(1, Math.min(5, +((f || {})[k] || 3)));
  return Math.round(v("biz") * v("gap") * v("fix") * v("acc") / v("effort") * 10) / 10;
}
function addFixOrder(o) {
  state.fixQueue = state.fixQueue || [];
  state.fixQueue.push(Object.assign({
    id: "W" + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4), created: today(), status: FIX_STATUS[0],
    owner: "", due: "", factors: { biz: 3, gap: 4, fix: 3, acc: 3, effort: 2 },
    verified: false, verifiedNote: "",
  }, o));
  save();
}
function renderFixQueue() {
  const box = $("#fixQueueBox"); if (!box) return;
  const q = (state.fixQueue || []).slice().sort((a, b) => fixPriority(b.factors) - fixPriority(a.factors));
  box.innerHTML = q.length ? q.map(o => `
    <div class="prompt-li" style="align-items:flex-start">
      <span style="flex:1;min-width:0">
        <b>${esc(o.title)}</b> <span class="tag ${o.status === "已验证" ? "tag-ok" : ""}">${o.status}</span>
        <span class="tag tag-accent num" title="优先级=业务价值×可见度缺口×可修复性×准确性风险÷工作量">P=${fixPriority(o.factors)}</span>
        <span class="muted num" style="font-size:11px">${esc(o.channel || "")} · ${o.created}${o.prompts && o.prompts.length ? ` · 覆盖${o.prompts.length}问(${o.prompts.slice(0, 4).join(",")}${o.prompts.length > 4 ? "…" : ""})` : ""}</span><br>
        <span class="muted" style="font-size:11px">${esc(o.detail || "")}</span>
        <span style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          <input class="inp fq-in" data-fq="owner|${esc(o.id)}" placeholder="责任人" value="${esc(o.owner)}" style="max-width:90px;min-height:32px">
          <input class="inp fq-in" type="date" data-fq="due|${esc(o.id)}" value="${esc(o.due)}" style="max-width:140px;min-height:32px">
          ${[["biz", "价值"], ["gap", "缺口"], ["fix", "可修"], ["acc", "风险"], ["effort", "工作量"]].map(([k, n]) =>
            `<select class="sel fq-in" data-fq="${k}|${esc(o.id)}" title="${n}(1-5)" style="min-width:52px;min-height:32px">${[1,2,3,4,5].map(v => `<option${v == o.factors[k] ? " selected" : ""}>${v}</option>`).join("")}</select>`).join("")}
          <button class="btn btn-sm btn-ghost" data-fqst="${esc(o.id)}">${o.status === "已整改" ? "✓标记已验证(被引/收录)" : "状态→下一档"}</button>
          <button class="btn btn-sm btn-danger" data-fqdel="${esc(o.id)}">删</button>
        </span>
        ${o.verified ? `<span class="tag tag-ok" style="margin-top:4px">部署后验证通过：${esc(o.verifiedNote || "已确认被收录/被引用")}</span>` : ""}
      </span>
    </div>`).join("") : '<p class="muted" style="font-size:12px">队列为空——从上方诊断矩阵「生成工单」，或手动 <button class="btn btn-sm btn-ghost" id="fqAdd">＋添加工单</button></p>';
  const addBtn = $("#fqAdd");
  if (addBtn) addBtn.addEventListener("click", () => { addFixOrder({ title: prompt("工单标题？") || "未命名工单", channel: "手动" }); renderFixQueue(); });
  /* V0.2.2 F1：排序视图下按工单 id 定位（此前按排序序号取 state 数组索引——排序序≠存储序时编辑/删除作用到错误工单） */
  const byId = id => (state.fixQueue || []).find(x => x.id === id);
  $$("#fixQueueBox [data-fq]").forEach(inp => inp.addEventListener("change", () => {
    const [k, id] = inp.dataset.fq.split("|");
    const o = byId(id); if (!o) return;
    if (k === "owner") o.owner = inp.value.trim();
    else if (k === "due") o.due = inp.value;
    else o.factors[k] = +inp.value;
    save(); renderFixQueue();
  }));
  $$("#fixQueueBox [data-fqst]").forEach(b => b.addEventListener("click", () => {
    const o = byId(b.dataset.fqst); if (!o) return;
    const cur = FIX_STATUS.indexOf(o.status);
    o.status = FIX_STATUS[(cur + 1) % FIX_STATUS.length];
    if (o.status === "已验证") { o.verified = true; o.verifiedNote = prompt("验证依据（如：已在豆包P20回答中被引/已被百度收录）", o.verifiedNote || "") || ""; addEvent("wo", `修复验证：${o.title}`, today()); }
    save(); renderFixQueue();
  }));
  $$("#fixQueueBox [data-fqdel]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("删除该工单？")) return;
    state.fixQueue = (state.fixQueue || []).filter(x => x.id !== b.dataset.fqdel); save(); renderFixQueue();
  }));
}

/* ══ V4 3.3 证据库（叙述性证据；数字事实唯一源=口径表）══ */
const EV_TYPES = ["引言", "案例", "荣誉", "口径引用"];
function evidenceQuotes(park) {
  return (state.evidence || []).filter(e => e.type === "引言" && e.status === "已核验" &&
    (!park || !e.park || e.park.includes(park.slice(0, 2)) || park.includes(e.park.slice(0, 2))));
}
function renderEvidence() {
  const box = $("#evBox"); if (!box) return;
  const ev = state.evidence || [];
  const vq = evidenceQuotes("").length;
  const pct = Math.min(100, vq / 5 * 100);
  box.innerHTML = `
    <p class="muted" style="margin-top:0;font-size:var(--text-sm)">只存<b>叙述性证据</b>（引言/案例/荣誉）；数字类事实一律入口径表——「口径引用」类型只是口径表条目的指针，不另立数值（避免两个事实源打架）。已核验证据会自动注入一园一档/FAQ生成器。</p>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
      <div style="flex:1;height:10px;background:var(--color-paper-3);border:1px solid var(--color-line);border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--color-ok);transition:width .3s"></div></div>
      <span class="num" style="font-size:12px">已核验引言 <b>${vq}</b>/5（90天路线图目标）</span>
    </div>
    <div class="form-grid" id="evForm">
      <label class="lb">类型<select id="evType" class="sel">${EV_TYPES.map(t => `<option>${t}</option>`).join("")}</select></label>
      <label class="lb">园区<input id="evPark" class="inp" placeholder="留空=通用" value="${esc(curProject().name || "")}"></label>
      <label class="full lb">内容（引言原文/案例概述/荣誉名称/口径字段名）<textarea id="evContent" class="inp" rows="2" placeholder="如：我们对比了三个园区，最终选蛇口网谷是因为产业聚集度和招商响应速度"></textarea></label>
      <label class="lb">人物<input id="evPerson" class="inp" placeholder="引言必填：如 王强"></label>
      <label class="lb">职务<input id="evTitle" class="inp" placeholder="如：某科技公司总经理"></label>
      <label class="lb">来源<input id="evSource" class="inp" placeholder="如：2025招商交流会"></label>
      <label class="lb">时点<input id="evAsOf" type="date" class="inp" value="${today()}"></label>
    </div>
    <button class="btn btn-primary" id="evAdd" style="margin-top:10px">添加证据</button>
    <div style="margin-top:14px">${ev.length ? ev.map((e, i) => `
      <div class="prompt-li" style="align-items:flex-start">
        <span style="flex:1;min-width:0">
          <span class="tag ${e.status === "已核验" ? "tag-ok" : "tag-warn"}">${e.type}${e.status === "已核验" ? "·已核验" : "·待采集"}</span>
          <b>${esc(e.park || "通用")}</b> <span class="muted num" style="font-size:11px">${esc(e.asOf || "")}</span><br>
          ${esc(e.content)}${e.person ? `<span class="muted"> ——${esc(e.person)}${e.title ? "·" + esc(e.title) : ""}${e.source ? "（" + esc(e.source) + "）" : ""}</span>` : ""}
        </span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-sm ${e.status === "已核验" ? "btn-ghost" : "btn-primary"}" data-evok="${i}">${e.status === "已核验" ? "撤销核验" : "✓核验"}</button>
          <button class="btn btn-sm btn-danger" data-evdel="${i}">删</button>
        </span>
      </div>`).join("") : '<p class="muted">暂无证据。优先采集：入驻企业负责人引言（带姓名职务）——这是评分器⑥和AI引用偏好的双重要求。</p>'}</div>`;
  $("#evAdd").addEventListener("click", () => {
    const e = { type: $("#evType").value, park: $("#evPark").value.trim(), content: $("#evContent").value.trim(),
                person: $("#evPerson").value.trim(), title: $("#evTitle").value.trim(),
                source: $("#evSource").value.trim(), asOf: $("#evAsOf").value || today(), status: "待采集" };
    if (!e.content) { toast("内容不能为空"); return; }
    if (e.type === "引言" && (!e.person || !e.title)) { toast("引言必须带人物与职务（AI引用偏好+评分器要求）"); return; }
    state.evidence = state.evidence || [];
    state.evidence.push(e); save(); render.evidence(); toast("证据已添加（待核验）");
  });
  $$("#evBox [data-evok]").forEach(b => b.addEventListener("click", () => {
    const e = (state.evidence || [])[+b.dataset.evok]; if (!e) return;
    e.status = e.status === "已核验" ? "待采集" : "已核验"; save(); render.evidence();
  }));
  $$("#evBox [data-evdel]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("删除该证据？")) return;
    state.evidence.splice(+b.dataset.evdel, 1); save(); render.evidence();
  }));
};

/* ══ V4 4.3 业务结果连接（AI引荐流量/线索 → 曲线副轴）══ */
const IT_TEMPLATE = `【致IT/网站管理员：招商线索表单字段新增建议】
目的：把 AI 渠道带来的线索变成可度量（GEO 的最终 ROI）。
做法：在官网「联系我们/预约看园」表单增加一个必选问题——
  "您是通过以下哪个渠道了解到我们的？（单选）"
  选项：①搜索引擎(百度/必应) ②AI助手(豆包/DeepSeek/Kimi/元宝/千问/文心/ChatGPT等，请注明) ③朋友推荐 ④中介/代理 ⑤展会活动 ⑥其他
说明：含"AI助手"的提交计入 AI 来源线索；每月末在 GEO智控台「监测→业务结果」登记：AI引荐流量（GA 里 referrals 来源含 chatgpt.com/perplexity.ai 等的会话数）与 AI来源线索数（表单统计）。
落地成本：表单加一题约 10 分钟；GA 无需改动，月末按来源筛选导出即可。`;

function renderBusiness() {
  const box = $("#bizBox"); if (!box) return;
  const rows = (state.business || []).slice().sort((a, b) => (a.month < b.month ? 1 : -1));
  box.innerHTML = `
    <div class="form-grid" style="max-width:640px">
      <label class="lb">月份<input type="month" id="bizMonth" class="inp" value="${today().slice(0, 7)}"></label>
      <label class="lb">AI引荐流量（GA会话数）<input type="number" id="bizVisits" class="inp" placeholder="如 86" min="0"></label>
      <label class="lb">AI来源线索数（表单统计）<input type="number" id="bizLeads" class="inp" placeholder="如 5" min="0"></label>
      <label class="full lb">备注<input id="bizNote" class="inp" placeholder="如：ChatGPT referrals 明显上升"></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary" id="bizSave">保存月度数据</button>
      ${rows.length ? '<button class="btn btn-ghost" id="bizCsv">导出表格</button>' : ""}
      <button class="btn btn-ghost" id="bizIt">复制给IT的统计字段配置说明</button>
    </div>
    ${rows.length ? `<div class="tbl-wrap" style="max-height:220px;overflow:auto;margin-top:10px"><table class="tbl"><thead><tr><th>月份</th><th>AI引荐流量</th><th>AI线索</th><th>备注</th><th></th></tr></thead><tbody>
      ${rows.map((b, i) => `<tr><td class="num">${esc(b.month)}</td><td class="num">${+b.aiVisits || 0}</td><td class="num">${+b.aiLeads || 0}</td>
        <td style="max-width:200px;font-size:12px">${esc(b.note || "")}</td>
        <td><button class="btn btn-sm btn-danger" data-bzdel="${i}">删</button></td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted" style="font-size:11px;margin-top:6px">线索数进入「GEO发展曲线」的 AI线索副轴——可见度涨了，线索是否跟着涨，一屏对齐。数据来自 GA 引荐来源与表单统计（人工月度登记，诚实口径）。</p>`
    : '<p class="muted" style="margin-top:10px">尚未登记月度数据。先复制右侧 IT 字段建议把线索来源度量建起来，下月起登记。</p>'}`;
  $("#bizSave").addEventListener("click", () => {
    const b = { month: $("#bizMonth").value || today().slice(0, 7), aiVisits: +$("#bizVisits").value || 0,
                aiLeads: +$("#bizLeads").value || 0, note: $("#bizNote").value.trim() };
    if (!b.month) { toast("请选月份"); return; }
    state.business = (state.business || []).filter(x => x.month !== b.month);
    state.business.push(b); save(); renderBusiness(); renderCurve();
    toast(`${b.month} 业务数据已保存，曲线AI线索副轴已更新`);
  });
  const csv = $("#bizCsv");
  if (csv) csv.addEventListener("click", () => {
    const head = "月份,AI引荐流量,AI来源线索,备注";
    const rows2 = (state.business || []).map(b => [b.month, b.aiVisits, b.aiLeads, b.note].map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","));
    download(`AI业务结果-${today()}.csv`, "\uFEFF" + [head, ...rows2].join("\n"), "text/csv;charset=utf-8");
  });
  $("#bizIt").addEventListener("click", () => copyText(IT_TEMPLATE));
  $$("#bizBox [data-bzdel]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("删除该月数据？")) return;
    state.business.splice(+b.dataset.bzdel, 1); save(); renderBusiness(); renderCurve();
  }));
}

/* V4 4.4 严重度公式化（四问辅助打分：买家接近+竞品替代+准确性风险+营收相关性，各1-5，均值入严重度） */
/* V4.2：通用表单弹窗（替代原生 prompt——原生弹窗阻塞且样式突兀；fields=[{id,label,value}]） */
function formDialog(title, fields, onOk, okText) {
  let mask = $("#formDialogMask");
  if (!mask) {
    mask = document.createElement("div");
    mask.id = "formDialogMask"; mask.className = "modal-mask";
    mask.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <h3 id="fdTitle" style="margin-top:0"></h3>
      <div id="fdBody"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" id="fdCancel" type="button">取消</button>
        <button class="btn btn-primary" id="fdOk" type="button">${okText || "确定"}</button></div></div>`;
    document.body.appendChild(mask);
  }
  $("#fdTitle").textContent = title;
  $("#fdBody").innerHTML = fields.map(f =>
    `<label class="full lb" style="display:block;margin-bottom:8px">${esc(f.label)}<input id="fd_${f.id}" class="inp" style="width:100%" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}"></label>`).join("");
  mask.hidden = false;
  const close = () => { mask.hidden = true; };
  $("#fdCancel").onclick = close;
  $("#fdOk").onclick = () => { const vals = {}; fields.forEach(f => vals[f.id] = $("#fd_" + f.id).value.trim()); close(); onOk(vals); };
  const first = $("#fd_" + fields[0].id); if (first) first.focus();
}
function sevPromptAssistant(onDone) {
  /* V4.2：四问一次填完（原为4次阻塞式 prompt），四问平均=严重度 */
  formDialog("公式打分（四问定严重度，1-5分）", [
    { id: "q1", label: "买家接近度（1=纯科普，5=直接决定选谁）", value: "3" },
    { id: "q2", label: "竞品替代风险（1=无竞品，5=竞品常赢此问）", value: "3" },
    { id: "q3", label: "准确性风险（1=无关事实，5=常被说错数据）", value: "3" },
    { id: "q4", label: "营收相关性（1=边缘，5=核心招商转化）", value: "3" },
  ], v => {
    const vals = [v.q1, v.q2, v.q3, v.q4].map(x => Math.max(1, Math.min(5, +x || 3)));
    onDone(Math.max(1, Math.min(5, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))));
  }, "计算严重度");
}

/* ══ V4 3.4 贴答案自动填（/api/parse，人确认后才入库）══ */
function competitorCandidates() {
  /* V5：项目设置配置的竞品置顶，台账高频共现补充（去重） */
  const freq = {};
  (state.ledger || []).forEach(r => (r.cooccur || []).forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
  const fromLedger = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 8);
  const fromMeta = (curProject().competitors || []).slice(0, 5);
  return [...new Set([...fromMeta, ...fromLedger])].slice(0, 10);
}
function openParseModal() {
  $("#parseModal").hidden = false;
  $("#pmTa").value = "";
  $("#pmComp").value = competitorCandidates().join("、");
  $("#pmOut").innerHTML = "";
}
async function runParseFill() {
  const text = $("#pmTa").value.trim();
  if (!text) { toast("先粘贴 AI 回答原文"); return; }
  const btn = $("#pmRun"); btn.classList.add("is-busy"); btn.textContent = "解析中…";
  $("#pmOut").innerHTML = '<p class="muted">模型解析中（约5–20秒）…</p>';
  let d;
  try {
    const r = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, brand: curProject().brand || curProject().name, competitors: $("#pmComp").value.split(/[、,，\s]+/).filter(Boolean) }) });
    d = await r.json();
  } catch (e) { d = { error: String(e) }; }
  btn.classList.remove("is-busy"); btn.textContent = "解析并填入表单";
  if (d.error) { $("#pmOut").innerHTML = `<p style="color:var(--color-bad)">解析失败：${esc(d.error)}</p><p class="muted" style="font-size:12px">已优雅降级——直接在②区手工填写即可。</p>`; return; }
  $("#mMention").value = String(d.mention ?? "");
  $("#mSentiment").value = String(d.sentiment ?? 0.5);
  if ((d.citedDomains || []).length) $("#mUrl").value = "https://" + String(d.citedDomains[0]).replace(/^https?:\/\//i, "").split("/")[0];
  $("#mCooccur").value = (d.competitorMentions || []).join("、");
  $("#pmOut").innerHTML = `<p style="color:var(--color-ok)">✓ 已自动填入②区：提及=${d.mention ?? "—"} · 倾向=${d.sentiment ?? "—"} · 引用域名=${(d.citedDomains || []).join("、") || "无"} · 竞品同时出现=${(d.competitorMentions || []).join("、") || "无"}</p>
    <p class="muted" style="font-size:12px">请人工核对后选择引擎与问题，点「保存记录」入库——解析结果不会自动提交。</p>`;
  $("#parseModal").hidden = true;
  $("#mEngine").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("已自动填入，核对引擎/问题后点「保存记录」");
}

/* ── 视图渲染 ─────────────────────────────── */
const render = {};
render.evidence = renderEvidence;   /* V4 3.3：证据库（renderEvidence 定义在前，函数声明可提升） */

/* ══ 1. 总览 ══ */
/* V4 2.3：起始数据对比（起始数据→当前+Δ；提及率按通道分层取值） */
function snapBaseline() {
  const S = state.snapshots || [];
  const base = S.find(x => x.baseline) || S[0] || null;
  return { base, cur: S[S.length - 1] || null, n: S.length, comparable: S.length >= 2 };
}
function deltaTag(cur, base, unit, lowerBetter) {
  if (cur === null || cur === undefined || base === null || base === undefined) return "";
  const d = cur - base;
  if (!d) return `<span class="tag" style="margin-left:6px">持平</span>`;
  const good = lowerBetter ? d < 0 : d > 0;
  return `<span class="tag ${good ? "tag-ok" : "tag-bad"}" style="margin-left:6px">${d > 0 ? "+" : ""}${d}${unit} vs 起始数据</span>`;
}
render.dashboard = () => {
  const s = auditScore(), st = ledgerStats();
  const sb = snapBaseline();
  const curMention = sb.cur ? (sb.cur.mentionAns !== null ? { v: sb.cur.mentionAns, ch: "答案侧", n: sb.cur.mentionAnsN } :
                      (sb.cur.mentionSrc !== null ? { v: sb.cur.mentionSrc, ch: "信源", n: sb.cur.mentionSrcN } : null)) : null;
  const baseMention = sb.base ? (sb.base.mentionAns !== null ? sb.base.mentionAns : sb.base.mentionSrc) : null;
  $("#dashScore").innerHTML = `<div class="kpi-num">${s.pct}<small> /100</small></div>
    <p>园区GEO成熟度（${auditN()}项体检）${sb.comparable ? deltaTag(sb.cur.auditPct, sb.base.auditPct, "分") : (sb.n === 1 ? '<span class="tag tag-gold" style="margin-left:6px">首测即起始数据</span>' : "")}</p>
    <a href="#/diag/audit" class="mini-link">去体检 →</a>`;
  $("#dashMon").innerHTML = `<div class="kpi-num">${curMention === null ? (st.mention === null ? "—" : Math.round(st.mention * 100) + "<small>%</small>") : curMention.v + "<small>%</small>"}</div>
    <p>${curMention ? `${curMention.ch}提及率 · n=${curMention.n}${sb.comparable ? deltaTag(curMention.v, baseMention, "pp") : ""}` : `答案侧平均提及率 · ${st.ansN}条人工记录${st.aiN ? `（另有AI代问 ${st.aiN} 条，另计）` : ""}${st.ansN ? "" : "（先在监测页人工录入）"}`}</p>
    <a href="#/monitor" class="mini-link">去监测 →</a>`;
  const _og = (typeof ledgerStats === "function" ? (ledgerStats() || {}) : {});
  $("#dashCal").innerHTML = `<div class="kpi-num">${sb.cur && sb.cur.ownHitN !== null ? sb.cur.ownHitN + "<small> /" + (sb.cur.ownHitTotal || "?") + "</small>" : "—"}</div>
    <p>品牌词自有渠道（信源最近一轮）${sb.comparable && sb.cur.ownHitN !== null && sb.base.ownHitN !== null ? deltaTag(sb.cur.ownHitN, sb.base.ownHitN, "问") : ""}${_og.ownC !== undefined && (_og.ownC || _og.ownG) ? `<br><span class="muted" style="font-size:11px">答案侧被引：可控阵地 ${_og.ownC} · 集团信源 ${_og.ownG}</span>` : ""}<br>
    <span class="muted" style="font-size:11px">口径表 ${state.caliber.length} 字段 · ${state.caliber.filter(r => (r.conflicts || []).length).length} 冲突</span></p>
    <a href="#/diag/caliber" class="mini-link">去治理 →</a>`;

  /* V6 1.6 四步起步向导卡（新项目起步路径）
     V0.2.2 F2：显示条件改「四步未全部完成」——原「口径空||未体检||已填<3」在完成①②后即隐藏，
     ③下载百科稿/④地图认领永远失去引导，进度不可能到 4/4 */
  const ob = $("#dashOnboard");
  const filledCal = state.caliber.filter(r => (r.official || "").trim()).length;
  if (ob) {
    const hasTk = ((state.watchPages || state.fixQueue || []).length > 0) || !!(state.planInputs || {}).everBuilt;   /* V0.2.2：state.watch→watchPages（③ 完成判定此前恒 false 的笔误同修） */
    const steps = [
      { ok: filledCal >= 3, t: "① 填口径骨架", d: "锚定实体全称/地址，填 3 个最关键数字（10 分钟）", href: "#/diag/caliber", est: "10 分钟" },
      { ok: !!state.lastDiag, t: "② 跑体检 + 看谁在替你说话", d: "一键真实搜索，看这个项目在网上现在是什么样子（2 分钟）", href: "#/diag/scan", est: "2 分钟" },
      { ok: hasTk, t: "③ 下载《百科词条更新稿》", d: "按稿提交创建/更新词条——没有官网的项目，百科就是第一官方门面（15 分钟）", href: "#/act/toolkit", est: "15 分钟" },
      { ok: !!(state.onboard || {}).mapDone, t: "④ 三大地图认领", d: "按《地图信息核对清单》在高德/百度/腾讯认领（清单已生成）", href: "#/act/toolkit", est: "10 分钟" },
    ];
    const isFresh = steps.some(x => !x.ok);
    ob.hidden = !isFresh;
    if (isFresh) {
      const done = steps.filter(x => x.ok).length;
      $("#obSteps").innerHTML = steps.map(x => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--color-paper-2);border:1px solid var(--color-line)">
          <span class="tag ${x.ok ? "tag-ok" : "tag-warn"}" style="min-width:auto">${x.ok ? "✓ 已完成" : x.est}</span>
          <span style="flex:1"><b>${x.t}</b> <span class="muted" style="font-size:12px">${x.d}</span></span>
          ${x.ok ? "" : `<a class="btn btn-sm btn-primary" href="${x.href}" style="height:28px">前往 →</a>`}
        </div>`).join("") + (steps[3].ok ? "" : `<div style="display:flex;justify-content:flex-end;margin-top:2px"><button class="btn btn-sm btn-ghost" id="obMapDone" style="height:28px">④ 已完成地图认领 ✓</button></div>`);
      $("#obProg").textContent = `进度 ${done}/4${done === 4 ? "——起步完成！下一步：双周跑一轮监测看变化。" : ""}`;
      const obm = $("#obMapDone");
      if (obm) obm.addEventListener("click", () => { state.onboard = Object.assign({}, state.onboard, { mapDone: true }); save(); render.dashboard(); toast("起步四步完成 ✓ 建议双周跑一轮监测"); });
    }
  }

  /* 下一步清单（按状态推导） */
  const todo = [];
  if (!state.caliber.length) todo.push(["口径", "先建口径：骨架已生成（锚定实体/地址/片区+关键数字），填 3 个最关键字段即可开始", "#/diag/caliber"]);
  if (s.pct === 0) todo.push(["体检", (curProject() || {}).matrixTier === "lite" ? "完成实体资产清单打分，建立起始数据" : `完成${auditN()}项园区GEO体检，建立成熟度起始数据`, "#/diag/audit"]);
  /* V4.2：冲突提示带出真实字段名，不再写死蛇口网谷案例 */
  const _confFields = state.caliber.filter(r => (r.conflicts || []).length).map(r => r.field);
  if (_confFields.length) todo.push(["口径", `口径表存在冲突字段（${_confFields.slice(0, 3).join("、")}），先统一再发布任何内容`, "#/diag/caliber"]);
  if (st.ansN === 0) todo.push(["起始数据", "在六引擎执行30问首轮人工实测并录入台账（AI代问行不算人工基线）", "#/monitor"]);
  if (st.n > 0 && st.n < 180) todo.push(["起始数据", `监测记录 ${st.n}/180（30问×6引擎），继续补齐`, "#/monitor"]);
  if (s.pct > 0) todo.push(["方案", "用方案生成器产出本园区90天行动方案", "#/act/plan"]);
  todo.push(["内容", "首批改写：一园一档 + 选址对比文（当前最空白场景）", "#/act/brief"]);
  $("#dashTodo").innerHTML = todo.map((t, i) =>
    `<li><span class="step-no">${i + 1}</span><b>${t[0]}：</b>${esc(t[1])} <a href="${t[2]}" style="color:var(--color-info)">前往→</a></li>`).join("");

  /* 起始数据观察 */
  const LV = { ok:["tag-ok","✓"], warn:["tag-warn","⚠"], bad:["tag-bad","✗"], risk:["tag-bad","✗"] };
  /* V4.2：蛇口网谷基线发现是种子项目的静态快照，只在对应项目显示；其他项目给数据驱动的占位 */
  /* V4.2：蛇口网谷基线发现是种子项目的静态快照，只在对应项目显示；其他项目给数据驱动的占位
     V5：卡片副标题（hint）同样按项目切换（此前只换了内容没换标题——非种子项目仍显示蛇口快照标题） */
  const _isSeedPark = CUR === "p_default" || /蛇口网谷/.test(curProject().brand || "") || /蛇口网谷/.test(curProject().name || "");
  const bh = $("#dashBaseHint");
  if (bh) bh.textContent = _isSeedPark ? "蛇口网谷信源侧静态快照（2026-09-04）· 有时效，以最新一键诊断为准"
                                       : "本园区的起始数据要点（完成一键诊断与首轮30问后自动汇总）";
  $("#dashBase").innerHTML = _isSeedPark ? GEO.baselineNotes.map(b =>
    `<li><span class="tag ${LV[b.level][0]}">${LV[b.level][1]} ${esc(b.cat)}</span><span style="margin-left:6px">${esc(b.finding)}</span></li>`).join("")
    : `<li><span class="tag tag-info">i</span><span style="margin-left:6px">本项目暂无基线发现——完成「一键诊断」和一轮「30问监测」后，这里汇总本园区的起始数据要点。</span></li>`;
};

/* ══ 1b. 项目总览（启动页卡片墙）══ */
let SERVER_SUM = null;   /* V4 4.1：服务器侧组合指标（跨项目一致视图） */
function trendArrow(t) {
  if (t === null || t === undefined) return '<b style="color:var(--color-ink-3)">—</b>';
  if (t > 0) return `<b style="color:var(--color-ok)">↑${t}pp</b>`;
  if (t < 0) return `<b style="color:var(--color-bad)">↓${-t}pp</b>`;
  return '<b style="color:var(--color-ink-3)">→持平</b>';
}
function renderProjectCards(useServer) {
  const sums = (useServer && SERVER_SUM) ? Object.fromEntries(SERVER_SUM.map(x => [x.id, x.summary || {}])) : {};
  /* 数据装配：服务器 summary 优先，本机缓存兜底；卡片只答三个问题——这是谁/健康吗/有事等我吗 */
  let list = PROJECTS.map(p => {
    const snap = projectSnapshot(p);
    const sm = sums[p.id] || {};
    const entMode = sm.entMode || (snap && snap.entMode) || ((p.url || "").trim() ? "parent" : "none");
    const pct = useServer ? sm.auditPct ?? (snap ? snap.pct : null) : (snap ? snap.pct : null);
    const lastDiag = ((useServer ? sm.lastDiag : null) ?? (snap ? snap.lastDiag : "") ?? "") || "";
    const lastRound = useServer ? sm.lastRound ?? (snap ? snap.last : null) : (snap ? snap.last : null);
    const trend = sm.trend ?? null;
    const woPending = (useServer ? sm.woPending : null) ?? (snap ? snap.woPending : 0) ?? 0;
    return { p, entMode, pct, trend, warn: useServer ? (sm.warn || []) : localWarn(p, snap), woPending: woPending || 0,
             lastDiag, lastRound, lastOpen: p.lastOpen || 0, createdAt: p.createdAt || "" };
  });
  /* 过滤：搜索（名/品牌词/域名）+ 形态 + 状态（未诊断/有预警） */
  const q = PJ_FILTERS.q.trim().toLowerCase();
  if (q) list = list.filter(x => [x.p.name, x.p.brand, x.p.url].some(v => String(v || "").toLowerCase().includes(q)));
  if (PJ_FILTERS.mode !== "all") list = list.filter(x => x.entMode === PJ_FILTERS.mode);
  if (PJ_FILTERS.status === "undiagnosed") list = list.filter(x => !x.lastDiag);
  if (PJ_FILTERS.status === "warn") list = list.filter(x => x.warn.length > 0);
  /* 排序：recent=最近活动(打开/监测取新) · stale=最久未测(未测最前) · score · created · name */
  const dayOf = x => { const a = [x.lastOpen ? new Date(x.lastOpen).toISOString().slice(0, 10) : "", x.lastRound || ""].filter(Boolean); return a.length ? a.sort().reverse()[0] : ""; };
  const sorters = {
    recent: (a, b) => dayOf(b).localeCompare(dayOf(a)),
    stale: (a, b) => String(a.lastRound || a.lastDiag || "").localeCompare(String(b.lastRound || b.lastDiag || "")),
    score: (a, b) => ((b.pct ?? -1) - (a.pct ?? -1)),
    created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    name: (a, b) => String(a.p.name).localeCompare(String(b.p.name), "zh"),
  };
  list.sort(sorters[PJ_FILTERS.sort] || sorters.recent);
  /* 统计条（按当前筛选动态） */
  const undN = list.filter(x => !x.lastDiag).length, warnN = list.filter(x => x.warn.length > 0).length, woN = list.filter(x => x.woPending > 0).length;
  const stat = $("#pjStat");
  if (stat) stat.innerHTML = `共 <b class="num">${list.length}</b> 个项目 · <b class="num"${undN ? ' style="color:var(--color-warn)"' : ""}>${undN}</b> 个未诊断 · <b class="num"${warnN ? ' style="color:var(--color-warn)"' : ""}>${warnN}</b> 个有预警 · <b class="num"${woN ? ' style="color:var(--color-bad)"' : ""}>${woN}</b> 个有整改任务待确认`;
  /* 上次处理条：最近打开优先，无记录时取最近活动，与筛选无关、一步直达 */
  const rec = $("#pjRecent");
  if (rec) {
    const cand = [...PROJECTS.map(p => {
      const snap = projectSnapshot(p);
      const sm = sums[p.id] || {};
      return { p, day: [p.lastOpen ? new Date(p.lastOpen).toISOString().slice(0, 10) : "", sm.lastRound || (snap ? snap.last : "") || ""].filter(Boolean).sort().reverse()[0] || "" };
    })].filter(x => x.day).sort((a, b) => b.day.localeCompare(a.day))[0];
    rec.innerHTML = cand ? `<button class="pj-recent" type="button" data-pid="${esc(cand.p.id)}">
      <span class="pj-rec-lb">上次处理</span><b>${esc(cand.p.name)}</b><span class="muted" style="font-size:var(--text-xs)">${esc(String(cand.day).slice(5))}</span><span class="pc-go">继续 →</span></button>` : "";
    $$("#pjRecent [data-pid]").forEach(b => b.addEventListener("click", () => switchProject(b.dataset.pid)));
  }
  /* V0.1.13 F2：重名区分——同名项目在标题后追加域名/形态，不再让两张同名卡靠猜 */
  const nameCount = {};
  PROJECTS.forEach(p => { nameCount[p.name] = (nameCount[p.name] || 0) + 1; });
  const cards = list.map(({ p, entMode, pct, trend, warn, woPending, lastDiag }) => {
    const scoreColor = pct !== null && pct !== undefined
      ? (pct >= 70 ? "var(--color-ok)" : pct >= 40 ? "var(--color-warn)" : "var(--color-accent)")
      : "var(--color-ink-3)";
    const dupTag = nameCount[p.name] > 1
      ? `<span class="muted" style="font-size:11px">· ${esc(p.url || ENT_LABEL[entMode] || "")}</span>` : "";
    return `<button class="proj-card${p.id === CUR ? " cur" : ""}" type="button" data-pid="${esc(p.id)}" aria-label="进入项目 ${esc(p.name)}"${(p.entityMode === "none" || entMode === "none") && pct !== null && pct !== undefined ? ` title="体检分为${entMode === "none" ? 24 : 30}项口径；跨项目请比趋势，不建议比绝对分"` : ""}>
      <span class="pc-top"><b class="pc-title">${esc(p.name)}</b>${dupTag}${p.sample ? '<span class="tag" title="演示用示例项目——在「设置」里改成你自己的园区，或直接归档">示例·可改名</span>' : ""}${p.id === CUR ? '<span class="tag tag-gold">当前</span>' : ""}</span>
      <span class="pc-badges"><span class="tag ${entMode === "none" ? "tag-warn" : entMode === "own" ? "tag-info" : "tag-gold"}">${ENT_LABEL[entMode] || "挂上级官网"}</span>
        ${!lastDiag ? '<span class="tag tag-bad">● 未诊断</span>' : ""}</span>
      <span class="pc-stats">
        <span><i>体检分（${entMode === "none" ? 24 : 30}项）</i><b style="color:${scoreColor}">${pct ?? "—"}</b></span>
        <span><i>vs起始数据</i>${trendArrow(trend)}</span>
      </span>
      ${woPending ? `<span class="pc-todo">⚠ ${woPending} 件整改任务待确认</span>` : ""}
      ${warn.length ? `<span class="pc-warn">${warn.slice(0, 2).map(w => `<span class="tag tag-warn">⚠ ${esc(w)}</span>`).join("")}</span>` : ""}
      <span class="pc-go">进入工作台 →</span>
      <span class="pc-arch" data-set="${esc(p.id)}" title="修改项目信息（形态/城市/产业/竞品等）" role="button" tabindex="0">设置</span>
      <span class="pc-arch" data-arch="${esc(p.id)}" title="归档（数据保留，可恢复）" role="button" tabindex="0">归档</span>
    </button>`;
  }).join("");
  /* 空库时欢迎区的大按钮负责新建；有项目时筛选无结果给明确提示（不再误显"新建第一个"） */
  $("#projGrid").innerHTML = cards ||
    (PROJECTS.length ? '<p class="muted" style="padding:24px 0;text-align:center">没有符合条件的项目——换个搜索词，或点上方「全部」清除筛选。</p>' : "");
  bindProjCardEvents(useServer);
  renderArchived();
}
/* V4.6 本机缓存的预警近似（服务器 summary 未到位时的兜底口径，与 server warn 同源逻辑） */
function localWarn(p, snap) {
  const w = [];
  if (!snap || !snap.n) w.push("无监测");
  return w;
}
async function restoreProject(pid) {
  if (!SERVER_MODE) { toast("归档恢复需要后台运行"); return; }
  try {
    const r = await fetch("/api/projects/archive", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pid, archived: false, operator: localStorage.getItem("geodesk.operator") || "" }) });
    const d = await r.json();
    if (!r.ok || !d.ok) { toast("恢复失败：" + (d.error || r.status)); return; }
  } catch (e) { toast("恢复失败：" + e); return; }
  toast("已恢复到项目库");
  await refreshProjectsFromServer();
}
async function refreshProjectsFromServer() {
  if (!SERVER_MODE) return;
  const d = await API.projects();
  if (d && Array.isArray(d.projects)) {
    SERVER_SUM = d.projects;
    const mapP = p => ({ id: p.id, name: p.name, url: p.url || "", brand: p.brand || "",
                         operator: p.operator || "", entityMode: p.entityMode || "", archived: !!p.archived,
                         city: p.city || "", industries: p.industries || [], competitors: p.competitors || [],
                         matrixTier: p.matrixTier || "park",
                         groupDomains: p.groupDomains || [],
                         ownDomains: p.ownDomains || [], createdAt: p.createdAt });
    const oldOpen = Object.fromEntries(PROJECTS.map(p => [p.id, p.lastOpen]));
    ARCHIVED_PROJS = d.projects.filter(p => p.archived).map(mapP);
    PROJECTS = d.projects.filter(p => !p.archived).map(p => Object.assign(mapP(p), oldOpen[p.id] ? { lastOpen: oldOpen[p.id] } : {}));
    saveProjectsMeta();
  }
  renderProjectCards(true);
}
function renderArchived() {
  const box = $("#pjArchBox"); if (!box) return;
  if (!PJ_FILTERS.archived || !ARCHIVED_PROJS.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<p class="kicker" style="margin:14px 0 6px">已归档（${ARCHIVED_PROJS.length}）· 数据完整保留</p>` +
    ARCHIVED_PROJS.map(p => `<div class="proj-card archived" style="display:flex;align-items:center;gap:10px;cursor:default">
      <b class="pc-title" style="flex:1;min-width:0">${esc(p.name)}</b>
      <span class="tag">${ENT_LABEL[p.entityMode] || ""}</span>
      <button class="btn btn-sm btn-ghost" data-restore="${esc(p.id)}">恢复到项目库</button>
    </div>`).join("");
  $$("#pjArchBox [data-restore]").forEach(b => b.addEventListener("click", () => restoreProject(b.dataset.restore)));
}
function bindProjCardEvents(useServer) {
  $$("#projGrid [data-arch]").forEach(el => el.addEventListener("click", async e => {
    e.stopPropagation();
    const pid = el.dataset.arch;
    if (!confirm("归档该项目？数据完整保留（口径表/台账/曲线），可随时恢复。")) return;
    if (SERVER_MODE) {
      try {
        const r = await fetch("/api/projects/archive", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: pid, archived: true, operator: localStorage.getItem("geodesk.operator") || "" }) });
        const d = await r.json();
        if (!r.ok || !d.ok) { toast("归档失败：" + (d.error || r.status)); return; }
      } catch (e) { toast("归档失败：" + e); return; }
    }
    const removed = PROJECTS.find(x => x.id === pid);
    PROJECTS = PROJECTS.filter(x => x.id !== pid);
    if (removed) ARCHIVED_PROJS.unshift(removed);
    if (CUR === pid && PROJECTS.length) { CUR = PROJECTS[0].id; loadCurrentState(); renderProjectContext(); renderAllViews(); }
    saveProjectsMeta();
    renderProjectCards(useServer && !!SERVER_SUM);
    toast("已归档（在「含已归档」开关下可随时恢复）");
  }));
  /* V5：项目设置（形态/城市/产业/竞品/档位随时可改） */
  $$("#projGrid [data-set]").forEach(el => el.addEventListener("click", e => {
    e.stopPropagation();
    openProjEdit(el.dataset.set);
  }));
}
/* V5 项目设置弹窗 */
function openProjEdit(pid) {
  const p = PROJECTS.find(x => x.id === pid) || ARCHIVED_PROJS.find(x => x.id === pid);
  if (!p) return;
  $("#peName").value = p.name || "";
  $("#peBrand").value = p.brand || "";
  const mode = p.entityMode || entMode();
  const mEl = document.querySelector(`input[name="peMode"][value="${mode === "own" ? "own" : mode === "none" ? "none" : "parent"}"]`);
  if (mEl) mEl.checked = true;
  $("#peUrl").value = p.url || "";
  $("#peCity").value = p.city || "";
  $("#peInd").value = (p.industries || []).join("、");
  $("#peComp").value = (p.competitors || []).join("、");
  $("#peOperator").value = p.operator || "";
  $("#peOwn").value = (p.ownDomains || []).join("\n");
  $("#peGroup").value = (p.groupDomains || []).join("\n");
  $("#peTier").value = p.matrixTier || "park";
  $("#projEditModal").dataset.pid = pid;
  $("#projEditModal").hidden = false;
}
/* V6 1.3：品牌词歧义异步检测（阳性信号；只提示不阻断） */
async function brandCheckHint(brand, city, onFix) {
  if (!brand || !SERVER_MODE) return;
  try {
    const r = await fetch("/api/brandcheck", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, city: city || "" }) });
    const d = await r.json();
    if (d && d.ambiguity && d.suggestion && d.suggestion !== brand) {
      const sample = (d.samples || [])[0] || "";
      if (confirm(`提醒：搜索「${brand}」时出现了其他城市的同名项目${sample ? `（例：${sample}…）` : ""}。\n建议把品牌词改为「${d.suggestion}」，监测和体检会更准。\n\n点「确定」改为「${d.suggestion}」，点「取消」保持不变。`)) {
        await onFix(d.suggestion);
        toast("品牌词已修正为「" + d.suggestion + "」");
      }
    }
  } catch (e) { /* 检测失败静默——不阻断任何操作 */ }
}
async function saveProjEdit() {
  const pid = $("#projEditModal").dataset.pid;
  const p = PROJECTS.find(x => x.id === pid);
  if (!p) return;
  const modeEl = document.querySelector('input[name="peMode"]:checked');
  const mode = modeEl ? modeEl.value : p.entityMode;
  const urlVal = (mode === "none") ? "" : $("#peUrl").value.trim().slice(0, 120);
  /* V0.2.2 F6：own/parent 形态空域名拦截（与新建弹窗同一校验）——此前可静默保存空域名：
     形态来回切换后域名丢失无提示，一键诊断预填随之为空 */
  if (mode !== "none" && !urlVal) { toast("请填官网承载页域名；确实没有官网就选「无官网（实体体检路线）」"); return; }
  const partial = {
    name: $("#peName").value.trim().slice(0, 60) || p.name,
    brand: $("#peBrand").value.trim().slice(0, 60),
    entityMode: mode,
    url: urlVal,
    city: $("#peCity").value.trim().slice(0, 40),
    industries: $("#peInd").value.split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5),
    competitors: $("#peComp").value.split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5),
    operator: $("#peOperator").value.trim().slice(0, 60),
    ownDomains: $("#peOwn").value.split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean).slice(0, 20),
    groupDomains: $("#peGroup").value.split(/[\n,，;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 10),
    matrixTier: $("#peTier").value === "lite" ? "lite" : "park",
  };
  await saveProjMetaFor(pid, partial);
  if (CUR === pid) { state.entityMode = partial.entityMode; save(); renderProjectContext(); renderAllViews(); }
  $("#projEditModal").hidden = true;
  renderProjectCards(SERVER_MODE && !!SERVER_SUM);
  toast("项目信息已保存" + (partial.entityMode === "none" ? "（体检分母已按 24 项口径）" : ""));
  if (partial.brand && partial.brand !== (PROJECTS.find(x => x.id === pid) || {}).brand) { /* 已保存，仅提示性检测 */ }
  brandCheckHint(partial.brand, partial.city, async nb => { await saveProjMeta({ brand: nb }); state.prompts = instPrompts(Object.assign({}, curProject(), { district: caliberDistrict() }), curProject().matrixTier); save(); renderAllViews(); });
}
async function rebuildPromptsByTier() {
  const pid = $("#projEditModal").dataset.pid;
  const p = PROJECTS.find(x => x.id === pid);
  if (!p) return;
  const tier = $("#peTier").value === "lite" ? "lite" : "park";
  /* 保存当前表单值（重建矩阵要用最新元数据） */
  await saveProjEdit();
  if (!confirm(`按「${tier === "lite" ? "轻量版 14 问" : "完整版 30 问"}」重新生成问题矩阵？\n（会覆盖问题矩阵里的手动编辑；已录台账与曲线不受影响）`)) return;
  if (CUR === pid) {
    state.prompts = instPrompts(Object.assign({}, p, { district: caliberDistrict() }), tier);
    save();
    toast(`问题矩阵已重新生成（${state.prompts.length} 问）——到「监测」查看`);
    go("monitor");
  }
}
/* 按指定项目更新元数据（saveProjMeta 只管当前项目） */
async function saveProjMetaFor(pid, partial) {
  const p = PROJECTS.find(x => x.id === pid);
  if (!p) return;
  Object.assign(p, partial);
  saveProjectsMeta();
  if (SERVER_MODE) await API.updateProject(Object.assign({ id: pid }, partial));
}
render.projects = () => {
  /* V4.7 欢迎页：空库必显；有项目时仅本机首次访问显示（新同事第一次进来看得懂系统是什么，
     用过即收：点「知道了」或进入过任意项目后不再出现）——工具栏仅空库时隐藏 */
  const empty = !PROJECTS.length;
  let visited = false;
  try { visited = !!localStorage.getItem("geodesk.visited"); } catch (e) {}
  const wl = $("#pjWelcome"), tb = $("#pjToolbarCard"), hd = $("#pjHead");
  if (wl) wl.hidden = visited && !empty;
  if (tb) tb.hidden = empty;
  if (hd) hd.hidden = empty;
  renderProjectCards(false);   /* 先用本机缓存即时渲染 */
  renderProjToolbar();         /* V4.6 工具栏（chips 按当前筛选态高亮） */
  if (SERVER_MODE) {
    API.projects().then(d => {
      if (d && Array.isArray(d.projects)) {
        SERVER_SUM = d.projects;
        renderProjectCards(true);   /* 服务器汇总到位后刷新（含趋势/预警/待办，跨机器一致） */
      }
    });
  }
  renderAuditBox();
};
/* V4.6 项目库工具栏：形态/状态 chips 动态渲染（搜索/排序/归档开关为静态控件，事件在 bind() 一次性委托） */
function renderProjToolbar() {
  const box = $("#pjChips"); if (!box) return;
  const modes = [["all", "全部"], ["own", "有官网"], ["parent", "挂上级官网"], ["none", "无官网"]];
  const statuses = [["all", "全部"], ["undiagnosed", "未诊断"], ["warn", "有预警"]];
  /* V0.1.9：形态/状态各成一组（标签+胶囊同行），移动端每组独占一行——修复标签与胶囊挤贴/错位 */
  box.innerHTML = `<span class="pj-group"><span class="pj-lb">形态</span>` +
    modes.map(([v, t]) => `<button class="chip${PJ_FILTERS.mode === v ? " on" : ""}" data-fm="${v}">${t}</button>`).join("") +
    `</span><span class="pj-group"><span class="pj-lb">状态</span>` +
    statuses.map(([v, t]) => `<button class="chip${PJ_FILTERS.status === v ? " on" : ""}" data-fs="${v}">${t}</button>`).join("") + `</span>`;
}
/* V4.6 报头两态：项目库页=「☰ 项目库」高亮；项目内=「‹ 项目库 | 项目名」一步返回 */
let CUR_VIEW = "projects";
function updateProjChip(view) {
  const chip = $("#projChip"); if (!chip) return;
  if (view === "projects") {
    chip.innerHTML = `<span class="pc-ico" aria-hidden="true">☰</span><span class="pc-name" id="pcName">项目库</span>`;
    chip.classList.add("pj-on"); chip.setAttribute("aria-current", "page"); chip.title = "当前在项目库";
  } else {
    chip.classList.remove("pj-on"); chip.removeAttribute("aria-current");
    chip.innerHTML = `<span class="pc-back">‹ 项目库</span><span class="pc-name" id="pcName">${esc(curProject().name || "—")}</span>`;
    chip.title = "返回项目库";
  }
}

/* ══ 2. 口径表 ══ */
function caliberRow(r, i) {
  const conflict = (r.conflicts || []).length;
  return `<tr class="cal-row">
    <td data-col="园区"><input class="inp" style="min-height:34px" value="${esc(r.park)}" data-ci="${i}" data-f="park"></td>
    <td data-col="字段"><input class="inp" style="min-height:34px" value="${esc(r.field)}" data-ci="${i}" data-f="field"></td>
    <td data-col="官方口径" class="${conflict ? "cal-conflict" : ""}"><textarea class="ta" rows="${Math.min(9, Math.max(2, Math.ceil((r.official || "").length / 16)))}" data-ci="${i}" data-f="official" style="min-height:0;padding:8px 10px;line-height:1.55;font-size:13px">${esc(r.official)}</textarea>
      ${conflict ? `<span class="conflict-note">⚠ 外部存在${conflict}个冲突口径（右侧）</span>` : ""}
      ${(r.scaffold && !r.official) ? `<span class="conflict-note" style="color:var(--color-ink-3)">💡 待填 · ${esc(r.hint || "")}</span>` : ""}</td>
    <td data-col="时点"><input class="inp" style="min-height:34px" value="${esc(r.asOf)}" data-ci="${i}" data-f="asOf"></td>
    <td data-col="来源"><input class="inp" style="min-height:34px" value="${esc(r.source)}" data-ci="${i}" data-f="source"></td>
    <td data-col="冲突口径" class="cal-conflicts">${(r.conflicts || []).map(c => `<span class="tag tag-warn" title="${esc(c.src)}">${esc(c.v)} · ${esc(c.src)}</span>`).join("") || '<span class="muted">—</span>'}
      <button class="btn btn-sm btn-ghost" data-cadd="${i}" title="登记外部冲突口径（值+来源），列入治理清单" style="margin-top:4px">＋冲突</button></td>
    <td data-col="操作"><button class="btn btn-sm btn-danger" data-cdel="${i}">删除</button></td>
  </tr>`;
}
render.caliber = () => {
  $("#caliberBody").innerHTML = state.caliber.map(caliberRow).join("") ||
    '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">暂无字段，点击下方添加</td></tr>';
  const nConf = state.caliber.filter(r => (r.conflicts || []).length).length;
  $("#caliberSummary").innerHTML = `共 <b class="num">${state.caliber.length}</b> 个字段，<b class="num" style="color:var(--color-warn)">${nConf}</b> 个存在外部冲突口径。`;
  $$("#caliberBody [data-f]").forEach(inp => inp.addEventListener("change", () => {
    state.caliber[+inp.dataset.ci][inp.dataset.f] = inp.value; save();   /* V4.2：自动保存，不再逐格弹 toast */
  }));
  $$("#caliberBody [data-cdel]").forEach(b => b.addEventListener("click", () => {
    state.caliber.splice(+b.dataset.cdel, 1); save(); render.caliber(); toast("已删除");
  }));
  /* V4.2：冲突口径录入——补齐 SOP「发现新冲突随时录入」的入口 */
  $$("#caliberBody [data-cadd]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.cadd;
    formDialog("登记外部冲突口径", [
      { id: "cv", label: "冲突口径内容（外部说法的数值/表述）", value: "", placeholder: "如：入驻企业708家" },
      { id: "cs", label: "来源（媒体/渠道名，可附说明）", value: "", placeholder: "如：某公众号 2026-08" },
    ], v => {
      if (!v.cv) { toast("请填写冲突口径内容"); return; }
      state.caliber[i].conflicts = state.caliber[i].conflicts || [];
      state.caliber[i].conflicts.push({ v: v.cv, src: v.cs || "未注明来源" });
      save(); render.caliber(); toast("冲突口径已登记，列入治理清单");
    }, "登记冲突");
  }));
};

/* ══ 3. 体检 ══ */
render.audit = () => {
  /* V0.1.10：「去体检表看填入」带一次性聚焦——自动填入项加金框+顶部说明条（阅后即焚） */
  const autoFocus = typeof window !== "undefined" && window.__auditAuto;
  if (typeof window !== "undefined") window.__auditAuto = 0;
  const s = auditScore(), dims = auditDims();   /* V0.2.4 读分说明与环/雷达同源取数 */
  const autoNote = autoFocus && state.autoAudit && Object.keys(state.autoAudit).length
    ? `<div class="auto-note">金框「自动」项 = 最近一次一键诊断自动填入（含实测 0 分项）——人工复核后点任意分值即转为人工评分。</div>` : "";
  $("#auditChecklist").innerHTML = auditStory(s, dims) + autoNote + GEO.audit.map((d, di) => {
    const dimSkip = noSite() && d.dim === "技术可达";   /* V4.5：无官网项目这6项不适用，灰显不计分 */
    return `
    <div class="card audit-dim" id="dimcard-${di}"${dimSkip ? ' style="opacity:.55"' : ""}>
      <h3>${esc(d.dim)}${d.dim === "生态布源" ? ' <span class="hint">在 AI 爱引用的平台上开号发内容</span>' : ""} <span class="hint" id="dim-${esc(d.dim)}"></span></h3>
      ${dimSkip ? '<p class="muted" style="font-size:var(--text-sm);margin:0 0 8px">本项目暂无官网承载页——这 6 项不适用、不进总分。先做下面「实体与权威」「渠道铺设」两组；有了官网回来补测。</p>' : ""}
      ${d.items.map(i => `
        <div class="audit-item${autoFocus && state.autoAudit && state.autoAudit[i.id] ? " auto-hl" : ""}"${dimSkip ? ' title="无官网项目不适用"' : ""}>
          <div class="q"><span class="code">${i.id}</span><span class="t">${esc(i.t)}${state.autoAudit && state.autoAudit[i.id] ? '<span class="auto-tag" title="最近一次一键诊断自动填入；点任意分值即转为人工评分">自动</span>' : ""}</span>
            <span class="score-seg" role="radiogroup" aria-label="${esc(i.id)}打分">
            ${[0,1,2].map(v => `<button data-audit="${i.id}" data-v="${v}" class="${state.audit[i.id] === v ? "on-" + v : ""}" aria-pressed="${state.audit[i.id] === v}"${dimSkip ? " disabled" : ""}>${v}</button>`).join("")}
            </span></div>
          <div class="std">${esc(i.std)}</div>
        </div>`).join("")}
    </div>`; }).join("");
  $$("#auditChecklist [data-audit]").forEach(b => b.addEventListener("click", () => {
    state.audit[b.dataset.audit] = +b.dataset.v;
    if (state.autoAudit) delete state.autoAudit[b.dataset.audit];   /* 人工点分=转人工，移除自动痕 */
    save(); render.audit();
  }));
  const color = s.pct >= 70 ? "var(--color-ok)" : s.pct >= 40 ? "var(--color-warn)" : "var(--color-accent)";
  $("#scoreRing").innerHTML = `<div class="ring-box">${ringSvg(s.pct, color)}
    <span class="ring-cap">总分 ${s.got} / ${s.full}</span></div>`;
  $("#scoreLevel").textContent = s.pct >= 80 ? "优秀" : s.pct >= 60 ? "良好" : s.pct >= 40 ? "待改进" : s.pct > 0 ? "起步" : "未开始";
  $("#radarBox").innerHTML = radarSvg(dims);
  GEO.audit.forEach((d, i) => { const el = $("#dim-" + d.dim); if (el) el.textContent = `${dims[i].got}/${dims[i].full}`; });
  /* V0.1.8 维度得分条：随行总结栏里的明细导航（点击滚到对应维度卡） */
  const bars = $("#dimBars");
  if (bars) {
    bars.innerHTML = GEO.audit.map((d, i) => {
      const full = dims[i].full, got = dims[i].got;
      const p = full ? Math.round(got / full * 100) : 0;
      return `<button class="dim-bar" data-dimjump="${i}" aria-label="跳到${esc(d.dim)}维度卡">
        <span>${esc(d.dim)}</span>
        <span class="track"><i style="width:${p}%"></i></span>
        <span class="num">${full ? `${got}/${full}` : "不适用"}</span></button>`;
    }).join("");
    $$("[data-dimjump]", bars).forEach(b => b.addEventListener("click", () => {
      const el = $("#dimcard-" + b.dataset.dimjump);
      if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }));
  }
};

/* ══ 4. 内容工场 ══ */
const MARKETING_WORDS = ["优美","完善","卓越","领先","一流","精心","极致","顶级","绝佳","尊享","臻","赋能客户","理想 choice","绝佳选择","理想选择","诚挚欢迎"];
const SUPERLATIVE = ["最先进","最优秀","第一品牌","唯一","顶级","国家级唯一"];
function scoreContent(text, entity) {
  const checks = [];
  const paras = text.split(/\n\s*\n/).filter(x => x.trim());
  /* V0.1.13 ①正确性修复（AI评测）：标题行（# 开头的 Markdown 标题）不算首段——
     此前把标题行当首段判定，带标题的合格文案被误判「答案前置」不达标 */
  const bodyParas = paras.filter(p => !/^\s*#{1,6}\s/.test(p));
  const first = (bodyParas[0] || paras[0] || "");
  const digits = (text.match(/\d+(\.\d+)?/g) || []).length;
  const units = (text.match(/[㎡平方米家条支亿万元%％倍强个座]/g) || []).length;
  const mkq = (text.match(/[??]/g) || []).length;
  const mk = MARKETING_WORDS.filter(w => text.includes(w));
  const sup = SUPERLATIVE.filter(w => text.includes(w));
  const hasTable = /\|.*\|/.test(text) || (digits >= 5 && units >= 4);
  const hasQuote = /[「『“"][^」』”"]{6,}[」』”"]/ .test(text) && /(负责人|总经理|创始人|董事长|总监|CEO|创始人|总裁|院长)/.test(text);
  /* V0.1.13：冒号类补全角「：」——原 [::] 实为两个半角冒号，规则自己的示范文案（更新时间：2026-09）都被判不达标 */
  const hasSrc = /(来源[：:]|据[^，。\n]{2,12}(报道|披露|统计|榜单|数据)|数据截至|截至20\d\d)/.test(text);
  const hasList = /(^|\n)\s*(\d+[\.、]|[-•])\s+/.test(text);
  const hasDate = /(更新(于|时间)[：:]?\s*20\d\d|20\d\d[-年]\d{1,2}[-月]\d{1,2})/.test(text);
  const longParas = paras.filter(p => p.replace(/\s/g, "").length > 320).length;
  const repeat = entity && entity.length >= 3 ? (text.split(entity).length - 1) : 0;

  const add = (name, pass, why, fix) => checks.push({ name, pass, why, fix });
  add("① 答案前置", first.replace(/\s/g, "").length <= 220 && (first.match(/\d+/g) || []).length >= 1,
    "首段应≤220字且含关键数据", "把结论+2–3个硬数据放进第一段，细节后置");
  add("② 数据成表/数据密度", hasTable, "表格或高密度数据（≥5个数字+单位）", "面积/租金/企业数做成Markdown表格并注明时点");
  add("③ 小标题问答化", mkq >= 2, `全文问号 ${mkq} 个（建议≥2）`, "用选址者的真实问法做H2/H3，如『网谷租金什么水平？』");
  add("④ 硬数据替代形容词", mk.length <= 1 && digits >= 4, mk.length ? `检出营销词：${mk.join("、")}` : `数字 ${digits} 个`,
    "『环境优美配套完善』改为『聚集企业近460家、聚集度近70%』");
  add("⑤ 关键论断带出处", hasSrc, "未检出『来源：/据XX报道/数据截至』", "政策、榜单、统计注明来源与年份");
  add("⑥ 真实引言", hasQuote, "未检出带职务的人名引言（「」+负责人/总经理等）", "补1条入驻企业负责人原话，带姓名与职务");
  add("⑧ 段落可摘录", longParas === 0, longParas ? `${longParas} 段超过320字` : "段落长度合格", "长段拆为80–200字的独立小段，AI按段摘录");
  add("⑨ 列表与步骤", hasList, "未检出编号列表/要点", "流程用1.2.3.，对比用表格");
  add("⑩ 更新留痕", hasDate, "未检出更新时间", "文末加『更新时间：20XX-XX · 责任人：XX』");
  add("⑫ 禁堆砌与夸饰", repeat <= 6 && sup.length === 0,
    (repeat > 6 ? `『${entity}』出现${repeat}次（堆砌嫌疑）` : "") + (sup.length ? `最高级词：${sup.join("、")}` : "") || "合格",
    "删掉机械重复与无法验证的最高级；对比内容用事实说话");
  add("⑦ 口径唯一（人工）", state.caliber.length > 0, "数字须与口径表逐项核对", "发布前对照『口径表』核对每个数字（此步无法自动完成）");

  /* V0.1.13 ⑪正确性修复（AI评测）：「多源一致」恒判通过把基础分虚高约 8 分（1/12）——
     它是发布后的人工动作，机器无法验证，改为不计分的人工自查提醒，随结果单独展示 */
  const manual = { name: "⑪ 多源一致（人工自查 · 不计分）", why: "同一事实官网/公众号/知乎/百科须一致",
                   fix: "发布后48h内在矩阵渠道同步同口径版本" };

  const score = Math.round(checks.filter(c => c.pass).length / checks.length * 100);
  return { checks, manual, score };
}
let SC_FILL_FOR = null;   /* V0.1.11 内容评分按项目隔离：跨项目切换清空粘贴原文与旧结果（防上个项目的文案/分数残留） */
render.content = () => {
  if (SC_FILL_FOR !== curProjectId()) {
    SC_FILL_FOR = curProjectId();
    const si = $("#scorerInput"); if (si) si.value = "";
    const ss = $("#scorerScore"); if (ss) ss.textContent = "—";
    const sc = $("#scorerChecks"); if (sc) sc.innerHTML = '<p class="muted">等待评分…</p>';
  }
  $("#scorerEntity").innerHTML = `<option value="">园区名（可选，用于堆砌检测）</option>` +
    [...new Set(state.caliber.map(r => r.park))].map(p => `<option>${esc(p)}</option>`).join("");
  $("#briefPark").innerHTML = [...new Set(state.caliber.map(r => r.park))].map(p => `<option>${esc(p)}</option>`).join("") || '<option>（请先在口径表添加园区）</option>';
  $("#writingRules").innerHTML = GEO.rules12.map(r =>
    `<span class="tag" title="${esc(r.std)}">${r.id}. ${esc(r.t)}</span>`).join("");
};
function runScorer() {
  const text = $("#scorerInput").value.trim();
  if (!text) { toast("请先粘贴内容"); return; }
  const entity = $("#scorerEntity").value;
  const { checks, manual, score } = scoreContent(text, entity);
  const color = score >= 75 ? "var(--color-ok)" : score >= 50 ? "var(--color-warn)" : "var(--color-accent)";
  /* V0.1.12（AI评测P1）：标签如实——这是 12 条 GEO 写作规则的规则达标率，不是任何 AI 实测的引用概率 */
  $("#scorerScore").innerHTML = `<span style="color:${color}">${score}</span> <small style="font-size:14px;color:var(--color-ink-3)">/ 100 GEO 规则达标率</small>`;
  $("#scorerChecks").innerHTML = checks.map(c => `
    <div class="chk ${c.pass ? "pass" : "fail"}">
      <span class="ico">${c.pass ? "✓" : "✗"}</span>
      <div><b>${esc(c.name)}</b> ${c.pass ? "" : `<span class="why">${esc(c.why)} → ${esc(c.fix)}</span>`}</div>
    </div>`).join("") +
    `<div class="chk" style="opacity:.75">
      <span class="ico">☞</span>
      <div><b>${esc(manual.name)}</b> <span class="why">${esc(manual.why)} → ${esc(manual.fix)}</span></div>
    </div>`;
}
function gen选题单() {
  const park = $("#briefPark").value || "试点园区";
  const cluster = $("#briefCluster").value;
  const industry = $("#briefIndustry").value.trim() || "数字经济";
  const qs = P_prompts().filter(p => p.cat === cluster);
  const fields = [...new Set(state.caliber.filter(r => r.park.includes(park.slice(0, 4)) || park.includes(r.park.slice(0, 4))).map(r => r.field))];
  const plat = {
    "品牌认知": "官网一园一档 + 微信公众号（元宝）+ 百度百科（文心/基础层）",
    "选址决策": "知乎机构号（Kimi）+ 头条号（豆包/千问）+ 官网FAQ + CSDN（通吃）",
    "对比竞品": "知乎（Kimi）+ 36氪/虎嗅等产业媒体（Kimi偏好）+ 网易/搜狐（通吃）——中立方视角写",
    "产业服务": "公众号（元宝）+ 百家号（文心81.7%百度系）+ 抖音短视频（豆包生活场景）",
  }[cluster];
  const md = `# 内容选题单：${park} · ${cluster}场景
> 生成日期：${today()} · 用途：GEO内容生产工单（配合内容工厂长Agent使用）

## 一、目标
让AI在回答以下问题时提及并引用${park}的真实数据。

## 二、覆盖问题（来自30问矩阵）
${qs.map(q => `- ${q.id} ${q.q}`).join("\n")}

## 三、必需数据（发布前逐项核对口径表）
${(fields.length ? fields : ["园区全称与别称","运营面积/载体参数","入驻企业数","产业聚集度","租金区间","权威背书（榜单/REIT/资质）"]).map(f => `- [ ] ${f}（时点+来源）`).join("\n")}

## 四、结构要求（GEO规范十二条）
1. 首段=直接答案：结论+2–3个硬数据
2. H2/H3用上表问题原文，一节答一问，每节≤300字
3. 至少1条带姓名职务的企业/负责人引言
4. 关键论断带出处；对比类以中立方语气写，用事实与数据
5. 文末：更新时间+责任人；发布后用本系统评分器≥75分再发

## 五、分发阵地（按引擎信源偏好）
${plat}
通用原则：DeepSeek孤证不立——同事实在官网+公众号+≥2家媒体同步发布。

## 六、验收
- [ ] 评分器≥75分
- [ ] 口径表核对通过
- [ ] 双周监测对应问题ID，记录提及变化
`;
  $("#briefOut").textContent = md;
  $("#briefDl").disabled = false;
  $("#briefDl").onclick = () => download(`${park}-${cluster}-内容选题单.md`, md, "text/markdown");
}

/* ══ 5. 监测 ══ */
const ENGINE_LIST = ["豆包","DeepSeek","腾讯元宝","通义千问","文心一言","Kimi","百度AI搜索","秘塔","ChatGPT","Perplexity"];
render.monitor = () => {
  /* V5.1：⑤ 区文案跟档位（轻量版 12 问，不再硬编码"30问"） */
  const nQ = P_prompts().length;
  const bh5 = document.querySelector("#batchH3"), bb = $("#batchRun");
  if (bh5) bh5.textContent = `⑤ 一键跑${nQ}问（信源侧真实搜索）`;   /* 只改 span（V5.1 误用 h3.textContent 抹掉过按钮，已隔离） */
  if (bb) bb.textContent = `跑一轮${nQ}问（真实搜索）`;
  const st = ledgerStats();
  $("#monStats").innerHTML = `
    <div class="card kpi"><div class="kpi-num">${st.mention === null ? "—" : Math.round(st.mention * 100) + "<small>%</small>"}</div><p>平均提及率（答案侧 · 提及=1 / 相似=0.5）<br><span class="muted" style="font-size:11px">n=${st.ansN} 条人工实测${st.aiN ? ` · AI代问 ${st.aiN} 条（另计，不入基线）` : ""}</span></p></div>
    <div class="card kpi"><div class="kpi-num">${st.pos === null || !isFinite(st.pos) ? "—" : Math.round(st.pos * 100) + "<small>%</small>"}</div><p>提及内容平均倾向（1=正面 · 0.5=中性 · 0=负面）</p></div>
    <div class="card kpi"><div class="kpi-num">${st.share === null ? "—" : Math.round(st.share * 100) + "<small>%</small>"}</div><p>引用份额（答案侧被引链接中自有域名占比）</p></div>`;

  /* 类别筛选 chips（随项目矩阵重渲染，保留当前选中） */
  let cat = $("#promptFilter .chip.on")?.dataset.cat || "全部";
  if (cat !== "全部" && !P_cats().includes(cat)) cat = "全部";
  $("#promptFilter").innerHTML = ["全部", ...P_cats()].map(c =>
    `<button class="chip ${c === cat ? "on" : ""}" data-cat="${c}">${c}</button>`).join("");

  $("#promptList").innerHTML = P_prompts()
    .filter(p => cat === "全部" || p.cat === cat)
    .map(p => `<div class="prompt-li"><span class="code">${p.id}</span><span class="cat"><span class="tag">${p.cat}${p.severity >= 5 ? " · 重要度极高" : ""}</span></span>
      <span style="flex:1;min-width:0">${esc(p.q)}</span>
      <button class="btn btn-sm btn-ghost" data-copyq="${esc(p.q)}">复制</button></div>`).join("");
  $$("#promptList [data-copyq]").forEach(b => b.addEventListener("click", () => copyText(b.dataset.copyq)));

  $("#mPrompt").innerHTML = P_prompts().map(p => `<option value="${p.id}">${p.id} · ${esc(p.q)}</option>`).join("");
  $("#mEngine").innerHTML = ENGINE_LIST.map(e => `<option>${e}</option>`).join("");

  /* 图表矩阵（含搜索通道行；台账中出现但不在六引擎内的引擎自动补行，V4.2 修复数据被吞） */
  const heat = heatData();
  const extraEngines = [...new Set(state.ledger.map(r => r.engine))]
    .filter(e => e !== "搜索通道" && !GEO.engines.some(g => g.name === e));
  const HEAT_ROWS = GEO.engines.concat(extraEngines.map(n => ({ name: n })), [{ name: "搜索通道" }]);
  const heatGrid = `<div class="heat" style="grid-template-columns:90px repeat(${GEO.promptCats.length},minmax(56px,1fr))">
    <div class="hcell hhead">引擎\\类别</div>${GEO.promptCats.map(c => `<div class="hcell hhead">${c.slice(0, 2)}</div>`).join("")}
    ${HEAT_ROWS.map(e => `<div class="hcell hhead" style="text-align:left;padding-left:6px${e.name === "搜索通道" ? ";color:var(--color-accent)" : ""}">${e.name}</div>` +
      GEO.promptCats.map(c => {
        const cell = heat[e.name + "|" + c];
        if (!cell.n) return `<div class="hcell" title="${e.name}·${c}：未测">—</div>`;
        const v = Math.round(cell.hit / cell.n * 100);
        const bg = v >= 60 ? "color-mix(in oklab, var(--color-ok) 45%, var(--color-paper))" :
                   v >= 30 ? "color-mix(in oklab, var(--color-warn) 38%, var(--color-paper))" :
                   v > 0  ? "color-mix(in oklab, var(--color-accent) 22%, var(--color-paper))" : "var(--color-paper-3)";
        return `<div class="hcell" style="background:${bg};font-weight:600" title="${e.name}·${c}：${v}%（${cell.n}条）">${v}</div>`;
      }).join("")).join("")}
  </div>`;
  $("#heatBox").innerHTML = `<div class="heat-scroll">${heatGrid}</div>
  <p class="muted" style="margin-top:8px">单元格=该引擎在该问题类别下的平均提及率（%），— 为未测。绿≥60 琥珀30–59 红<30 灰=0。</p>`;

  renderCurve();   /* V4 2.2：GEO 发展曲线（替代旧 trendSvg 混均折线） */

  /* 台账 */
  $("#mTable").innerHTML = state.ledger.length ? `
    <table class="tbl"><thead><tr><th>日期</th><th>引擎</th><th>问题</th><th>提及</th><th>倾向</th><th>竞品同时出现</th><th>引用链接</th><th>备注</th><th></th></tr></thead>
    <tbody>${state.ledger.slice().reverse().map((r, ri) => {
      const id = state.ledger.length - 1 - ri;
      const p = P_prompts().find(x => x.id === r.promptId);
      const isSrc = r.channel === "src" || r.engine === "搜索通道";   /* V4.2：信源行按命中语义展示，不冒充答案侧提及/倾向 */
      return `<tr><td data-col="日期" class="num">${esc(r.date)}</td><td data-col="引擎">${esc(r.engine)}${r.src === "api" ? ' <span class="tag tag-info" title="AI代问自动录入（豆包·联网检索）">AI</span>' : ""}</td>
        <td data-col="问题"><span class="code num" style="color:var(--color-accent);font-family:var(--font-mono);font-size:12px">${r.promptId}</span> ${p ? esc(p.q.slice(0, 18)) + "…" : ""}</td>
        <td data-col="提及">${isSrc ? (+r.mention === 1 ? '<span class="tag tag-ok">自有在榜</span>' : '<span class="tag">未在榜</span>') : (+r.mention === 1 ? '<span class="tag tag-ok">提及</span>' : +r.mention === 0.5 ? '<span class="tag tag-warn">相似</span>' : '<span class="tag tag-bad">未提及</span>')}</td>
        <td data-col="倾向">${isSrc ? "—" : (+r.sentiment === 1 ? "正面" : +r.sentiment === 0.5 ? "中性" : "负面")}</td>
        <td data-col="同时出现" style="max-width:130px;font-size:12px">${r.cooccur && r.cooccur.length ? esc(r.cooccur.join("、")) : "—"}</td>
        <td data-col="引用链接" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--color-info);word-break:break-all">${esc(r.url.slice(0, 30))}</a>` : "—"}</td>
        <td data-col="备注" style="max-width:160px">${esc(r.note || "—")}${r.src === "api" && r.raw ? `
          <details style="margin-top:2px"><summary style="cursor:pointer;color:var(--color-info);font-size:12px">答案全文</summary>
            <div style="white-space:pre-wrap;max-width:420px;max-height:240px;overflow:auto;font-size:12px;background:var(--color-paper-2);padding:6px;border-radius:4px">${esc(r.raw)}</div></details>` : ""}${r.srcTier ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">${r.srcTier.gov ? `<span class="tag tag-ok" title="答案引用里含 .gov.cn 政府一手来源">政府一手 ×${r.srcTier.gov}</span>` : ""}${(r.srcTier.suspect || []).length ? `<span class="tag tag-bad" title="这些域名看着像政府站但不是 .gov.cn——AI 把它们和政府一手源并列引用，引用内容请人工核实：${esc((r.srcTier.suspect || []).join("、"))}">⚠ 疑似仿政府域名 ×${(r.srcTier.suspect || []).length}</span>` : ""}</div>` : ""}</td>
        <td data-col="操作"><button class="btn btn-sm btn-danger" data-mdel="${id}">删</button></td></tr>`;
    }).join("")}</tbody></table>` : `<p class="muted" style="padding:16px 0;text-align:center">暂无记录。点上方「AI 代问」自动录入，或按30问矩阵在各引擎人工提问后录入。</p>`;
  $$("#mTable [data-mdel]").forEach(b => b.addEventListener("click", () => {
    state.ledger.splice(+b.dataset.mdel, 1); save(); render.monitor(); toast("已删除");
  }));

  /* V4：采样卡 + 问题矩阵管理 + 引用诊断（随项目/台账状态刷新） */
  renderSampleCard();
  renderPromptAdmin();
  renderWinCard();
  renderBusiness();
};
function saveRecord() {
  const r = {
    date: $("#mDate").value || today(),
    engine: $("#mEngine").value, promptId: $("#mPrompt").value,
    mention: $("#mMention").value, sentiment: $("#mSentiment").value,
    url: $("#mUrl").value.trim(), note: $("#mNote").value.trim(),
    cooccur: $("#mCooccur").value.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean),   /* V4：竞品同时出现 */
  };
  if (!r.engine) { toast("请选择引擎"); return; }
  /* V0.2.2 F11：同日+同引擎+同问题重复录入防呆——批量导入有去重提示，手工保存此前无任何提示，
     误按两下即产生重复行稀释提及率均值 */
  const dup = state.ledger.some(x => x.date === r.date && x.engine === r.engine && x.promptId === r.promptId);
  if (dup && !confirm("今天已录过同引擎同问题的一条记录。\n\n· 重跑复核 → 确定（两条都保留，统计按两条计）\n· 误触重复 → 取消（不保存）")) return;
  state.ledger.push(r); save(); pushSnapshot("round"); render.monitor(); toast("已保存记录 ✓");
  $("#mUrl").value = ""; $("#mNote").value = ""; $("#mCooccur").value = "";
}
function exportCsv() {
  const head = "日期,引擎,来源,问题ID,问题,提及,倾向,引用链接,竞品同时出现,备注";
  const rows = state.ledger.map(r => {
    const p = P_prompts().find(x => x.id === r.promptId);
    return [r.date, r.engine, r.src === "api" ? "AI代问" : "人工", r.promptId, p ? p.q : "", r.mention, r.sentiment, r.url, (r.cooccur || []).join("、"), r.note]
      .map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",");
  });
  download(`GEO监测台账-${today()}.csv`, "\uFEFF" + [head, ...rows].join("\n"), "text/csv;charset=utf-8");
}

/* ══ V0.1.7 AI 代问：系统替你向豆包提问并自动录入台账（元宝等无公开接口的引擎仍人工）══ */
async function runAnswerBot() {
  const btn = $("#botRun");
  if (!btn || btn.disabled) return;
  const { qs } = pickSample(P_prompts(), state.ledger, SAMPLE_ENGINES);
  if (!qs.length) { toast("问题矩阵为空——先在「管理问题矩阵」添加问题"); return; }
  const stat = $("#botStat");
  const r0 = await API.botStart({
    project: CUR, prompts: qs.map(p => ({ id: p.id, q: p.q })),
    brand: curProject().brand || curProject().name,
    competitors: curProject().competitors || [], ownDomains: curOwnAll(),
  });
  if (r0.error) { toast(r0.error); return; }
  btn.disabled = true;
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const st = await API.botStatus(r0.runId);
    if (st.error) { clearInterval(timer); btn.disabled = false; if (stat) stat.textContent = "进度查询失败（服务可能已重启），请刷新页面重试。"; return; }
    if (st.status === "running" && stat) stat.textContent = `AI 代问中 ${st.done}/${st.total} · 当前：${st.current || "…"}（已 ${Math.round((Date.now() - t0) / 1000)} 秒）`;
    if (st.status !== "running") {
      clearInterval(timer);
      btn.disabled = false;
      const items = st.items || [];
      const okN = items.filter(x => x.ok).length;
      const fail = items.filter(x => !x.ok);
      if (SERVER_MODE) { await loadProjectFromServer(); renderProjectContext(); renderAllViews(); }
      toast(`AI 代问完成：${okN}/${st.total} 问已自动记入台账${fail.length ? `；${fail.length} 问未录：${fail[0].note}` : ""}`);
      const spot = qs.slice(0, 2).map(p => p.id).join("、");
      if (stat) stat.textContent = `本轮自动完成 ${okN}/${st.total}。腾讯元宝暂不能自动——请在元宝 App 里人工抽查 2 题（建议 ${spot}），点对应引擎名录入。`;
    }
  }, 2500);
}

/* ══ V4 1.7 本轮人工采样（≤20分钟采集纪律）══ */
const SAMPLE_ENGINES = ["豆包", "DeepSeek", "腾讯元宝", "通义千问", "文心一言", "Kimi"];
function renderSampleCard() {
  const box = $("#sampleCard"); if (!box) return;
  const { qs, engs } = pickSample(P_prompts(), state.ledger, SAMPLE_ENGINES);
  if (!qs.length) { box.innerHTML = '<p class="muted">问题矩阵为空——先在「管理问题矩阵」添加问题。</p>'; return; }
  const logged = (pid, eng) => state.ledger.some(r => r.date === today() && r.engine === eng && r.promptId === pid);
  let done = 0;
  const rows = qs.map(p => {
    const cells = engs.map(e => {
      const ok = logged(p.id, e); if (ok) done++;
      return `<button class="chip ${ok ? "on" : ""}" data-sample="${p.id}|${e}" title="点击选入②区表单：${e} · ${esc(p.q)}">${ok ? "✓ " : ""}${e}</button>`;
    }).join("");
    return `<div class="prompt-li"><span class="code">${p.id}</span>
      <span class="cat"><span class="tag">${esc(p.cat)} · 重要度${({ 5: "极高", 4: "高", 3: "中", 2: "低", 1: "低" })[p.severity || 3] || "中"}</span></span>
      <span style="flex:1;min-width:0">${esc(p.q)}</span>
      <button class="btn btn-sm btn-ghost" data-copyq2="${esc(p.q)}">复制</button>
      <span style="display:flex;gap:4px;flex-wrap:wrap">${cells}</span></div>`;
  }).join("");
  const manualDates = state.ledger.filter(r => r.engine !== "搜索通道").map(r => r.date).sort();
  const last = manualDates[manualDates.length - 1];
  let stale = "";
  if (!last) stale = "尚无人工起始数据记录——建议本月做一次全量（30问×六引擎）建立答案侧起始数据。";
  else {
    const days = Math.round((Date.now() - new Date(last + "T00:00:00").getTime()) / 86400000);
    if (days > 90) stale = `距上次人工记录（${last}）已 ${days} 天，超过季度线——建议本季度补一次全量起始数据。`;
  }
  const total = qs.length * engs.length;
  box.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px">
      <button class="btn btn-sm btn-primary" id="botRun">▶ AI 代问（豆包·自动录入）</button>
      <span class="muted" id="botStat" style="font-size:12px;flex:1;min-width:220px">系统替你向豆包逐条提问（联网检索），自动记入台账并打「AI」标，约 1–3 分钟；腾讯元宝暂不能自动，仍需人工。</span>
    </div>
    <p class="muted" style="margin-top:0">本轮只测 <b class="num">${qs.length}</b> 个高严重度问题 × <b class="num">${engs.length}</b> 个引擎（${engs.join("、")}，人工覆盖最少的引擎优先轮换）＝ <b class="num">${total}</b> 条，今日已录 <b class="num" style="color:${done >= total ? "var(--color-ok)" : "var(--color-accent)"}">${done}/${total}</b>。每条动作用：复制问题 → 去引擎提问 → 点对应引擎名自动选入②区 → 保存。全量 30×6 留给季度起始数据。</p>
    ${stale ? `<p style="font-size:var(--text-sm);color:var(--color-warn);margin-top:4px">⚠ ${stale}</p>` : ""}
    ${rows}`;
  const botBtn = $("#botRun");
  if (botBtn) botBtn.addEventListener("click", runAnswerBot);
  /* 未配置通道时给管理员一个就地入口；已配置则不打扰 */
  if (SERVER_MODE) API.botConfig().then(c => {
    const stat = $("#botStat");
    if (!stat || c.configured) return;
    stat.innerHTML = '还没连接豆包账号：点「<a href="javascript:void(0)" id="botCfg" style="color:var(--color-info);text-decoration:underline">通道设置</a>」按提示填 Key（约 1 分钟）即可启用；暂不配置就先用右侧人工录入——两边数据分开记。';
    const cfgLink = $("#botCfg");
    if (cfgLink) cfgLink.addEventListener("click", async () => {
      const key = prompt("粘贴火山方舟 API Key（只存服务器，任何界面只显示尾 4 位）：");
      if (!key || !key.trim()) return;
      const model = prompt("模型或联网接入点 ID：", c.model || "doubao-seed-1-6-250615");
      const r = await API.botSaveConfig({ apiKey: key.trim(), model: (model || "").trim() });
      if (r.configured) { toast("豆包通道已配置 ✓ 现在可点「AI 代问」"); renderSampleCard(); }
      else toast("保存失败，请重试");
    });
  }).catch(() => {});
  $$("#sampleCard [data-copyq2]").forEach(b => b.addEventListener("click", () => copyText(b.dataset.copyq2)));
  $$("#sampleCard [data-sample]").forEach(b => b.addEventListener("click", () => {
    const [pid, eng] = b.dataset.sample.split("|");
    $("#mEngine").value = eng; $("#mPrompt").value = pid; $("#mDate").value = today();
    $("#mEngine").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" });
    toast(`已选 ${eng} · ${pid}，填提及/倾向后点「保存记录」`);
  }));
}

/* ══ V4 1.3 问题矩阵管理（编辑/增删/严重度/批量替换）══ */
function renderPromptAdmin() {
  const box = $("#promptAdmin"); if (!box || box.hidden) return;
  const ps = P_prompts();
  box.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
      <button class="btn btn-sm btn-ghost" id="paAdd">＋ 添加问题</button>
      <button class="btn btn-sm btn-ghost" id="paReplace">批量替换（换园区/城市名）</button>
      <button class="btn btn-sm btn-ghost" id="paSev">公式打分（四问定严重度）</button>
      <span class="muted" style="font-size:12px">共 ${ps.length} 问 · 修改即保存。新项目先「批量替换」把问题里的园区/城市换成自己的。</span>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>类别</th><th>问题</th><th>严重度</th><th></th></tr></thead><tbody>
    ${ps.map((p, i) => `<tr>
      <td class="num">${esc(p.id)}</td>
      <td><select class="sel" data-pacat="${i}" style="min-width:92px">${GEO.promptCats.map(c => `<option${c === p.cat ? " selected" : ""}>${c}</option>`).join("")}</select></td>
      <td><input class="inp" data-paq="${i}" value="${esc(p.q)}" style="width:100%;min-width:220px"></td>
      <td><select class="sel" data-pasev="${i}" style="min-width:64px">${[5, 4, 3, 2, 1].map(v => `<option${v == (p.severity || 3) ? " selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><button class="btn btn-sm btn-danger" data-padel="${i}">删</button></td></tr>`).join("")}
    </tbody></table></div>`;
  const upd = () => { save(); };
  $$("#promptAdmin [data-paq]").forEach(inp => inp.addEventListener("change", () => {
    P_prompts()[+inp.dataset.paq].q = inp.value.trim(); upd(); toast("问题已保存");
  }));
  $$("#promptAdmin [data-pacat]").forEach(sl => sl.addEventListener("change", () => {
    P_prompts()[+sl.dataset.pacat].cat = sl.value; upd(); render.monitor();
  }));
  $$("#promptAdmin [data-pasev]").forEach(sl => sl.addEventListener("change", () => {
    P_prompts()[+sl.dataset.pasev].severity = +sl.value; upd(); render.monitor();
  }));
  $$("#promptAdmin [data-padel]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.padel;
    if (!confirm(`删除问题 ${P_prompts()[i].id}？台账中该问题的历史记录会保留，但不再显示问题文本。`)) return;
    P_prompts().splice(i, 1); upd(); render.monitor();
  }));
  $("#paAdd").addEventListener("click", () => {
    const nums = P_prompts().map(p => +String(p.id).replace(/\D/g, "") || 0);
    P_prompts().push({ id: "P" + (Math.max(0, ...nums) + 1), cat: P_cats()[0] || "品牌认知", q: "", severity: 3 });
    upd(); renderPromptAdmin(); render.monitor();
  });
  const sevBtn = $("#paSev");
  if (sevBtn) sevBtn.addEventListener("click", () => {
    const id = $("#paSevId") ? $("#paSevId").value.trim() : "";
    openSevDialog(id);
  });
  function openSevDialog(presetId) {
    formDialog("公式打分：要打分的问题ID（如 P20）", [{ id: "pid", label: "问题ID", value: presetId, placeholder: "P20" }], v => {
      const id = v.pid;
      const p = P_prompts().find(x => x.id === id);
      if (!p) { toast("未找到该问题"); return; }
      sevPromptAssistant(sev => {
        p.severity = sev; save(); renderPromptAdmin(); render.monitor();
        toast(`${id} 严重度已按公式设为 ${sev}`);
      });
    }, "下一步");
  }
  $("#paReplace").addEventListener("click", () => {
    const defTo = curProject().brand || curProject().name || "";
    formDialog("批量替换矩阵问题文案（换园区/城市名）", [
      { id: "from", label: "把问题中的文字「从」", value: "蛇口网谷" },
      { id: "to", label: "替换「为」（你的园区名/城市名）", value: defTo !== "蛇口网谷" ? defTo : "", placeholder: "如：南京金融城" },
    ], v => {
      if (!v.from || !v.to || v.from === v.to) { toast("请填写替换前后的文字"); return; }
      let n = 0;
      P_prompts().forEach(p => { if (p.q.includes(v.from)) { p.q = p.q.split(v.from).join(v.to); n++; } });
      if (n) { save(); renderPromptAdmin(); render.monitor(); }
      toast(`已替换 ${n} 个问题`);
    }, "执行替换");
  });
}

/* ══ V4 1.6 批量粘贴录入 ══ */
let BATCH_PARSED = null;
function openBatchModal() {
  $("#batchModal").hidden = false; $("#bpPreview").innerHTML = "";
  $("#bpImport").disabled = true; $("#bpImport").textContent = "导入";
  BATCH_PARSED = null; $("#batchTa").focus();
}
function bpPreview() {
  const { rows, bad } = parseBatchRows($("#batchTa").value);
  const seen = new Set(state.ledger.map(r => r.date + "|" + r.engine + "|" + r.promptId));
  const fresh = rows.filter(r => !seen.has(r.date + "|" + r.engine + "|" + r.promptId));
  const dup = rows.length - fresh.length;
  BATCH_PARSED = fresh;
  $("#bpPreview").innerHTML = (rows.length || bad.length) ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>引擎</th><th>问题</th><th>提及</th><th>倾向</th><th>竞品同时出现</th></tr></thead><tbody>` +
    fresh.slice(0, 20).map(r => `<tr><td class="num">${r.date}</td><td>${esc(r.engine)}</td><td class="num">${r.promptId}</td>
      <td>${r.mention === 1 ? "提及" : r.mention === 0.5 ? "相似" : "未提及"}</td>
      <td>${r.sentiment === 1 ? "正面" : r.sentiment === 0.5 ? "中性" : "负面"}</td>
      <td>${esc((r.cooccur || []).join("、"))}</td></tr>`).join("") +
    (fresh.length > 20 ? `<tr><td colspan="6" class="muted">…其余 ${fresh.length - 20} 条略</td></tr>` : "") +
    (dup ? `<tr><td colspan="6" style="color:var(--color-warn)">跳过 ${dup} 条重复（同日+同引擎+同问题已在台账）</td></tr>` : "") +
    (bad.length ? `<tr><td colspan="6" style="color:var(--color-bad)">无法解析 ${bad.length} 行：${bad.slice(0, 3).join("；")}${bad.length > 3 ? " 等" : ""}</td></tr>` : "") +
    `</tbody></table></div>` : '<p class="muted">未解析到有效行——检查列顺序与问题ID。</p>';
  $("#bpImport").disabled = !fresh.length;
  $("#bpImport").textContent = fresh.length ? `导入 ${fresh.length} 条` : "导入";
}
function bpImportRows() {
  if (!BATCH_PARSED || !BATCH_PARSED.length) return;
  BATCH_PARSED.forEach(r => state.ledger.push(r));
  save(); pushSnapshot("round"); render.monitor(); render.dashboard();
  $("#batchModal").hidden = true; $("#batchTa").value = ""; BATCH_PARSED = null;
  toast("批量导入完成 ✓");
}

/* ══ 6. 行动（90天方案）══ */
const BATTLEFIELDS = [
  ["官网自有渠道", "一园一档页+FAQ+产业研究栏目，双周更新；技术整改（robots/WAF/HTTPS）"],
  ["知识实体阵地", "百度百科/企查查/应用商店基础层与官网口径完全一致"],
  ["产业内容阵地", "知乎机构号选址方法论长文、园区测评、产业分析，月更4–6篇"],
  ["生态矩阵阵地", "公众号（元宝）/头条（豆包千问）/百家号（文心）/CSDN（通吃）/抖音（豆包生活场景）"],
];
render.plan = () => {
  /* V4.2 参数化：plan 页面园区名默认值跟随当前项目 */
  const cur = curProject();
  const want = ((cur.brand || cur.name || "") + "").split("（")[0].trim();
  if ($("#pName").dataset.proj !== CUR) {
    $("#pName").value = want;
    $("#pName").dataset.proj = CUR;
  }
  $("#pAssets").innerHTML = [["REIT披露数据","reit"],["50强榜单","rank"],["国家级资质","qual"],["企业引言库","quote"],["公众号阵地","wechat"],["知乎机构号","zhihu"]]
    .map(([t, v]) => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${v}" ${state.planInputs.assets && state.planInputs.assets.includes(v) ? "checked" : ""} style="margin-right:4px">${t}</label>`).join("");
  $("#battleBox").innerHTML = BATTLEFIELDS.map((b, i) => {
    const done = !!state.battlefield[i];
    return `<li class="${done ? "done" : ""}" style="cursor:pointer" data-bf="${i}">
      <b>${b[0]}</b>：${b[1]} ${done ? '<span class="tag tag-ok">已布</span>' : '<span class="tag">未布</span>'}</li>`;
  }).join("");
  $$("#battleBox [data-bf]").forEach(li => li.addEventListener("click", () => {
    const i = +li.dataset.bf;
    state.battlefield[i] = !state.battlefield[i]; save(); render.plan();
  }));
  const done = Object.values(state.battlefield).filter(Boolean).length;
  $("#battleBar").innerHTML = `渠道铺设进度：<b class="num">${done}/4</b> <span class="muted">（点击条目切换状态）</span>`;
};
function genPlan() {
  const f = {
    name: $("#pName").value.trim() || "试点园区", city: $("#pCity").value.trim() || "深圳",
    type: $("#pType").value, industry: $("#pIndustry").value.trim() || "数智科技",
    budget: $("#pBudget").value, cycle: $("#pCycle").value,
    assets: $$("#pAssets input:checked").map(i => i.value),
  };
  state.planInputs = { ...state.planInputs, ...f, assets: f.assets }; save();
  const gaps = auditDims().filter(d => d.pct < 50).map(d => `- ${d.dim}（${d.pct}分）：优先补齐`).join("\n") || "-（体检未完成或均已≥50分，先完成体检可得针对性差距）";
  /* V4.2 参数化：冲突字段/园区名/城市全部取自当前项目，蛇口网谷专属文案不再进入其他项目的方案 */
  const confFields = state.caliber.filter(r => (r.conflicts || []).length).map(r => r.field);
  const confAct = confFields.length
    ? `口径表V1（先攻${f.name}：${confFields.slice(0, 3).join("/")}等${confFields.length}个冲突字段）`
    : "口径表V1（先厘清入驻企业数/面积/聚集度等核心字段，带时点与来源）";
  const ctx = projCtx();
  const md = `# ${f.name} GEO ${f.cycle}行动方案
> 生成：GEO智控台V4.2 · ${today()} · 框架：1-2-6-4-5（一个中心·双通道·六引擎·四战场·五步法）

## 0. 园区卡片
- 园区：${f.name}（${f.type}）· ${f.city}
- 主导产业：${f.industry}
- 资源档位：${f.budget}
- 已具备资产：${f.assets.length ? f.assets.join("、") : "暂无（第一批补建）"}

## 1. 现状差距（来自${auditN()}项体检）
${gaps}

## 2. 目标（北极星指标）
- 六引擎品牌词平均提及率（起始数据→${f.cycle === "90天冲刺" ? "+30pct" : "+40pct"}）
- 引用份额：自有可控来源占比 ≥ 30%
- 线索：AI渠道可归因咨询 ≥ 每月N条（以起始数据校准）

## 3. ${f.cycle}路线图
${GEO.roadmap.map(r => `### ${r.phase}（${r.weeks}）
${r.acts.map(a => a
    .replace("{conflictFields}", confAct)
    .replace("{园区}", f.name)
    .replace("{city}", f.city)
    .replace("{industry}", f.industry)).map(a => `- ${a}`).join("\n")}
**里程碑：** ${r.milestone}`).join("\n\n")}

## 4. 六引擎布源要点（2026-08/09口径）
${GEO.engines.map(e => `- **${e.name}**（${e.corp}）：${e.prefer} → ${e.tactic}`).join("\n")}
- 通吃平台：${GEO.universalPlatforms.join("、")}
- 基础层（AI交叉对照）：${GEO.baseLayers.join("、")}

## 5. 内容工厂排期
- 第1批：一园一档（数据全部对照口径表）+ FAQ 20问
- 第2批：选址指南《${f.city}${f.industry}企业选址怎么选》+ 对比文（当前最空白、转化价值最高）
- 第3批：资产素材化（权威背书：榜单/资质/REIT披露等 → 可引用结构化内容）
- 节奏：${f.budget.startsWith("轻量") ? "每周2篇（1深度+1分发）" : f.budget.startsWith("标准") ? "每周3–4篇（2深度+2分发）" : "每周5篇+视频（3深度+2分发+1抖音）"}

## 6. 组织与KPI
- ${ctx.operatorShort}统筹：口径表唯一权威、Prompt矩阵、双周监测看板
- 园区运营团队：本地信源与线索承接；园区专员：一园一档与引言采集
- 双周例会看监测台账，季度复盘更新口径表

## 7. 风险与合规
- 效果数字均为行业参考区间，以自建起始数据为准；涉REIT/政策/荣誉表述走品牌与法务审核
- 拒绝刷引用/伪权威灰产；2026年3·15后各引擎整顿铺量发稿，质量>数量
`;
  $("#planPreview").textContent = md;
  $("#planDl").disabled = false;
  $("#planDl").onclick = () => download(`${f.name}-GEO行动方案.md`, md, "text/markdown");
}

/* ══ 7. Agent ══ */
render.agents = () => {
  $("#agentGrid").innerHTML = GEO.agents.map(a => `
    <div class="card agent-card">
      <h4>${esc(a.name)} <span class="tag tag-accent">${a.tag}</span></h4>
      <p>${esc(a.desc)}</p>
      <button class="btn btn-primary btn-sm" data-agent="${a.id}">查看提示词</button>
    </div>`).join("");
  $$("#agentGrid [data-agent]").forEach(b => b.addEventListener("click", () => {
    const a = GEO.agents.find(x => x.id === b.dataset.agent);
    const promptTxt = seedLocalize(a.prompt);   /* V5：非种子项目注入本项目背景 */
    $("#agentDetail").hidden = false;
    $("#agentTitle").textContent = a.name;
    $("#agentPrompt").textContent = promptTxt;
    $("#agentCopy").onclick = () => copyText(promptTxt);
    $("#agentDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
};

/* ══ 8. 知识库 ══ */
render.knowledge = () => {
  $("#kpiCards").innerHTML = `
    <div class="card kpi"><div class="kpi-num">97.7%</div><p>豆包对抖音的引用率（目的地/攻略场景）——视频已成分发刚需 [2]</p></div>
    <div class="card kpi"><div class="kpi-num">4–5个</div><p>DeepSeek精读信源数量（2026-05起，从10–15个压缩）——孤证不立 [2]</p></div>
    <div class="card kpi"><div class="kpi-num">81.7%</div><p>文心一言对百度系内容的引用率——百家号+百科必布 [2]</p></div>
    <div class="card kpi"><div class="kpi-num">+40%</div><p>普林斯顿论文验证的五策略叠加可见性提升 [1]</p></div>`;
  $("#pipeBox").innerHTML = GEO.pipeline.map(p => `
    <li><span class="step-no">${GEO.pipeline.indexOf(p) + 1}</span><b>${p.s}</b>：${esc(p.d)}<br>
    <span class="muted" style="margin-left:28px">→ 园区动作：${esc(p.act)}</span></li>`).join("");
  $("#engineMatrix").innerHTML = `<table class="tbl"><thead><tr><th>引擎</th><th>信源偏好（实测口径）</th><th>2026规则变化</th><th>园区打法</th></tr></thead>
    <tbody>${GEO.engines.map(e => `<tr><td><b>${e.name}</b><br><span class="muted num">${e.corp}</span></td>
      <td>${esc(e.prefer)}</td><td>${esc(e.rule2026)}</td><td>${esc(e.tactic)} <span class="muted num">[${e.src}]</span></td></tr>`).join("")}
    <tr><td><b>通吃平台</b></td><td colspan="3">${GEO.universalPlatforms.join("、")}——六引擎均有一定引用量，起步期优先铺设 [3]</td></tr>
    <tr><td><b>基础层</b></td><td colspan="3">${GEO.baseLayers.join("、")}——AI回答基础内容层，会与正文交叉对照，数据必须与口径表一致 [3]</td></tr>
    </tbody></table>`;
  $("#paperTactics").innerHTML = `<table class="tbl"><thead><tr><th>策略</th><th>结论</th><th>幅度</th><th>做法</th></tr></thead>
    <tbody>${GEO.tactics.map(t => `<tr><td>${t.t}</td><td><span class="tag ${t.v === "有效" ? "tag-ok" : "tag-bad"}">${t.v}</span></td><td class="num">${t.lift}</td><td>${esc(t.d)}</td></tr>`).join("")}</tbody></table>
    <p class="muted" style="margin-top:8px">${esc(GEO.tacticsNote)}</p>`;
  $("#metricsTable").innerHTML = `<table class="tbl"><thead><tr><th>指标</th><th>定义</th><th>用途</th></tr></thead>
    <tbody>${GEO.metrics.map(m => `<tr><td><b>${esc(m.t)}</b></td><td>${esc(m.d)}</td><td>${esc(m.u)}</td></tr>`).join("")}</tbody></table>`;
  $("#techTable").innerHTML = `<table class="tbl"><thead><tr><th>事项</th><th>2026判决</th><th>优先级</th></tr></thead>
    <tbody>${GEO.techConsensus.map(t => `<tr><td><b>${t.t}</b></td><td>${esc(t.d)}</td><td><span class="tag ${t.lv === "必须" ? "tag-bad" : t.lv === "核心" ? "tag-accent" : "tag"}">${t.lv}</span></td></tr>`).join("")}</tbody></table>`;
  $("#caseTable").innerHTML = `<table class="tbl"><thead><tr><th>案例</th><th>关键数据</th><th>做法</th></tr></thead>
    <tbody>${GEO.cases.map(c => `<tr><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.sector)}</span></td><td>${esc(c.data)}</td><td>${esc(c.how)}<br><span class="muted num">${esc(c.src)}</span></td></tr>`).join("")}</tbody></table>`;
  $("#srcList").innerHTML = GEO.sources.map((s, i) => `<li><span class="num" style="color:var(--color-ink-3)">[${i + 1}]</span> ${esc(s)}</li>`).join("");
};

/* ── 绑定 ─────────────────────────────────── */
function bind() {
  $$(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.view)));
  $$("[data-goto]").forEach(b => b.addEventListener("click", () => go(b.dataset.goto)));
  $$("[data-subnav]").forEach(nav => $$("button", nav).forEach(b => b.addEventListener("click", () => {
    const stage = nav.dataset.subnav;
    location.hash = "#/" + stage + "/" + b.dataset.sub;
  })));
  $("#probeRun").addEventListener("click", runProbe);

  /* V6.1 操作指引常驻入口：顶栏「?」与知识库卡片 → 重放南山大厦带看 */
  const btnHelp = $("#btnHelp"); if (btnHelp) btnHelp.addEventListener("click", () => Tour.start({}));
  const btnHelp2 = $("#btnHelp2"); if (btnHelp2) btnHelp2.addEventListener("click", () => Tour.start({}));

  /* V4 项目层：报头身份块 → 项目总览；总览卡片 → 进入项目 / 新建 */
  $("#projChip").addEventListener("click", () => go("projects"));
  $("#projGrid").addEventListener("click", e => {
    if (e.target.closest(".proj-add")) { $("#projModal").hidden = false; $("#npName").focus(); return; }
    const card = e.target.closest(".proj-card");
    if (card && card.dataset.pid) switchProject(card.dataset.pid);
  });
  $("#npCancel").addEventListener("click", closeProjModal);   /* V0.1.12 BUG#2：取消即清空草稿 */
  $("#npSubmit").addEventListener("click", submitNewProject);
  bindModalKeyboard();   /* V0.1.12 BUG#3：弹窗 ESC 关闭 + Tab 焦点圈定 */
  /* V5 项目设置弹窗 */
  $("#peCancel").addEventListener("click", () => { $("#projEditModal").hidden = true; });
  $("#peSave").addEventListener("click", saveProjEdit);
  $("#peRebuild").addEventListener("click", rebuildPromptsByTier);
  $("#npName").addEventListener("keydown", e => { if (e.key === "Enter") submitNewProject(); });

  /* V4.6 项目库工具栏：新建按钮 / 搜索（防抖）/ 形态与状态 chips（委托）/ 排序 / 含归档开关 */
  const pjNew = $("#pjNew"); if (pjNew) pjNew.addEventListener("click", () => { $("#projModal").hidden = false; $("#npName").focus(); });
  const pjWNew = $("#pjWelcomeNew"); if (pjWNew) pjWNew.addEventListener("click", () => { $("#projModal").hidden = false; $("#npName").focus(); });   /* V4.7 欢迎页新建 */
  const pjWClose = $("#pjWelcomeClose"); if (pjWClose) pjWClose.addEventListener("click", () => {   /* V4.7 欢迎页关闭=记访问，不再打扰 */
    try { localStorage.setItem("geodesk.visited", "1"); } catch (e) {}
    $("#pjWelcome").hidden = true; toast("已收起——想再看可清除浏览器本站数据后刷新");
  });
  const pjQ = $("#pjQ");
  if (pjQ) { let pjT; pjQ.addEventListener("input", () => { clearTimeout(pjT); pjT = setTimeout(() => { PJ_FILTERS.q = pjQ.value; renderProjectCards(SERVER_MODE && !!SERVER_SUM); }, 180); }); }
  const pjChips = $("#pjChips");
  if (pjChips) pjChips.addEventListener("click", e => {
    const fm = e.target.closest("[data-fm]"), fs = e.target.closest("[data-fs]");
    if (fm) PJ_FILTERS.mode = fm.dataset.fm;
    else if (fs) PJ_FILTERS.status = fs.dataset.fs;
    else return;
    renderProjToolbar();
    renderProjectCards(SERVER_MODE && !!SERVER_SUM);
  });
  const pjSort = $("#pjSort"); if (pjSort) pjSort.addEventListener("change", () => { PJ_FILTERS.sort = pjSort.value; renderProjectCards(SERVER_MODE && !!SERVER_SUM); });
  const pjArch = $("#pjArch"); if (pjArch) pjArch.addEventListener("change", () => { PJ_FILTERS.archived = pjArch.checked; renderArchived(); });

  /* V4 1b：矩阵管理 / 批量粘贴 / 采样 */
  $("#paToggle").addEventListener("click", () => {
    const pa = $("#promptAdmin");
    pa.hidden = !pa.hidden;
    if (!pa.hidden) renderPromptAdmin();
    $("#paToggle").textContent = pa.hidden ? "管理问题矩阵" : "收起管理";
  });
  $("#batchPasteBtn").addEventListener("click", openBatchModal);
  $("#bpCancel").addEventListener("click", () => { $("#batchModal").hidden = true; });
  $("#bpPreviewBtn").addEventListener("click", bpPreview);
  $("#bpImport").addEventListener("click", bpImportRows);
  $("#restoreFile").addEventListener("change", e => { doRestore(e.target.files[0]); e.target.value = ""; });
  /* V4 三期 */
  $("#parseBtn").addEventListener("click", openParseModal);
  $("#pmClose").addEventListener("click", () => { $("#parseModal").hidden = true; });
  $("#pmRun").addEventListener("click", runParseFill);

  $("#auditExport").addEventListener("click", () => {
    const s = auditScore(), dims = auditDims();
    const md = `# 园区GEO体检报告
> 导出：${today()} · GEO智控台V4.2 · 总分 ${s.got}/${s.full}（${s.pct}分）
${GEO.audit.map(d => {
  const dd = dims.find(x => x.dim === d.dim);
  return `\n## ${d.dim}（${dd.got}/${dd.full}）\n${d.items.map(i => `- [${state.audit[i.id] === 2 ? "✓✓" : state.audit[i.id] === 1 ? "✓" : "✗"}] ${i.id} ${i.t}：${i.std}`).join("\n")}`;
}).join("")}
`;
    download(`园区GEO体检报告-${today()}.md`, md, "text/markdown");
  });
  $("#auditReset").addEventListener("click", () => {
    /* V0.2.2 F8：清空重评一并清「自动填入」痕——否则体检表仍满标「自动」，且下次诊断会静默重填旧值 */
    if (confirm(`清空全部${auditN()}项打分？`)) { state.audit = defaultState().audit; state.autoAudit = {}; save(); render.audit(); toast("已清空"); }
  });
  $("#scorerRun").addEventListener("click", runScorer);
  $("#briefGen").addEventListener("click", gen选题单);
  $("#calAdd").addEventListener("click", () => {
    state.caliber.push({ park: "", field: "", official: "", asOf: today(), source: "", conflicts: [] });
    save(); render.caliber();
  });
  $("#calExport").addEventListener("click", () => download(`口径表-${today()}.json`, JSON.stringify(state.caliber, null, 2), "application/json"));
  $("#mSave").addEventListener("click", saveRecord);
  $("#mExport").addEventListener("click", exportCsv);
  $("#mClear").addEventListener("click", () => {
    if (confirm("清空全部监测记录？")) { state.ledger = []; save(); render.monitor(); toast("已清空"); }
  });
  $$("#promptFilter").forEach(() => {});
  $("#promptFilter").addEventListener("click", e => {   /* 事件委托：chips 随项目重渲染，绑定只做一次 */
    const ch = e.target.closest(".chip"); if (!ch) return;
    $$("#promptFilter .chip").forEach(x => x.classList.remove("on"));
    ch.classList.add("on"); render.monitor();
  });
  $("#pRun").addEventListener("click", genPlan);
  $("#stateExport").addEventListener("click", () => download(`GEO智控台-${(curProject().name || "项目")}-数据-${today()}.json`, JSON.stringify(state, null, 2), "application/json"));
  $("#stateImport").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = "";
    /* V4.7.3 导入=整包替换当前项目数据，必须二次确认（误选文件的代价是当天录入全部被覆盖） */
    if (!confirm(`导入会用这份文件替换当前项目「${curProject().name || "未命名"}」的全部数据（体检/口径表/台账/曲线/工单），且无法撤销。\n\n通常只有一种情况需要导入：恢复自己之前导出的备份。确定继续？`)) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { state = Object.assign(defaultState(), JSON.parse(rd.result)); save(); route(); toast("导入成功 ✓（当前项目数据已被这份文件替换）"); }
      catch (err) { toast("导入失败：文件格式错误"); }
    };
    rd.readAsText(f);
  });
  $("#mDate").value = today();
  /* V0.2.2 F4：卸载/切后台 flush 防抖保存（pagehide 覆盖刷新/关闭/跳转；visibilitychange 覆盖切标签页与移动端切后台） */
  window.addEventListener("pagehide", () => { serverSaveFlush(true); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") serverSaveFlush(true); });
}

initProjects();   /* V4：模块级装载项目层（置于文件末尾：此时 save/API 等常量均已定义，migrateProbes 可安全调用；node harness 亦适用） */

document.addEventListener("DOMContentLoaded", async () => {
  renderProjectContext();        /* V4：项目层已在模块级装载（initProjects，含名字归一） */
  bind();
  render.dashboard(); render.caliber(); render.audit(); render.content(); render.plan(); render.agents(); render.knowledge(); render.projects();
  $("#mDate").value = today();
  await initServerMode();      /* 检测到后台时切换服务器模式并预取共享数据 */
  updateServerBadge();         /* V4.2：页脚显示服务端版本——代码更新未重启服务器时可立刻发现 */
  window.addEventListener("hashchange", route);
  route();
  /* V0.1.13 跨项目串页金标准自检通道（?spacheck=1）：在真实浏览器里执行
     「旧项目诊断渲染 → switchProject 切新项目 → 全页扫描旧品牌词」与
     「演示态渲染南山大厦 → tourEnd 退出 → 扫描演示品牌」，裁决写 #spacheckOut 供 e2e dump 断言。
     e2e/无头无法复现 SPA 切换路径（0.1.11 前的串值 bug 全是刷新即消失的内存态）——本通道即为其金标准 */
  if (new URLSearchParams(location.search).get("spacheck") === "1") {
    await spaSelfCheck();
  } else if (typeof Tour !== "undefined" && typeof Tour.autoStart === "function") {
    /* V6.1 首登操作指引：账号级一次性判定后自动弹出（tour.js 已在本脚本之后装载完成） */
    setTimeout(() => Tour.autoStart(), 700);
  }
});
async function spaSelfCheck() {
  const el = document.createElement("div"); el.id = "spacheckOut"; el.hidden = true; document.body.appendChild(el);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const OLD = "金标旧项目词";
  try {
    /* ① 当前项目注入一次诊断结果（仅内存/本机，不写服务器），到诊断页渲染出来 */
    state.lastDiag = { ts: "2026-09-06 00:00", url: "old.example.com", brand: OLD, mode: "entity",
      checks: [{ id: "E2a", name: "品牌词搜索·自有渠道", status: "fail", evidence: "搜索「" + OLD + "」前10全部为第三方", score: {} }],
      autoFilled: 1, autoKept: 0 };
    state.diagHistory = [JSON.parse(JSON.stringify(state.lastDiag))];
    location.hash = "#/diag/scan"; route(); await wait(150);
    const rendered = !!$("#dgOut .dg-head") && $("#dgOut").textContent.includes(OLD);
    /* ② 真实 switchProject 切到全新本地项目（含 #dgOut 清空→renderAllViews 全链路），再回诊断页 */
    const np = { id: "p_spacheck", name: "切换检查项目", url: "", brand: "切换检查新词", entityMode: "none", createdAt: today() };
    if (!PROJECTS.some(p => p.id === np.id)) PROJECTS.push(np);
    await switchProject(np.id);            /* 末尾 go("dashboard") */
    location.hash = "#/diag/scan"; route(); await wait(150);
    const dgNow = $("#dgOut");
    const dgLeak = !!(dgNow && ($("#dgOut .dg-head") || dgNow.textContent.includes(OLD)));
    const pageLeak = (document.body.innerText || "").includes(OLD);   /* 可见文本全页扫描（innerText 不含隐藏节点） */
    el.dataset.switch = !rendered ? "SKIP:no-prerender" : (dgLeak || pageLeak) ? "FAIL:leak" : "PASS";
    el.dataset.switchNote = "rendered=" + rendered + " dgLeak=" + dgLeak + " pageLeak=" + pageLeak;
    /* ③ 演示态：进引导第6步（体检示例渲染南山大厦）→ tourEnd 退出 → 诊断页/渠道图不得残留 */
    let tourLeak = "SKIP";
    if (typeof Tour !== "undefined") {
      Tour.start({ step: 5 }); await wait(500);
      const inDemo = (document.body.innerText || "").includes("南山大厦");
      tourEnd(true, "spacheck"); await wait(250);
      location.hash = "#/diag/scan"; route(); await wait(150);
      const tDg = !!($("#dgOut") && $("#dgOut").textContent.includes("南山大厦"));
      location.hash = "#/act/toolkit"; route(); await wait(150);
      const tCh = !!($("#channelBox") && $("#channelBox").textContent.includes("南山大厦"));
      tourLeak = !inDemo ? "SKIP:no-demo" : (tDg || tCh) ? "FAIL:leak" : "PASS";
      el.dataset.tourNote = "inDemo=" + inDemo + " diagLeak=" + tDg + " channelLeak=" + tCh;
    }
    el.dataset.tour = tourLeak;
  } catch (e) {
    el.dataset.switch = el.dataset.switch || "ERR";
    el.dataset.err = String(e && e.message || e).slice(0, 120);
  }
}
/* V4.2：页脚服务端状态徽标（服务器模式显示版本号；本地双击打开显示本地模式） */
async function updateServerBadge() {
  const el = $("#srvState"); if (!el) return;
  /* V4.7.3 页脚导出/导入=本地模式专属（手动备份/搬家）；服务器模式数据有每日自动备份，
     这两个按钮对品宣是噪音且有误覆盖风险——隐藏，恢复交给「备份与恢复」管理员通道 */
  const se = $("#stateExport"), si = $("#stateImportWrap");
  const av = $("#appVer");
  if (!SERVER_MODE) {
    el.textContent = "本地模式（数据存浏览器）";
    if (av) av.textContent = "0.2.4";   /* 本地模式无后端可询，读前端内置版本（与 server APP_VERSION 同步维护） */
    if (se) se.hidden = false; if (si) si.hidden = false;
    return;
  }
  if (se) se.hidden = true; if (si) si.hidden = true;
  try {
    const r = await fetch("/api/ping", { signal: AbortSignal.timeout(1500) });
    const d = await r.json();
    if (av) av.textContent = d.version || "?";
    el.textContent = "服务器已连接 · v" + (d.version || "?") + (document.documentElement.dataset.jsv && document.documentElement.dataset.jsv !== d.version ? "（前端与版本不一致，请刷新/重启服务器）" : "");
  } catch (e) { el.textContent = "服务器连接异常"; }
}

/* ═══ V6.2.1 布局自检（?layoutcheck=1 调试通道，e2e 回归横向溢出用；正常访问零开销）═══
   背景：.tag 曾因 nowrap+body overflow-x:clip 把超长标签在屏幕边缘裁断（渠道图 B站卡）。
   无头 Chrome 会把 --window-size 钳到 500px 宽，测不到真手机布局——所以用同源 iframe 造
   真实 375/768 视口（媒体查询/换行完全真实），父页逐元素扫描"可见且未被容器合法裁剪、
   却超出该视口左右边界"的元素，结果写进 #layoutCheckOut 供 dump-dom 断言：
   每档宽度一行 `W375: LAYOUT_OK` / `W375: LAYOUT_FAIL n=…`+逐条坐标与文案。 */
(function () {
  if (!/[?&]layoutcheck=1/.test(location.search)) return;
  /* &shot=1：页面顶部放一个 375×3200 真实视口预览 iframe——无头 Chrome 的窗口宽会被钳到 500
     （截图模式也是 500 布局裁成 375 宽的图），要拿真手机布局的整页截图只能借 iframe。 */
  if (new URLSearchParams(location.search).get("shot") === "1") {
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;top:0;left:0;width:375px;height:3200px;border:0;z-index:99998;background:#fff";
    f.src = location.pathname + "?lcsrc=1" + (location.hash || "#/");
    document.documentElement.appendChild(f);
    return;
  }
  const WANT = [320, 375, 768];
  function scanDoc(doc, tag) {
    const lines = []; let n = 0;
    const win = doc.defaultView, vw = doc.documentElement.clientWidth;
    /* html/body 的 overflow-x:clip 是"在视口边裁断"本身，不算合法裁剪容器 */
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
        const o = win.getComputedStyle(p).overflowX;
        if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    doc.querySelectorAll("body *").forEach(el => {
      if (el.closest("#layoutCheckOut")) return;
      const st = win.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (clipped(el)) return;
      if (r.right > vw + 3 || r.left < -3) {
        n++;
        if (lines.length < 12) lines.push(`  ${el.tagName.toLowerCase()}.${((el.className + "").split(" ") || [""])[0]} right=${Math.round(r.right)}/${vw} 「${(el.textContent || "").trim().slice(0, 24)}」`);
      }
    });
    return `${tag} vw=${vw}: ` + (n === 0 ? "LAYOUT_OK" : `LAYOUT_FAIL n=${n}\n` + lines.join("\n"));
  }
  const box = document.createElement("div");
  box.id = "layoutCheckOut";
  box.style.cssText = "position:fixed;left:0;bottom:0;width:100%;max-height:46vh;overflow:auto;background:#fff;border-top:2px solid #900;padding:4px;z-index:99999";
  document.body.appendChild(box);
  /* 槽位输出：parts[0]=SELF 本视口，parts[i+1]=WANT[i] 的 iframe 视口，顺序确定便于断言 */
  const parts = new Array(WANT.length + 1);
  function report() {
    let pre = box.querySelector("pre");
    if (!pre) { pre = document.createElement("pre"); pre.style.cssText = "margin:0 0 4px;font:11px/1.5 monospace;white-space:pre-wrap"; box.prepend(pre); }
    pre.textContent = parts.map((p, i) => p || `W${WANT[i - 1]}: 测量中…`).join("\n");
  }
  function run() {
    parts[0] = scanDoc(document, "SELF");
    box.querySelectorAll("iframe").forEach(f => f.remove());
    report();
    WANT.forEach((W, i) => {
      const f = document.createElement("iframe");
      f.style.cssText = `width:${W}px;height:200px;border:1px solid #900;margin:2px 0;background:#fff`;
      f.setAttribute("title", "layout" + W);
      f.src = location.pathname + "?lcsrc=1" + (location.hash || "#/");
      f.addEventListener("load", () => {
        setTimeout(() => {
          try { parts[i + 1] = scanDoc(f.contentDocument, `W${W}`); }
          catch (e) { parts[i + 1] = `W${W}: LAYOUT_ERR ${e}`; }
          report();
        }, 500);
      });
      box.appendChild(f);
    });
  }
  let t;
  const deb = () => { clearTimeout(t); t = setTimeout(run, 350); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", deb); else deb();
  addEventListener("hashchange", deb);   /* 调试通道：切路由后重扫 */
})();
