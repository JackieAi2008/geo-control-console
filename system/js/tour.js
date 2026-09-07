/* GEO智控台 V6.1 · 首次登录操作指引（guided tour）
 * 真实案例：深圳南山·蛇口「南山大厦」8 步 4 章带看（建项目→建档→体检→行动与验证）。
 * 形态：聚光灯（box-shadow 挖孔）+ 气泡讲解；演示态 = 临时替换 PROJECTS/CUR/state 三个绑定（仅内存），
 *       app.js 的 save() 在引导期间被守卫跳过——演示数据绝不写库，退出即还原用户真实状态。
 * 一次性：服务端 kv user:onboard:<账号>（GET/POST /api/onboarding），换设备不重复弹；
 *         本地模式回落 localStorage；?tour=force[&tourStep=N] 强制重放（QA/演示用）。
 * 依赖（运行时跨 script 全局）：app.js 的 $/$$/esc/PROJECTS/CUR/state/defaultState/route/go/
 *       renderProjectContext/renderDiagResult/SERVER_MODE；data.js 的 GEO；ops.js 的渲染钩子。
 */
"use strict";

const TOUR_LS_KEY = "geodesk.tourSeen";

/* ── 南山大厦演示项目（全部示例数据，只读演示）────────────── */
const TOUR_META = {
  id: "p_tour_demo", name: "南山大厦", url: "", brand: "南山大厦",
  operator: "（示例）南山大厦物业服务中心",
  entityMode: "none",                     /* 单楼宇无独立官网 → 实体体检路线（轻量 14 问档，V6 起含 L13/L14 区位词探针） */
  city: "深圳市南山区蛇口",
  industries: ["科技企业总部", "现代服务业"],
  competitors: ["新时代广场", "海上世界商务广场"],
  matrixTier: "lite", groupDomains: ["cmhk.com"],
  ownDomains: ["mp.weixin.qq.com"],       /* 官方公众号=唯一可控阵地（示例） */
  createdAt: "2026-09-06",
};

/* 实体体检示例结果（形状与 server._diagnose_entity 完全一致；域名对照 GEO.referrerRules 可稳定复现六分类） */
const TOUR_TOPS = [
  { title: "蛇口写字楼出租_南山大厦房源",        url: "https://shenzhen.anjuke.com/office/ns/" },
  { title: "南山大厦 写字楼 出租",              url: "https://shenzhen.fang.com/office/" },
  { title: "南山大厦 商圈写字楼",               url: "https://sz.lianjia.com/xiezilou/" },
  { title: "深圳南山 二手写字楼 信息",          url: "https://sz.58.com/office/" },
  { title: "南山大厦租赁信息",                  url: "https://shenzhen.leju.com/office/" },
  { title: "南山大厦_百度百科",                 url: "https://baike.baidu.com/item/demo" },
  { title: "南山区产业楼宇扶持政策（提及辖区楼宇）", url: "https://www.szns.gov.cn/xxgk/" },
  { title: "集团动态：蛇口片区楼宇更新",        url: "https://www.cmhk.com/news/demo/" },
  { title: "南山大厦 点评",                    url: "https://www.dianping.com/shop/demo" },
  { title: "蛇口本地资讯：片区写字楼巡礼",      url: "https://www.shekou.net/office/" },
];
const TOUR_DIAG = {
  ts: "2026-08-24 10:12", url: "南山大厦", brand: "南山大厦", mode: "entity",
  checks: [
    { id: "E2a", name: "品牌词搜索·自有渠道", status: "fail",
      evidence: "搜索「南山大厦」前10全部为第三方：shenzhen.anjuke.com、shenzhen.fang.com、sz.lianjia.com…",
      score: { E2: 0 }, top_domains: [], tops: TOUR_TOPS },
    { id: "E1", name: "百科词条", status: "pass",
      evidence: "搜索「南山大厦」前10 出现百度百科（排名第6位）——词条存在且可见，请人工核对数据是否与口径表一致",
      score: { E1: 2 } },
    { id: "E6", name: "企业信息平台", status: "warn",
      evidence: "前10 未见企查查/天眼查/爱企查——AI 查「谁在运营」时缺底层数据，请人工到两平台核对并补全信息",
      score: { E6: 0 } },
    { id: "E4", name: "权威信源覆盖", status: "pass",
      evidence: "前10 含权威信源：www.szns.gov.cn——把其中提及本项目的报道整理成带年份出处的可引用素材",
      score: { E4: 1 } },
  ],
};

