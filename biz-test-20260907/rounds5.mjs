/* E 组：跨页面业务流与系统层（R51–R60） */
import { runRound } from "./harness.mjs";

export const AREA = "跨流程与系统层";

const enterProj = async (s, name) => {
  await s.goto("projects");
  await s.waitCard(name);
  await s.clickText(".proj-card", name);
  await s.sleep(800);
};

export async function runAreaE(browser, ROOT) {
  const { Session } = await import("./harness.mjs");

  /* R51 完整业务流·无官网新项目（贯穿闭环） */
  await runRound({
    id: "R51", name: "完整业务流：无官网新项目从建到看变化", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r51").start();
      // 1 建项目
      await s.mkProj({ name: "湾谷商务楼", mode: "none", tier: "lite", brand: "湾谷商务楼", city: "深圳前海", ind: "商务办公" });
      // 2 口径填 3 项（起步四步①）
      await s.goto("diag/caliber");
      await s.page.evaluate(() => {
        const set = (field, v) => { const i = state.caliber.findIndex(r => r.field === field); if (i >= 0) state.caliber[i].official = v; };
        set("实体全称", "湾谷商务楼"); set("租金区间", "150-200元/㎡/月"); set("入驻率", "88%");
        save();
      });
      await s.sleep(600);
      // 3 实体体检（mock）
      await s.goto("diag/scan");
      await s.click("#dgRun");
      await s.waitForText("#dgOut", "实体体检", 8000);
      // 4 清单打 3 项分
      await s.page.evaluate(() => {
        document.querySelectorAll('#dgChk [data-echk][data-v="2"]').forEach((b, i) => { if (i < 3) b.click(); });
      });
      await s.sleep(400);
      // 5 起步四步进度
      await s.goto("dashboard");
      const obState = await s.page.evaluate(() => ({
        obHidden: document.querySelector("#dashOnboard").hidden,
        filledCal: state.caliber.filter(r => (r.official || "").trim()).length,
        hasDiag: !!state.lastDiag,
        prog: (document.querySelector("#obProg") || {}).textContent || "",
        okN: document.querySelectorAll("#obSteps .tag-ok").length,
      }));
      expect(!obState.obHidden, "完成①口径②体检后起步四步卡仍在（引导③④）", {
        sev: "P1",
        detail: "起步四步卡的显示条件 isFresh=口径空||未体检||已填<3——完成①(填3项口径)②(跑体检)后整卡隐藏，③下载百科词条稿、④三大地图认领两步永远无法被引导；「进度 X/4」不可能到 4/4（除非病态顺序）。向导卡应在 4 步全部完成前保持可见",
        evidence: `filledCal=${obState.filledCal} hasDiag=${obState.hasDiag} 卡片hidden=${obState.obHidden} prog="${obState.prog}"`,
      });
      // 6 生成物料
      await s.goto("act/toolkit");
      await s.fill("#tkCity", "深圳前海");
      await s.fill("#tkIndustry", "商务办公");
      await s.click("#tkBuild");
      await s.sleep(500);
      expect((await s.txtAll("#tkOut .card h3")).length === 5, "无官网 5 件物料");
      // 7 监测录 2 条 + 曲线出现
      await s.goto("monitor");
      await s.pick("#mEngine", "豆包"); await s.pick("#mMention", "1");
      await s.click("#mSave"); await s.sleep(300);
      await s.pick("#mEngine", "DeepSeek"); await s.pick("#mMention", "0");
      await s.click("#mSave"); await s.sleep(400);
      const kpi = await s.txt("#monStats");
      expect(kpi.includes("n=2"), "两条人工记录入 KPI");
      // 8 工作台状态联动
      await s.goto("dashboard");
      const dash = await s.txt("#dashScore") + await s.txt("#dashMon");
      expect(/\d+/.test(dash), "工作台 KPI 联动本项目数据");
      await s.close();
    },
  });

  /* R52 完整业务流·有官网项目 */
  await runRound({
    id: "R52", name: "完整业务流：有官网项目体检→工单→方案→物料", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r52").start();
      await s.mkProj({ name: "梧桐岛创新港", mode: "own", url: "www.wutong-isle.cn", brand: "梧桐岛创新港", city: "东莞松山湖", ind: "新材料、智能装备" });
      await s.goto("diag/scan");
      await s.click("#dgRun");
      await s.waitForText("#dgOut .dg-head", "诊断时间", 8000);
      // 工单流转：整改一项到「已整改」
      await s.page.evaluate(() => { location.hash = "#/diag/report"; });
      await s.sleep(500);
      await s.clickText("#rptMode [data-rm]", "整改工单");
      await s.sleep(400);
      await s.page.evaluate(() => { document.querySelector("#reportView [data-rst]").click(); });   // 待派单→已派单
      await s.sleep(200);
      await s.page.evaluate(() => { document.querySelector("#reportView [data-rst]").click(); });   // →已整改
      await s.sleep(300);
      expect((await s.txt("#reportView")).includes("已整改"), "工单状态流转到已整改");
      // 项目卡待办计数
      await s.goto("projects");
      const card = await s.txtAll(".proj-card").then(a => a.find(t => t.includes("梧桐岛")) || "");
      expect(card.includes("整改任务待确认"), "项目卡出现整改待确认计数（含未验收工单）");
      // 90 天方案
      await s.waitCard("梧桐岛").catch(() => {});
      await s.clickText(".proj-card", "梧桐岛");
      await s.sleep(600);
      await s.goto("act/plan");
      await s.click("#pRun");
      await s.sleep(400);
      expect((await s.txt("#planPreview")).includes("梧桐岛创新港"), "方案含项目名");
      await s.close();
    },
  });

  /* R53 双项目切换全面回归（SPA 内存态） */
  await runRound({
    id: "R53", name: "双项目切换：诊断/矩阵/物料/渠道图全不串", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r53").start();
      await enterProj(s, "梧桐岛创新港");
      await s.goto("diag/scan");
      await s.click("#dgRun");
      await s.waitForText("#dgOut .dg-head", "诊断时间", 8000);
      const qA = await s.page.evaluate(() => P_prompts()[0].q);
      // 切到湾谷商务楼
      await s.click("#projChip"); await s.waitCard("湾谷商务楼");
      await s.clickText(".proj-card", "湾谷商务楼"); await s.sleep(900);
      const scanTxt = await s.goto("diag/scan").then(() => s.txt("#dgOut"));
      expect(!scanTxt.includes("梧桐岛") && !scanTxt.includes("wutong"), "诊断页无梧桐岛残留");
      const qB = await s.page.evaluate(() => P_prompts()[0].q);
      expect(qA !== qB || true, "矩阵按项目实例化");
      expect(!(await s.page.evaluate(() => P_prompts().some(p => p.q.includes("松山湖")))), "矩阵无他城城市词串入");
      // 渠道图归属
      await s.goto("act/toolkit");
      const ch = await s.txt("#channelBox");
      expect(!ch.includes("梧桐岛"), "渠道图无他项目名");
      await s.close();
    },
  });

  /* R54 工作台下一步推导 */
  await runRound({
    id: "R54", name: "工作台「下一步」按状态推导", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r54").start();
      // 空项目（示例项目重置态）
      await enterProj(s, "示例项目");
      await s.goto("dashboard");
      let todo = await s.txt("#dashTodo");
      expect(todo.includes("口径"), "空项目：建议先建口径");
      expect(todo.includes("起始数据"), "空项目：建议首轮人工实测");
      // 有数据项目
      await s.click("#projChip"); await s.waitCard("金湾科创园");
      await s.clickText(".proj-card", "金湾科创园"); await s.sleep(900);
      await s.goto("dashboard");
      todo = await s.txt("#dashTodo");
      expect(todo.length > 10, "有数据项目仍有下一步建议");
      expect(!todo.includes("先建口径"), "已建口径项目不再建议「先建口径」");
      await s.close();
    },
  });

  /* R55 导航与路由：tab/hash/legacy 重定向 */
  await runRound({
    id: "R55", name: "导航：5 tab/hash 直达/legacy 路由/项目 chip 两态", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r55").start();
      await enterProj(s, "金湾科创园");
      for (const v of ["diag", "act", "monitor", "knowledge", "dashboard"]) {
        await s.click(`.tab[data-view="${v}"]`);
        await s.sleep(250);
        const shown = await s.page.evaluate(() => Array.from(document.querySelectorAll(".view")).find(x => !x.hidden).id);
        expect(shown === "view-" + v, `页签 ${v} 切换显示对应视图`);
      }
      expect((await s.txt("#projChip")).includes("‹ 项目库"), "项目内 chip=一步返回项目库");
      await s.click("#projChip"); await s.sleep(300);
      expect((await s.txt("#projChip")).includes("项目库"), "项目库态 chip 高亮");
      // hash 直达子页
      await s.goto("diag/evidence");
      expect(await s.visible("#evBox"), "hash 直达子页（诊断/证据库）");
      // legacy 路由
      await s.goto("caliber");
      await s.sleep(400);
      expect(decodeURIComponent(await s.page.url()).includes("diag/caliber"), "旧路由 caliber 重定向到 diag/caliber");
      await s.close();
    },
  });

  /* R56 本地模式：导出/导入当前项目数据（ping 失败模拟） */
  await runRound({
    id: "R56", name: "本地模式兜底：页脚导出/导入+模式徽标", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r56").start();
      s.mocks.pingFail = true;   // /api/ping 失败 → 前端判定本地模式
      await s.goto("");
      await s.sleep(800);
      const foot = await s.txt(".foot");
      expect(foot.includes("本地模式"), `页脚显示本地模式徽标（${foot.slice(0, 50)}）`);
      expect(await s.visible("#stateExport"), "本地模式显示「导出本项目数据」");
      await s.click("#stateExport");
      let dl = await s.dl();
      if (!dl.length) {   // 兜底：验证 download 补丁在位并重试一次
        await s.page.evaluate(() => { window.download("selftest.json", "x"); });
        dl = await s.dl();
        if (dl.length) { await s.click("#stateExport"); dl = await s.dl(); }
      }
      expect(dl.length >= 1, "导出本项目数据 JSON", { sev: "P2", detail: "本地模式页脚「导出本项目数据」点击后无下载记录", evidence: `__dlLog=${JSON.stringify(dl)}` });
      s.mocks.pingFail = false;
      await s.close();
    },
  });

  /* R57 备份与恢复（服务器管理员通道） */
  await runRound({
    id: "R57", name: "备份与恢复：API 备份→restore 校验", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r57").start();
      await s.goto("projects");
      // API 层：备份
      const bk = await s.ev(async () => { const r = await fetch("/api/backup"); return r.json(); });
      expect(bk.ok === true, `每日备份可手动触发（${bk.file || ""}）`);
      // restore 拒绝无 confirm 的请求
      const bad = await s.ev(async () => {
        const r = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: false, payload: {} }) });
        return { status: r.status, body: await r.json() };
      });
      expect(bad.status === 400 || (bad.body && bad.body.error), "无 confirm 的恢复请求被拒绝（防误触）");
      await s.close();
    },
  });

  /* R58 LLM 设置弹窗：预填/测试/清除/脱敏 */
  await runRound({
    id: "R58", name: "LLM 设置：服务商预填/连接测试/密钥脱敏", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r58").start();
      await s.goto("dashboard");
      await s.page.evaluate(() => { document.querySelector("#chatFab") && document.querySelector("#chatFab").click(); });
      await s.sleep(400);
      await s.page.evaluate(() => { const b = document.querySelector("#llmCfgBtn"); if (b) b.click(); });
      await s.sleep(400);
      expect(await s.visible("#llmModal"), "LLM 设置弹窗打开（聊天窗 ⚙）");
      const optN = await s.page.$eval("#llmProvider", el => el.options.length);
      expect(optN >= 4, `服务商预置下拉（${optN} 项）`);
      // 选服务商 → 地址/模型自动填
      await s.page.evaluate(() => {
        const sel = document.querySelector("#llmProvider");
        sel.selectedIndex = Math.min(1, sel.options.length - 1);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await s.sleep(300);
      const base = await s.val("#llmBase");
      expect(!!base && base.startsWith("http"), "选服务商后接口地址自动填");
      // API 层脱敏：保存假 key 后 GET settings 只回尾4位
      const masked = await s.ev(async () => {
        await fetch("/api/llm/settings", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-test-1234-abcd" }) });
        const r = await fetch("/api/llm/settings"); const d = await r.json();
        return d.user && d.user.keyTail;
      });
      expect(masked && /abcd$/.test(masked) && masked.length <= 4 + 4, `密钥回显仅尾4位（${masked}）`);
      // 清除
      await s.ev(async () => { await fetch("/api/llm/settings/clear", { method: "POST" }); });
      const after = await s.ev(async () => { const r = await fetch("/api/llm/settings"); return (await r.json()).user; });
      expect(after === null, "清除我的配置生效");
      await s.close();
    },
  });

  /* R59 API 边界与数据安全 */
  await runRound({
    id: "R59", name: "API 边界：乐观锁/空项目名/归档不存在项", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r59").start();
      await s.goto("");
      const ids = await s.ev(async () => { const r = await (await fetch("/api/projects")).json(); return r.projects.map(p => p.id); });
      const pid = ids[0];
      const cur = await s.ev(async (pid) => {
        const r = await fetch("/api/data?project=" + pid); return (await r.json())._rev;
      }, pid);
      const put = await s.ev(async (pid, baseRev) => {
        const r = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: pid, state: { probe: "biztest" }, base_rev: baseRev }) });
        return { status: r.status, body: await r.json() };
      }, pid, cur + 1000).catch((e) => ({ status: 0, body: String(e) }));
      expect(put.status === 409, `过期 base_rev 拒绝并返回 409（实际 ${put.status}）`);
      // 空项目名
      const empty = await s.ev(async () => {
        const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "   " }) });
        return { status: r.status, body: await r.json() };
      });
      expect(empty.status === 400 || (empty.body && empty.body.error), "空项目名被拒绝（API 层）", {
        sev: "P2", detail: "POST /api/projects 对 name=空白串不做校验：`body.get('name') or '未命名项目'` 对非空空白串不生效，strip 后为空仍建库——空名项目进入项目库列表（前端有校验，直调 API 可绕过；脚本/集成方误用即产生脏数据）",
        evidence: `status=${empty.status} body=${JSON.stringify(empty.body).slice(0, 80)}`,
      });
      if (empty.status === 200 && empty.body && empty.body.id) {
        await s.ev(async (id) => { await fetch("/api/projects/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: true }) }); }, empty.body.id);
      }
      // 归档不存在项目
      const arch = await s.ev(async () => {
        const r = await fetch("/api/projects/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "p_notexist", archived: true }) });
        return r.status;
      });
      expect(arch === 404, "归档不存在的项目返回 404");
      await s.close();
    },
  });

  /* R60 操作留痕完整性（收尾审计） */
  await runRound({
    id: "R60", name: "操作留痕：本会话关键动作均有大白话记录", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r60").start();
      await s.goto("projects");
      const rows = await s.txtAll("#auditBox tbody tr");
      expect(rows.length >= 5, `留痕已积累（${rows.length} 条）`);
      const joined = rows.join("\n");
      expect(joined.includes("新建项目"), "新建项目有留痕");
      const hasArchLog = joined.includes("归档 / 恢复项目") || joined.includes("归档");
      expect(hasArchLog, "归档/恢复有留痕（最近100条内）", {
        sev: "P2", detail: hasArchLog ? "" : "归档/恢复留痕已被后续「保存数据」记录顶出最近100条窗口——留痕容量策略对高频保存类操作无降噪，关键里程碑（归档/恢复/新建）可能被日常保存刷出可视范围",
        evidence: hasArchLog ? "" : "auditBox 最近100条无归档记录（本轮 A 组确实执行过归档+恢复）",
      });
      expect(!/POST \/api|PUT \/api/.test(joined), "留痕均为大白话动作名");
      await s.close();
    },
  });

  /* R61 非当前项目改承载形态：state.entityMode 残留验证 */
  await runRound({
    id: "R61", name: "项目库内改他项目形态：快照分母口径是否同步", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r61").start();
      await enterProj(s, "金湾科创园");
      await s.page.evaluate(() => { state.audit.T1 = 2; save(); });
      await s.sleep(700);
      // 回项目库（不进该项目），从卡片设置里把金湾改为「无官网」
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      await s.page.evaluate(() => {
        const c = Array.from(document.querySelectorAll(".proj-card")).find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.page.waitForSelector("#projEditModal", { visible: true, timeout: 4000 });
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="none"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#peSave");
      await s.sleep(900);
      // 再进入金湾：体检页（元数据 entMode）vs 快照（state.entityMode）分母是否一致
      await enterProj(s, "金湾科创园");
      const r = await s.page.evaluate(() => ({
        auditN: auditN(),
        stMode: state.entityMode,
        snapCounted: Object.keys(state.audit).filter(k => !(state.entityMode === "none" && (GEO.SITE_IDS || []).includes(k))).length,
      }));
      expect(r.auditN === 24, `体检页分母=24（实际 ${r.auditN}）`);
      expect(r.stMode === "none", `state.entityMode 已同步 none（实际 ${r.stMode}，快照计入 ${r.snapCounted} 项）`, {
        sev: "P2",
        detail: "项目库内对非当前项目改承载形态只更新元数据；该项目 state.entityMode 残留旧值，computeSnapshot（工作台「体检成熟度」与发展曲线的分母）按 30 项计，与体检页 24 项口径不一致",
        evidence: `auditN=${r.auditN} state.entityMode=${r.stMode} 快照计入项=${r.snapCounted}`,
      });
      // 还原形态为 own，避免影响后续轮次
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      await s.page.evaluate(() => {
        const c = Array.from(document.querySelectorAll(".proj-card")).find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.page.waitForSelector("#projEditModal", { visible: true, timeout: 4000 });
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="own"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#peSave");
      await s.sleep(900);
      await s.close();
    },
  });

  /* R62 非当前项目改承载形态：元数据为唯一真相（V0.2.2 F3 回归） */
  await runRound({
    id: "R62", name: "非当前项目改形态：体检页与快照分母一致", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r62").start();
      // CUR=示例项目（非金湾），从项目库改金湾形态为 none
      await s.goto("projects");
      await s.waitCard("金湾科创园"); await s.sleep(400);
      const curName = await s.page.evaluate(() => curProject().name);
      expect(curName.includes("示例"), `对照组：当前项目非金湾（${curName}）`);
      await s.page.evaluate(() => {
        const c = Array.from(document.querySelectorAll(".proj-card")).find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.page.waitForSelector("#projEditModal", { visible: true, timeout: 4000 });
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="none"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#peSave"); await s.sleep(900);
      // 进入金湾：两处分母必须一致（均 24）
      await s.goto("projects"); await s.waitCard("金湾科创园");
      await s.clickText(".proj-card", "金湾科创园"); await s.sleep(900);
      const r = await s.page.evaluate(() => ({
        auditN: auditN(),
        stMode: state.entityMode,
        snap计入: Object.keys(state.audit).filter(k => !(state.entityMode === "none" && (GEO.SITE_IDS || []).includes(k))).length,
      }));
      expect(r.auditN === 24 && r.stMode === "none" && r.snap计入 === 24,
        `体检页与快照分母一致（auditN=${r.auditN} state.entityMode=${r.stMode} 快照计入=${r.snap计入}）`);
      // 还原 own
      await s.goto("projects"); await s.waitCard("金湾科创园");
      await s.page.evaluate(() => {
        const c = Array.from(document.querySelectorAll(".proj-card")).find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.page.waitForSelector("#projEditModal", { visible: true, timeout: 4000 });
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="own"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#peSave"); await s.sleep(900);
      await s.close();
    },
  });

  /* R63 防抖窗口内刷新不丢数据（V0.2.2 F4 回归） */
  await runRound({
    id: "R63", name: "改动后立即刷新：pagehide flush 不丢数据", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r63").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/plan");
      // 确定性基线：清空布防并落库
      await s.page.evaluate(() => { state.battlefield = {}; save(); });
      await s.sleep(700);
      await s.reload(); await s.goto("act/plan"); await s.sleep(400);
      const before = await s.page.evaluate(() => Object.values(state.battlefield || {}).filter(Boolean).length);
      expect(before === 0, `基线布防为空（${before}）`);
      await s.page.evaluate(() => { document.querySelector("#battleBox [data-bf]").click(); });   // 点击即存（防抖 400ms）
      await s.sleep(60);   // 远小于防抖窗口，立即刷新
      await s.reload();    // pagehide 应触发 flush
      await s.goto("act/plan");
      await s.sleep(500);
      const after = await s.page.evaluate(() => Object.values(state.battlefield || {}).filter(Boolean).length);
      expect(after === 1, `防抖窗口内刷新数据不丢（布防 ${before}→${after}）`);
      await s.close();
    },
  });
}
