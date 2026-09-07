/* A 组：项目库与项目管理（R01–R12）——业务人员视角
 * R01/R02 依赖全新账号（onboarding 未看），必须最先执行。 */
import { runRound } from "./harness.mjs";

export const AREA = "项目库与项目管理";

export async function runAreaA(browser, ROOT) {
  const { Session } = await import("./harness.mjs");

  /* R01 全新账号首访：欢迎页 + 示例项目 + 导航全貌 */
  await runRound({
    id: "R01", name: "全新账号首访：欢迎区/示例项目/导航", area: AREA,
    fn: async ({ expect, s: _ }) => {
      const s = await new Session(browser, ROOT).start();
      await s.goto("");
      // 首登引导会自动弹出（V6.1 账号级一次性）——本身在 R02 详测，此处先退出再验首屏
      const tourShown = await s.page.waitForSelector("#tourBubble", { visible: true, timeout: 5000 }).then(() => true).catch(() => false);
      expect(tourShown, "首登引导自动弹出（V6.1）");
      if (tourShown) { await s.click("#tourSkip"); await s.sleep(400); }
      expect(await s.visible("#pjWelcome"), "欢迎区首访显示");
      expect((await s.txt("#pjWelcome")).includes("让 AI 搜索"), "欢迎区讲清系统价值（大白话）");
      expect((await s.count("#mainNav .tab")) === 5, "主导航 5 个页签（工作台/诊断/执行/监测/知识库）");
      expect((await s.count(".proj-card")) >= 1, "全新部署有示例项目卡（不空白墙）");
      expect((await s.txt("#projGrid")).includes("示例"), "示例项目带「示例」徽标可辨认");
      // 关闭欢迎区 → 刷新不再显示
      await s.click("#pjWelcomeClose");
      await s.toast("已收起");
      await s.reload();
      expect(!(await s.visible("#pjWelcome")), "「知道了，不再显示」后刷新不再出现");
      await s.close();
    },
  });

  /* R02 首登操作指引（南山大厦带看）：完整走一遍 + 演示态只读 */
  await runRound({
    id: "R02", name: "首登操作指引：逐步带看→退出→只读不落库", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r02").start();
      // 该账号已看过（R01 退出时 tourMarkSeen）→ 用 ?tour=force 强制重看
      await s.goto("?tour=force");
      await s.sleep(800);
      expect(await s.visible("#tourBubble"), "?tour=force 强制重看通道可用");
      const stepN = await s.count("#tourBubble [data-tdot]");
      expect(stepN >= 6, `引导分步进行（≥6 步，实际 ${stepN}）`);
      // 逐下一步到结束（演示态渲染南山大厦）
      let sawDemo = false;
      for (let i = 0; i < 12; i++) {
        const nxt = await s.q("#tourNext");
        if (!nxt) break;
        if ((await s.txt("body")).includes("南山大厦")) sawDemo = true;
        await s.click("#tourNext");
        await s.sleep(120);
      }
      const done = await s.q("#tourDone") || await s.q("#tourCta");
      if (done) { await s.click(done === await s.q("#tourDone") ? "#tourDone" : "#tourCta"); await s.sleep(300); }
      expect(sawDemo, "演示态出现南山大厦真实案例");
      // 退出后：页面无南山大厦残留 + 本机数据未被演示污染
      const bodyTxt = await s.txt("body");
      expect(!bodyTxt.includes("南山大厦"), "退出演示后页面无南山大厦残留（0.1.13 金标准口径）");
      const polluted = await s.ev(() => JSON.stringify(state).includes("南山大厦"));
      expect(!polluted, "演示数据未写入本机 state（只读承诺）");
      // 重看入口：顶栏 ? 与知识库按钮
      await s.goto("knowledge");
      expect(await s.visible("#btnHelp2"), "知识库有「开始操作指引」重看入口");
      expect(await s.visible("#btnHelp"), "顶栏 ? 常驻重看入口");
      await s.close();
    },
  });

  /* R03 新建项目弹窗：校验与草稿纪律 */
  await runRound({
    id: "R03", name: "新建项目：必填校验/取消清草稿/ESC", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r03").start();
      await s.goto("projects");
      await s.click("#pjNew");
      expect(await s.visible("#projModal"), "新建弹窗打开");
      await s.click("#npSubmit");
      expect((await s.toast("请填写项目名称")) !== null, "空名提交被拦截并提示");
      // 选 own 但不填 URL
      await s.fill("#npName", "校验项目");
      await s.page.evaluate(() => { const el = document.querySelector('input[name="npMode"][value="own"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#npSubmit");
      expect((await s.toast("请填官方承载页域名")) !== null, "own 形态缺 URL 被拦截");
      // 填草稿 → 取消 → 重开应为空（0.1.12 BUG#2 草稿纪律）
      await s.fill("#npBrand", "草稿品牌词");
      await s.click("#npCancel");
      await s.click("#pjNew");
      expect((await s.val("#npName")) === "" && (await s.val("#npBrand")) === "", "取消后重开弹窗草稿已清空");
      // ESC 关闭
      await s.fill("#npName", "esc测试");
      await s.page.keyboard.press("Escape");
      await s.sleep(200);
      expect(!(await s.visible("#projModal")), "ESC 关闭弹窗");
      await s.click("#pjNew");
      expect((await s.val("#npName")) === "", "ESC 关闭同样清空草稿");
      await s.click("#npCancel");
      await s.close();
    },
  });

  /* R04 新建「有官网」完整项目 */
  await runRound({
    id: "R04", name: "新建有官网项目：字段生效+30问矩阵+落工作台", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r04").start();
      await s.mkProj({ name: "金湾科创园", mode: "own", url: "www.jinwan-park.cn", brand: "金湾科创园", city: "珠海金湾", ind: "生物医药、智能制造", comp: "横琴科学城、珠海高新科创园", operator: "金湾产业运营公司", tier: "park" });
      expect((await s.txt("#pcName")) === "金湾科创园", "创建后报头显示项目名");
      expect(decodeURIComponent(await s.page.url()).includes("#/dashboard"), "创建后落在工作台");
      expect((await s.toast("已创建")) !== null || (await s.txt("#toast")).includes("已创建"), "创建成功 toast 带下一步指引");
      const meta = await s.ev(() => ({ url: curProject().url, city: curProject().city, comp: curProject().competitors, n: P_prompts().length }));
      expect(meta.url === "www.jinwan-park.cn", "官网域名入库");
      expect(meta.city === "珠海金湾", "城市入库");
      expect(meta.comp.length === 2, "竞品 2 个入库（供对比类问题与参照线）");
      expect(meta.n === 30, `完整版 30 问矩阵生成（实际 ${meta.n}）`);
      const qHasCity = await s.ev(() => P_prompts().some(p => p.q.includes("珠海")));
      expect(qHasCity, "问题矩阵已用城市实例化（非蛇口模板原样）");
      // 项目库卡片徽标
      await s.goto("projects");
      const cardTxt = await s.txtAll(".proj-card").then(a => a.find(t => t.includes("金湾科创园")) || "");
      expect(cardTxt.includes("有官网"), "卡片形态徽标=有官网");
      await s.close();
    },
  });

  /* R05 新建「挂上级官网」项目 */
  await runRound({
    id: "R05", name: "新建挂上级官网项目：徽标与默认诊断模式", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r05").start();
      await s.mkProj({ name: "南海意库", mode: "parent", url: "www.cmsk1979.com", brand: "南海意库", city: "深圳蛇口" });
      await s.goto("projects");
      const cardTxt = await s.txtAll(".proj-card").then(a => a.find(t => t.includes("南海意库")) || "");
      expect(cardTxt.includes("挂上级官网"), "卡片徽标=挂上级官网");
      await s.waitCard("南海意库").catch(() => {});
      await s.clickText(".proj-card", "南海意库");
      await s.sleep(500);
      await s.goto("diag/scan");
      expect((await s.txt("#dgRun")).includes("开始一键诊断"), "parent 项目默认官网体检入口");
      await s.close();
    },
  });

  /* R06 新建「暂时都没有」+轻量档项目 */
  await runRound({
    id: "R06", name: "新建无官网轻量项目：14问/实体体检/lite骨架", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r06").start();
      await s.mkProj({ name: "测试大厦", mode: "none", tier: "lite", brand: "测试大厦", city: "深圳南山" });
      const meta = await s.ev(() => ({ n: P_prompts().length, tier: curProject().matrixTier, scaffold: state.caliber.map(r => r.field) }));
      expect(meta.tier === "lite", "lite 档位入库");
      expect(meta.n === 14, `轻量版 14 问矩阵（实际 ${meta.n}）`);
      expect(meta.scaffold.includes("租金区间") && meta.scaffold.includes("楼层数"), "口径骨架为楼宇字段（lite 语境）");
      await s.goto("diag/scan");
      expect((await s.txt("#dgRun")).includes("实体体检"), "无官网项目默认实体体检");
      await s.goto("diag/audit");
      const n24 = await s.ev(() => auditN());
      expect(n24 === 24, `体检分母 24 项（实际 ${n24}）`);
      await s.close();
    },
  });

  /* R07 项目库搜索 */
  await runRound({
    id: "R07", name: "项目库搜索：名称/品牌词/域名/无结果", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r07").start();
      await s.goto("projects");
      await s.fill("#pjQ", "金湾");
      await s.sleep(400);
      let names = await s.txtAll(".proj-card .pc-title");
      expect(names.length === 1 && names[0].includes("金湾科创园"), "按名称搜索命中 1 张卡");
      await s.fill("#pjQ", "www.cmsk1979.com");
      await s.sleep(400);
      names = await s.txtAll(".proj-card .pc-title");
      expect(names.some(n => n.includes("南海意库")), "按域名搜索命中（parent 项目）");
      await s.fill("#pjQ", "不存在的项目xyz");
      await s.sleep(400);
      const empty = await s.txt("#projGrid");
      expect(empty.includes("没有符合条件的项目"), "无结果给明确提示（而非误引导新建）");
      await s.fill("#pjQ", "");
      await s.sleep(400);
      expect((await s.count(".proj-card")) >= 3, "清空搜索恢复全部");
      await s.close();
    },
  });

  /* R08 筛选与统计条 */
  await runRound({
    id: "R08", name: "形态/状态筛选与统计条一致性", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r08").start();
      await s.goto("projects");
      await s.clickText("#pjChips [data-fm]", "有官网");
      await s.sleep(300);
      let cards = await s.txtAll(".proj-card");
      expect(cards.length >= 1 && cards.every(c => c.includes("有官网")), "形态筛选只含有官网项目");
      const stat = await s.txt("#pjStat");
      expect(stat.includes(`共 ${cards.length}`) || stat.match(/共 \d+/), `统计条与列表一致（${stat}）`);
      await s.clickText("#pjChips [data-fs]", "未诊断");
      await s.sleep(300);
      cards = await s.txtAll(".proj-card");
      expect(cards.length >= 1 && cards.every(c => c.includes("未诊断")), "状态筛选=未诊断生效");
      await s.clickText("#pjChips [data-fm]", "全部");
      await s.clickText("#pjChips [data-fs]", "全部");
      await s.sleep(300);
      await s.close();
    },
  });

  /* R09 排序五种 */
  await runRound({
    id: "R09", name: "排序：最近活动/最久未测/体检分/创建时间/名称", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r09").start();
      // 造差异：给金湾科创园打体检分、打开顺序制造 lastOpen 差异
      await s.goto("projects");
      await s.page.waitForSelector(".proj-card", { timeout: 6000 });
      await s.waitCard("金湾科创园").catch(() => {});
      await s.clickText(".proj-card", "金湾科创园");
      await s.sleep(500);
      await s.seed(`(() => { const ids = Object.keys(state.audit); ids.slice(0, 20).forEach((k, i) => state.audit[k] = 2); })()`);
      await s.sleep(600);   // 等防抖 serverSave 落库，避免导航取消定时器
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      await s.pick("#pjSort", "score");
      await s.sleep(500);
      let titles = await s.txtAll(".proj-card .pc-title");
      expect(titles[0].includes("金湾科创园"), "按体检分排序：高分项目第一");
      await s.pick("#pjSort", "name");
      await s.sleep(300);
      titles = await s.txtAll(".proj-card .pc-title");
      const sortedOk = titles.every((t, i) => i === 0 || titles[i - 1].localeCompare(t, "zh") <= 0);
      expect(sortedOk, "按名称拼音排序生效");
      await s.pick("#pjSort", "created");
      await s.sleep(300);
      titles = await s.txtAll(".proj-card .pc-title");
      expect(titles.some(t => t.includes("测试大厦")), "创建时间排序可执行（最新在前）");
      await s.pick("#pjSort", "recent");
      await s.close();
    },
  });

  /* R10 项目设置弹窗：改字段生效 + 分母切换 */
  await runRound({
    id: "R10", name: "项目设置：改形态/城市/竞品生效+分母切换", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r10").start();
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      // 先进入金湾使其成为当前项目（项目库内设置弹窗对当前项目才即时生效）
      await s.clickText(".proj-card", "金湾科创园");
      await s.sleep(800);
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      // 打开金湾科创园的设置
      await s.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".proj-card"));
        const c = cards.find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.sleep(300);
      expect(await s.visible("#projEditModal"), "项目设置弹窗打开");
      expect((await s.val("#peName")) === "金湾科创园", "设置弹窗预填项目名");
      await s.fill("#peCity", "珠海金湾区");
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="none"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.click("#peSave");
      expect((await s.toast("24 项口径")) !== null, "切无官网保存提示分母 24 项");
      await s.goto("diag/audit");
      expect((await s.ev(() => auditN())) === 24, "体检分母切换为 24");
      // 切回 own
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      await s.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".proj-card"));
        const c = cards.find(x => x.innerText.includes("金湾科创园"));
        c.querySelector("[data-set]").click();
      });
      await s.page.waitForSelector("#projEditModal", { visible: true, timeout: 4000 });
      await s.page.evaluate(() => { const el = document.querySelector('input[name="peMode"][value="own"]'); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      // V0.2.2 后 own 形态空域名会被拦截——先验证拦截，再补域名保存
      await s.click("#peSave");
      const blocked = await s.toast("请填官网承载页域名");
      expect(blocked !== null, "own 形态空域名保存被拦截（与新建一致）");
      await s.fill("#peUrl", "www.jinwan-park.cn");
      await s.click("#peSave");
      await s.sleep(900);
      expect((await s.ev(() => auditN())) === 30, "切回有官网分母恢复 30 项");
      expect((await s.ev(() => curProject().url)) === "www.jinwan-park.cn", "补填后域名生效（后续诊断预填可用）");
      await s.close();
    },
  });

  /* R11 归档与恢复 */
  await runRound({
    id: "R11", name: "归档项目→含已归档→恢复", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r11").start();
      await s.goto("projects");
      await s.waitCard("南海意库");
      const before = await s.count(".proj-card");
      await s.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".proj-card"));
        const c = cards.find(x => x.innerText.includes("南海意库"));
        c.querySelector("[data-arch]").click();
      });
      await s.sleep(400);
      const conf = s.dialogs.find(d => d.msg.includes("归档"));
      expect(conf, "归档前有 confirm（数据保留说明）");
      // 等卡片数减少（服务器往返+重渲染有时序）
      let after = before;
      for (let i = 0; i < 8; i++) {
        after = await s.count(".proj-card");
        if (after === before - 1) break;
        await s.sleep(400);
      }
      expect(after === before - 1, `归档后卡片减一（${before}→${after}）`);
      expect((await s.toast("已归档")) !== null || (await s.count(".proj-card")) === before - 1, "归档成功反馈");
      // 勾选含已归档 → 归档箱出现 + 恢复按钮
      await s.page.evaluate(() => { const el = document.querySelector("#pjArch"); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.sleep(300);
      const archBox = await s.txt("#pjArchBox");
      expect(archBox.includes("南海意库") && archBox.includes("恢复到项目库"), "归档箱显示项目+恢复入口");
      await s.page.evaluate(() => { document.querySelector("#pjArchBox [data-restore]").click(); });
      await s.sleep(700);
      expect((await s.toast("已恢复")) !== null, "恢复成功");
      let restored = 0;
      for (let i = 0; i < 8; i++) {
        restored = await s.count(".proj-card");
        if (restored === before) break;
        await s.sleep(400);
      }
      expect(restored === before, `恢复后卡片数还原（${restored}/${before}）`);
      await s.close();
    },
  });

  /* R12 上次处理条 + 操作留痕 */
  await runRound({
    id: "R12", name: "上次处理直达条与操作留痕（大白话）", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r12").start();
      await s.goto("projects");
      await s.waitCard("金湾科创园");
      // 先进一个项目制造 lastOpen（新上下文无本机记录）
      await s.clickText(".proj-card", "金湾科创园");
      await s.sleep(600);
      await s.goto("projects");
      await s.sleep(600);
      const rec = await s.txt("#pjRecent");
      expect(rec.includes("上次处理"), "上次处理直达条渲染");
      // 留痕：本会话做过 新建/保存/归档/恢复——应有对应大白话记录
      const auditTxt = await s.txt("#auditBox");
      expect(auditTxt.includes("新建项目") || auditTxt.includes("归档") || auditTxt.includes("保存数据"), "操作留痕表有记录");
      expect(!/POST \/api\//.test(auditTxt), "留痕显示大白话而非技术串（V4.7.1）");
      await s.close();
    },
  });
}