/* 口径骨架示例（A=锚定区已填；B=关键数字补齐；竣工年份/物业运营方留待填展示骨架引导） */
const TOUR_CAL_A = { "实体全称": "深圳市南山区南山大厦", "详细地址": "南山区蛇口街道太子路（示例门牌）", "所在片区/商圈": "蛇口·海上世界" };
const TOUR_CAL_B = Object.assign({}, TOUR_CAL_A, {
  "楼层数": "28 层（示例）", "标准层面积": "约 2,100 ㎡（示例）",
  "租金区间": "120–180 元/㎡/月（示例）", "入驻率": "82%（2026-H1，示例）",
});

/* 监测示例（C 阶段）：8/24 基线全未提及 → 8/28 部署百科稿+公众号一园一档 → 9/6 复测开始被提及并引用 */
const TOUR_LEDGER = [
  { date: "2026-08-24", engine: "搜索通道", channel: "src", promptId: "L13", mention: 0, sentiment: 0.5, url: "", cooccur: [], note: "前10=shenzhen.anjuke.com，sz.lianjia.com，baike.baidu.com…" },
  { date: "2026-08-24", engine: "搜索通道", channel: "src", promptId: "L14", mention: 0, sentiment: 0.5, url: "", cooccur: [], note: "前10=sz.58.com，shenzhen.fang.com…" },
  { date: "2026-09-06", engine: "搜索通道", channel: "src", promptId: "L13", mention: 1, sentiment: 0.5, url: "", cooccur: [], note: "前10=baike.baidu.com，mp.weixin.qq.com…" },
  { date: "2026-08-24", engine: "豆包",     promptId: "L1", mention: 0,   sentiment: 0.5, url: "", cooccur: ["新时代广场"], note: "" },
  { date: "2026-08-24", engine: "DeepSeek", promptId: "L2", mention: 0.5, sentiment: 0.5, url: "", cooccur: [], note: "" },
  { date: "2026-08-24", engine: "腾讯元宝", promptId: "L1", mention: 0,   sentiment: 0.5, url: "", cooccur: [], note: "" },
  { date: "2026-09-06", engine: "豆包",     promptId: "L1", mention: 1, sentiment: 1, url: "https://mp.weixin.qq.com/s/demo-ygyd", cooccur: [], note: "引用公众号一园一档" },
  { date: "2026-09-06", engine: "豆包",     promptId: "L4", mention: 1, sentiment: 1, url: "", cooccur: [], note: "AI代问·联网检索（LLM抽取）", src: "api" },
  { date: "2026-09-06", engine: "豆包",     promptId: "L7", mention: 0, sentiment: 0.5, url: "", cooccur: [], note: "AI代问·联网检索（LLM抽取）", src: "api" },
  { date: "2026-09-06", engine: "腾讯元宝", promptId: "L1", mention: 1, sentiment: 1, url: "https://baike.baidu.com/item/demo", cooccur: [], note: "引用百科词条" },
  { date: "2026-09-06", engine: "DeepSeek", promptId: "L2", mention: 1, sentiment: 1, url: "", cooccur: [], note: "提及未引用" },
];
const TOUR_SNAPSHOTS = [
  { ts: 1, date: "2026-08-24", type: "diag", auditPct: 8, diagFails: 1, mentionAns: 17, mentionAnsN: 3, mentionSrc: 0, mentionSrcN: 2, ownHitN: 0, ownHitTotal: 2, ownHitDate: "2026-08-24", baseline: true },
  { ts: 2, date: "2026-09-06", type: "diag", auditPct: 42, diagFails: 0, mentionAns: 100, mentionAnsN: 3, mentionSrc: 100, mentionSrcN: 1, ownHitN: 1, ownHitTotal: 2, ownHitDate: "2026-09-06" },
];
const TOUR_WATCH = [
  { name: "南山大厦-百科词条更新稿（示例）",   url: "https://baike.baidu.com/item/demo", deployedAt: "2026-08-28", promptIds: [], hits: [{ date: "2026-09-06", seen: true, rank: 6, n: 10 }] },
  { name: "南山大厦-一园一档·公众号版（示例）", url: "https://mp.weixin.qq.com/s/demo-ygyd", deployedAt: "2026-08-28", promptIds: [], hits: [{ date: "2026-09-06", seen: true, rank: 5, n: 10 }] },
];

function tourFillCaliber(st, fill) {
  (st.caliber || []).forEach(r => {
    if (fill[r.field]) { r.official = fill[r.field]; r.asOf = "2026-09"; r.source = "示例数据"; }
  });
}
/* 演示态按章节推进重建（跟案例走时间线：建档前→体检后→行动后），renders 全部吃真实组件 */
function tourDemoState(phase) {
  const st = defaultState(true, TOUR_META);
  st.entityMode = "none";
  st.probesBackfilled = true; st.statsV2 = true;
  tourFillCaliber(st, phase === "A" ? TOUR_CAL_A : TOUR_CAL_B);
  if (phase !== "A") {
    st.lastDiag = JSON.parse(JSON.stringify(TOUR_DIAG));
    st.diagHistory = [JSON.parse(JSON.stringify(TOUR_DIAG))];
    Object.assign(st.audit, { E1: 2, E2: 0, E4: 1, E6: 0 });
  }
  if (phase === "C") {
    Object.assign(st.audit, { E3: 1, E5: 1, D1: 2, D2: 1, D4: 1, D5: 1, D6: 1 });
    st.ledger = JSON.parse(JSON.stringify(TOUR_LEDGER));
    st.snapshots = JSON.parse(JSON.stringify(TOUR_SNAPSHOTS));
    st.events = [{ date: "2026-08-28", type: "deploy", label: "部署百科词条更新稿 + 公众号《一园一档》（示例）" }];
    st.watchPages = JSON.parse(JSON.stringify(TOUR_WATCH));
  }
  return st;
}

/* ── 8 步剧本（章 · 步 · 视图 · 演示阶段 · 聚光灯目标）────────── */
const REPLAY_HINT = "之后想再看：顶栏「?」按钮，随时重放本指引。";
const TOUR_STEPS = [
  { center: true, phase: "A", chap: "欢迎", title: "3 分钟，用真实案例带你走一遍",
    body: `当租户在 AI（DeepSeek、豆包、元宝）里问「蛇口甲级写字楼哪里租」，AI 会不会提到你、引用谁的话介绍你——这个系统就是管这件事的。<br>接下来以<b>深圳南山·蛇口「南山大厦」</b>为案例走一遍完整路径：建项目 → 建档案 → 体检 → 行动 → 监测。`,
    demo: `<span class="tag tag-gold">全程只读演示</span> 不动你的真实数据；随时可点「我知道了，不用再学了」退出。${REPLAY_HINT}` },
  { phase: "A", chap: "第一章 · 认识系统", view: "projects", target: ["#pjWelcomeNew", "#pjNew"],
    title: "一切从一个项目开始", act: "点「＋新建项目」",
    body: `系统里一个项目 = 一个要管网上形象的<b>楼宇、园区或品牌</b>。你看到的「南山大厦」卡片就是示例项目。建项目只需填几个字段：名称、是楼宇还是园区、所在城市片区、主导产业、主要竞品——2 分钟建好。`,
    demo: `<span class="tag tag-gold">示例</span> 新建弹窗这样填：南山大厦 · 楼宇 · <b>轻量版 14 问</b>档（含区位词探针） · 深圳市南山区蛇口 · 竞品：新时代广场等。` },
  { phase: "A", chap: "第二章 · 建立档案", view: "diag/caliber", target: ["#caliberBody tr"],
    title: "先把「官方口径」定下来", act: "补齐骨架里的待填字段",
    body: `新建后系统自动生成这张<b>口径骨架表</b>。锚定区三项（全称/地址/片区）防止和其他城市同名项目混淆；再把租金区间、入驻率等关键数字补齐——每个数字带时点和来源，AI 才敢引用。这张表是全系统唯一事实源：优化物料、百科词条更新稿的数字全部取自这里，对外发布前逐个数字对照本表。顶部「这份口径表说明什么」说明卡随数据实时解读：数字打架时 AI 会随机挑、先定稿哪个字段。`,
    demo: `<span class="tag tag-gold">示例</span> 租金区间 120–180 元/㎡/月 · 入驻率 82%（2026-H1）——来源列均标注「示例数据」。` },
  { phase: "A", chap: "第二章 · 建立档案", view: "dashboard", target: ["#dashOnboard"],
    title: "新建之后，四步起步清单自动亮起", act: "按 ①→④ 逐项执行",
    body: `填口径骨架（10 分钟）→ 跑体检（2 分钟）→ 下载百科词条更新稿（15 分钟）→ 三大地图认领（10 分钟）。③④点「前往」直达对应物料的下载位置。做完这四步，项目在网上就有「自己的家」了——<b>你以后建的每个新项目，都会看到这张卡</b>。` },
  { phase: "A", chap: "系统地图", view: "dashboard", target: ["#mainNav"],
    title: "顶部导航就是全流程地图", act: "记住这条地图",
    body: `<b>工作台</b>看状态与下一步 · <b>诊断Ⅰ</b>做体检与口径 · <b>执行Ⅱ</b>拿物料与方案 · <b>监测Ⅲ</b>看数据与曲线 · <b>知识库</b>查方法论。左上角芯片随时切换/返回项目。以后迷路了，看这一条就够。` },
  { phase: "B", chap: "第三章 · 体检", view: "diag/scan", target: ["#dgRun"],
    title: "体检：AI 眼里你存在吗？", act: "点「开始实体体检」",
    body: `没有官网也能做——「<b>实体体检</b>」用品牌词做真实搜索（约 5–15 秒），查我们的信息在网上的存在感。下方是南山大厦的示例结果：搜「南山大厦」，前 10 条里官方阵地 0 条。`,
    onEnter: function () { try { renderDiagResult(state.lastDiag, 4, 0); } catch (e) {} } },
  { phase: "B", chap: "第三章 · 体检", view: "diag/scan", target: ["#dgRefCard"],
    title: "关键一问：现在网上谁在替你说话？", act: "认领「是我们的」阵地",
    body: `引用被分成六类：自有阵地 / 集团信源 / 权威平台 / 网友点评 / 中介平台 / 其他网站。看示例——南山大厦前 10 条：<b>中介 5 · 百科与政府 2 · 集团 1 · 自己 0</b>。也就是说，网上介绍它的主要是房产中介，旧租金、空置信息会被 AI 当作官方数据引用。发现陌生阵地可点「是我们的」归位。`,
    demo: `<span class="tag tag-gold">示例</span> 这张分析卡由真实组件渲染；整改动作可到「诊断 → 诊断报告」一键生成工单。`,
    onEnter: function () { try { renderDiagResult(state.lastDiag, 4, 0); } catch (e) {} } },
  { phase: "C", chap: "第四章 · 行动与验证", view: "act/toolkit", target: ["#tkBuild"],
    title: "知道问题了，就动手改", act: "点「一键生成优化文件」",
    body: `一个按钮生成全套<b>拿来就能用</b>的物料：百科词条更新稿、地图信息核对清单、一园一档（公众号版）、选址 FAQ、渠道分发指南——不依赖官网，品宣自己就能执行。下方「资产追踪」登记每次部署，改了什么一目了然。` },
  { phase: "C", chap: "第四章 · 行动与验证", view: "monitor", target: ["#curveBox"],
    title: "改了有没有用，看曲线说话", act: "点 ①「AI 代问」",
    body: `监测页最上方就是两个自动动作：<b>①「AI 代问」</b>系统替你向豆包逐条提问，跑完结果就地显示在按钮下方（每问提及/未提及一目了然）；<b>②「跑一轮14问」</b>真实搜索（含 2 个区位词探针）查前列信源——工作台首屏也有这两个按钮直达。元宝暂需人工抽查 2 条。双周跑一轮 14 问真实搜索，系统自动画曲线。示例故事：8/24 基线几乎无人提及 → 8/28 部署百科稿和公众号一园一档 → 9/6 豆包、元宝开始提及，引用落在公众号与百科词条。曲线每点带样本量，起始数据自动锁定。` },
  { center: true, phase: "C", chap: "完成", title: "轮到你了", cta: true,
    body: `以上全部是只读示例——真实结果以你自己的项目实际诊断为准。三件事现在就能做：<br>① 新建你的第一个项目（2 分钟）；② 想重看本指引：顶栏「?」；③ 卡住了：右下角「问」直接问助手（服务器已配默认模型，开箱即用；想换自己的模型再点对话窗 ⚙）。` },
];

/* ══ 引擎 ════════════════════════════════════════════════ */
const Tour = { active: false, idx: 0, maxIdx: 0, phase: "", _real: null, _raf: 0 };

function tourTarget(st) {
  if (!st.target) return null;
  for (const sel of st.target) {
    for (const el of $$(sel)) {
      if (el && el.getClientRects().length > 0) return el;
    }
  }
  return null;
}
function tourBuildDom() {
  const shade = document.createElement("div");
  shade.className = "tour-shade"; shade.id = "tourShade";
  shade.innerHTML = '<div class="tour-ring" id="tourRing"></div>' +
    '<div class="tour-pointer" id="tourPointer" hidden></div>' +
    '<div class="tour-bubble" id="tourBubble" role="dialog" aria-label="操作指引"></div>';
  document.body.appendChild(shade);
}
function tourRenderBubble() {
  const st = TOUR_STEPS[Tour.idx];
  const bub = $("#tourBubble"); if (!bub) return;
  /* 信息架构：进度（章节+步点）归头部，动作（跳过/上一步/下一步）归脚部——四类控件不再混排一行 */
  bub.innerHTML = `
    <div class="tour-head">
      <span class="tour-chap">${st.chap}</span>
      <span class="tour-prog"><span class="tour-step-no">${Tour.idx + 1}/${TOUR_STEPS.length}</span><span class="tour-dots" aria-label="步骤进度">${TOUR_STEPS.map((_, k) =>
        `<button data-tdot="${k}" class="${k === Tour.idx ? "on" : ""}" aria-label="跳到第${k + 1}步"></button>`).join("")}</span></span>
    </div>
    <div class="tour-title">${st.title}</div>
    <div class="tour-body">${st.body}</div>
    ${st.demo ? `<div class="tour-demo">${st.demo}</div>` : ""}
    <div class="tour-foot">
      <button class="btn btn-sm btn-ghost tour-skip" id="tourSkip">我知道了，不用再学了</button>
      <span style="flex:1"></span>
      ${Tour.idx > 0 && !st.cta ? '<button class="btn btn-sm btn-ghost" id="tourPrev">上一步</button>' : ""}
      ${st.cta ? '<button class="btn btn-sm btn-ghost" id="tourDone">先自己逛逛</button>' +
                 '<button class="btn btn-sm btn-primary" id="tourCta">＋ 新建我的第一个项目</button>'
               : `<button class="btn btn-sm btn-primary" id="tourNext">${Tour.idx === 0 ? "开始带看" : "下一步"}</button>`}
    </div>`;
  $("#tourSkip").onclick = () => tourEnd(true, "skip");
  const nx = $("#tourNext"); if (nx) nx.onclick = tourNext;
  const pv = $("#tourPrev"); if (pv) pv.onclick = tourPrev;
  const cta = $("#tourCta"); if (cta) cta.onclick = () => {
    tourEnd(true, "cta");
    go("projects");
    /* 打开真实新建弹窗（空表单、不预填示例，防止演示数据直接入库） */
    setTimeout(() => { $("#projModal").hidden = false; $("#npName").focus(); }, 100);
  };
  const dn = $("#tourDone"); if (dn) dn.onclick = () => tourEnd(true, "done");
  $$("#tourBubble [data-tdot]").forEach(b => b.onclick = () => tourShow(+b.dataset.tdot));
}
function tourPosition() {
  if (!Tour.active) return;
  const shade = $("#tourShade"); if (!shade) return;
  const st = TOUR_STEPS[Tour.idx];
  const ring = $("#tourRing"), bub = $("#tourBubble");
  const pt0 = $("#tourPointer"); if (pt0) pt0.hidden = true;
  if (st.center) { shade.classList.add("center"); return; }
  shade.classList.remove("center");
  const el = tourTarget(st);
  if (!el) { shade.classList.add("center"); return; }   /* 目标不在场（如回访者无欢迎卡且工具栏隐藏）→ 居中兜底 */
  const mobile = window.matchMedia && window.matchMedia("(max-width:768px)").matches;
  try { el.scrollIntoView({ block: mobile ? "start" : "center", behavior: "auto" }); } catch (e) {}
  const r = el.getBoundingClientRect(), pad = 6;
  ring.style.left = (r.left - pad) + "px"; ring.style.top = (r.top - pad) + "px";
  ring.style.width = (r.width + pad * 2) + "px"; ring.style.height = (r.height + pad * 2) + "px";
  if (mobile) { tourPlacePointer(r, el); return; }   /* 移动端气泡=底部抽屉无需定位；指引签仍定位（固定上方，避开底部抽屉） */
  const bw = bub.offsetWidth, bh = bub.offsetHeight, m = 12, gap = 16;
  const clampX = v => Math.min(Math.max(m, v), window.innerWidth - bw - m);
  const clampY = v => Math.min(Math.max(m, v), window.innerHeight - bh - m);
  let x, y;
  if (r.bottom + gap + bh <= window.innerHeight - m) {            /* ① 下方 */
    x = clampX(r.left + r.width / 2 - bw / 2); y = r.bottom + gap;
  } else if (r.top - gap - bh >= m) {                             /* ② 上方 */
    x = clampX(r.left + r.width / 2 - bw / 2); y = r.top - gap - bh;
  } else if (r.right + gap + bw <= window.innerWidth - m) {       /* ③ 右侧（目标过高时） */
    x = r.right + gap; y = clampY(r.top);
  } else if (r.left - gap - bw >= m) {                            /* ④ 左侧（右侧放不下，如右栏大卡） */
    x = r.left - gap - bw; y = clampY(r.top);
  } else {                                                        /* ⑤ 兜底贴底，尽量少遮内容 */
    x = clampX(r.left + r.width / 2 - bw / 2); y = Math.max(m, window.innerHeight - bh - m);
  }
  bub.style.left = Math.round(x) + "px"; bub.style.top = Math.round(y) + "px";
  tourPlacePointer(r, el);
}
/* V0.2.11 指引签定位：跟 ring 同源矩形；候选位（下/上）逐一试——须在视口内且不与讲解气泡叠压，
   桌面气泡常在目标下方 → 签多半落到上方；移动端底部抽屉占下半屏 → 优先目标下方（离抽屉够远时） */
function tourPlacePointer(r, el) {
  const pt = $("#tourPointer"); if (!pt) return;
  const st = TOUR_STEPS[Tour.idx];
  pt.hidden = !st.act;
  if (!st.act) return;
  pt.textContent = "点这里：" + st.act;
  const pw = pt.offsetWidth, ph = pt.offsetHeight, gap = 10, m = 8;
  const mobile = window.matchMedia && window.matchMedia("(max-width:768px)").matches;
  const W = window.innerWidth, H = window.innerHeight;
  const cx = Math.min(Math.max(m, r.left + r.width / 2 - pw / 2), W - pw - m);
  const bub = $("#tourBubble");
  const br = bub ? bub.getBoundingClientRect() : null;
  const hitsBubble = (x, y) => !!br && x < br.right + 4 && x + pw > br.left - 4 && y < br.bottom + 4 && y + ph > br.top - 4;
  const cands = mobile
    ? [[cx, Math.min(r.bottom + gap, H * 0.5 - ph)], [cx, Math.max(m, r.top - gap - ph)], [cx, Math.min(r.bottom + gap, H - ph - m)]]
    : [[cx, r.bottom + gap], [cx, Math.max(m, r.top - gap - ph)]];
  let pick = cands[cands.length - 1];
  for (const c of cands) { if (c[1] >= m && c[1] + ph <= H - m && !hitsBubble(c[0], c[1])) { pick = c; break; } }
  pt.classList.toggle("up", pick[1] + ph / 2 < r.top);
  pt.style.left = Math.round(pick[0]) + "px"; pt.style.top = Math.round(Math.max(m, pick[1])) + "px";
}
function tourShow(i) {
  if (!Tour.active) return;
  Tour.idx = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
  Tour.maxIdx = Math.max(Tour.maxIdx, Tour.idx);   /* 漏斗：到达最深步（比退出步更能说明看到过什么） */
  const st = TOUR_STEPS[Tour.idx];
  if (st.phase && st.phase !== Tour.phase) { Tour.phase = st.phase; state = tourDemoState(st.phase); }
  if (st.view && location.hash !== "#/" + st.view) location.hash = "#/" + st.view;
  setTimeout(() => {
    route();                                   /* hashchange 之外强制渲染一次，保证目标元素在场 */
    if (st.onEnter) st.onEnter();
    tourRenderBubble();
    const nx = $("#tourNext") || $("#tourCta"); if (nx) nx.focus({ preventScroll: true });
    tourPosition();
    tourDemoClick(st);
  }, 60);
}
/* V0.2.11 点击涟漪：每步入场在目标中心演示一次"点这"（600ms 后起跳，让 ring 先落位；reduced-motion 下为静态一闪） */
function tourDemoClick(st) {
  const old = document.querySelector(".tour-click"); if (old) old.remove();
  if (st.center) return;
  const el = tourTarget(st); if (!el) return;
  setTimeout(() => {
    if (!Tour.active || TOUR_STEPS[Tour.idx] !== st) return;   /* 已切步则不演示 */
    const el2 = tourTarget(st); if (!el2) return;
    const r = el2.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.className = "tour-click";
    dot.style.left = Math.round(r.left + r.width / 2) + "px";
    dot.style.top = Math.round(r.top + Math.min(r.height / 2, 44)) + "px";
    $("#tourShade").appendChild(dot);
    setTimeout(() => dot.remove(), 1000);
  }, 600);
}
function tourNext() { Tour.idx >= TOUR_STEPS.length - 1 ? tourEnd(true, "finish") : tourShow(Tour.idx + 1); }
function tourPrev() { if (Tour.idx > 0) tourShow(Tour.idx - 1); }
function tourOnReposition() { cancelAnimationFrame(Tour._raf); Tour._raf = requestAnimationFrame(tourPosition); }
function tourKeys(e) {
  if (!Tour.active) return;
  if (e.key === "Escape") { e.preventDefault(); tourEnd(true, "esc"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); tourNext(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); tourPrev(); }
  else if (e.key === "Tab") {   /* 焦点圈进气泡，不落到被遮罩的页面上 */
    const f = $$("#tourBubble button"); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!$("#tourBubble").contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
/* 漏斗埋点：exit ∈ skip(按钮)/esc/cta(新建)/done(先逛逛)/finish(键盘走完)，随 seen 一起落 kv 供运营复盘 */
function tourMarkSeen(exit) {
  const rec = { exit: exit || "other", step: Tour.idx, maxStep: Tour.maxIdx };
  try { localStorage.setItem(TOUR_LS_KEY, JSON.stringify(rec)); } catch (e) {}
  try {
    fetch("/api/onboarding/seen", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec) }).catch(() => {});
  } catch (e) {}
}
Tour.start = function (opts) {
  if (Tour.active) return;
  opts = opts || {};
  Tour.active = true; Tour.phase = ""; Tour.maxIdx = 0;
  Tour._real = { projects: PROJECTS, cur: CUR, state: state, hash: location.hash };
  /* 演示态接管：项目层与状态层一起换成南山大厦示例（报头 chip/venueNoun/渲染全部跟随案例） */
  PROJECTS = [Object.assign({}, TOUR_META, { lastOpen: Date.now() })];
  CUR = TOUR_META.id;
  document.body.classList.add("tour-active");
  tourBuildDom();
  window.addEventListener("resize", tourOnReposition);
  window.addEventListener("scroll", tourOnReposition, true);
  window.addEventListener("hashchange", tourOnReposition);
  document.addEventListener("keydown", tourKeys);
  tourShow(opts.step || 0);
};
function tourEnd(markSeen, exit) {
  if (!Tour.active) return;
  Tour.active = false;
  /* 还原用户真实状态（三个绑定全程未被穿透：save() 已在 app.js 侧守卫） */
  PROJECTS = Tour._real.projects; CUR = Tour._real.cur; state = Tour._real.state;
  document.body.classList.remove("tour-active");
  window.removeEventListener("resize", tourOnReposition);
  window.removeEventListener("scroll", tourOnReposition, true);
  window.removeEventListener("hashchange", tourOnReposition);
  document.removeEventListener("keydown", tourKeys);
  cancelAnimationFrame(Tour._raf);
  const sh = $("#tourShade"); if (sh) sh.remove();
  /* V0.1.13 F1 演示泄漏根治：演示期间 renderDiagResult/renderChannels 把「南山大厦」示例写进了
     常驻 DOM（#dgOut 结果区 / #channelBox 渠道图）。state 还原不会自动清它们——退出时一并清空，
     由 route() 按用户真实项目重建（无诊断历史=空态预检清单；渠道图带项目归属章，见 render.toolkit） */
  const dgo = $("#dgOut"); if (dgo) dgo.innerHTML = "";
  const cb = $("#channelBox"); if (cb) { cb.innerHTML = ""; delete cb.dataset.proj; }
  if (location.hash !== Tour._real.hash) location.hash = Tour._real.hash;
  renderProjectContext(); route();
  if (markSeen) tourMarkSeen(exit);
}
/* 首登自动弹出：?tour=force 强制 > 服务端账号级判定 > 本地 localStorage；自动化环境（webdriver）不自动弹 */
Tour.autoStart = async function () {
  if (Tour.active) return;
  const qs = new URLSearchParams(location.search);
  if (qs.get("tour") === "force") {
    const stp = parseInt(qs.get("tourStep"), 10);
    Tour.start({ step: isNaN(stp) ? 0 : stp });
    return;
  }
  if (navigator.webdriver) return;
  let show = null;
  try {
    if (SERVER_MODE) {
      const r = await fetch("/api/onboarding", { signal: AbortSignal.timeout(2500) });
      if (r.ok) { const d = await r.json(); show = !!d.show; }
    }
  } catch (e) {}
  if (show === null) { try { show = !localStorage.getItem(TOUR_LS_KEY); } catch (e) { show = false; } }
  if (show) Tour.start({});
};
window.Tour = Tour;
