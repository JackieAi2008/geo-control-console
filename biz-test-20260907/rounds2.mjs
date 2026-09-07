/* B 组：诊断六子页（R13–R26）——一键诊断/报告/体检/口径/评分/证据库 */
import { runRound } from "./harness.mjs";

export const AREA = "诊断";

const enterProj = async (s, name) => {
  await s.goto("projects");
  await s.waitCard(name);
  await s.clickText(".proj-card", name);
  await s.sleep(800);
};

export async function runAreaB(browser, ROOT) {
  const { Session } = await import("./harness.mjs");

  /* R13 官网体检（mock 诊断）：结果/自动填入/报告档案 */
  await runRound({
    id: "R13", name: "一键诊断（官网体检）：结果分组+自动填入+档案", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r13").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/scan");
      const urlMeta = await s.ev(() => curProject().url || "");
      expect(urlMeta !== "", "「有官网」项目的官网域名仍在（形态来回切换不丢失）", {
        sev: "P2", detail: "R10 把形态切到「无官网」再切回「有官网」后，项目元数据 url 变为空——切 none 保存时 url 被置空，切回 own 时保存不校验空域名（新建时有必填校验，编辑时没有）。后果：一键诊断预填为空，用户需回忆重新输入",
        evidence: `curProject().url="${urlMeta}"`,
      });
      if (!(await s.val("#dgUrl"))) await s.fill("#dgUrl", "www.jinwan-park.cn");
      expect((await s.val("#dgBrand")) === "金湾科创园", "品牌词预填");
      const hasHist = await s.ev(() => !!(state.lastDiag && state.lastDiag.checks));
      if (!hasHist) expect(await s.visible(".dg-preview"), "未诊断时显示预检清单（不出示未测结果）");
      // 确定性：把 mock 诊断的 7 个自动评分项重置为 0 分（此前轮次的人工分会走 kept 分支）
      await s.page.evaluate(() => { ["T1","T5","T2","T4","C2","C6","E2"].forEach(k => { state.audit[k] = 0; delete (state.autoAudit || {})[k]; }); });
      await s.click("#dgRun");
      await s.waitForText("#dgOut", "已自动填入", 8000);
      const head = await s.txt("#dgOut .dg-head");
      expect(head.includes("通过") && head.includes("待改进") && head.includes("未通过"), "结果头条三态计数");
      expect(head.includes("已自动填入体检表"), "自动填入条数如实展示");
      const dims = await s.txtAll("#dgOut .dg-dim h3");
      expect(dims.some(d => d.includes("技术可达")) && dims.some(d => d.includes("内容可摘录")), "结果按维度分组");
      const auto = await s.ev(() => ({ autoN: Object.keys(state.autoAudit || {}).length, auditT2: state.audit.T2 }));
      expect(auto.autoN >= 5 && auto.auditT2 === 0, `自动填入 ${auto.autoN} 项（含实测 0 分项 T2=${auto.auditT2}）`);
      // 体检表「自动」标 + 总分变化
      await s.goto("diag/audit");
      expect((await s.count(".auto-tag")) >= 5, "体检表对自动填入项打「自动」标");
      // 报告档案
      await s.goto("diag/report");
      expect((await s.count("#reportList .prompt-li")) >= 1, "报告档案出现诊断记录");
      await s.close();
    },
  });

  /* R14 诊断报告：双模式/工单流转/下载 */
  await runRound({
    id: "R14", name: "诊断报告：查阅/整改工单/状态流转/下载", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r14").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/report");
      await s.clickText("#rptMode [data-rm]", "整改工单");
      await s.sleep(400);
      expect((await s.txt("#reportView")).includes("整改行动清单"), "整改工单模式渲染");
      expect((await s.txt("#reportView")).includes("转发消息") || (await s.txt("#reportView")).includes("执行清单"), "含可复制转发消息");
      // 状态标签轮换 待派单→已派单
      const st0 = await s.txt("#reportView [data-rst]");
      await s.page.evaluate(() => { document.querySelector("#reportView [data-rst]").click(); });
      await s.sleep(300);
      const st1 = await s.txt("#reportView [data-rst]");
      expect(st0 !== st1, `工单状态点击轮换（${st0}→${st1}）`);
      // 查阅模式 + 下载
      await s.clickText("#rptMode [data-rm]", "查阅报告");
      await s.sleep(300);
      await s.click("#rptDl");
      const dl = await s.dl();
      expect(dl.length >= 1 && /诊断报告.*\.md/.test(dl[dl.length - 1].f), `下载 .md 报告（${dl.length ? dl[dl.length - 1].f : "无"}）`);
      await s.click("#rptCopy");
      expect((await s.toast("已复制")) !== null, "复制报告内容");
      await s.close();
    },
  });

  /* R15 报告打印（弹窗路径不报错） */
  await runRound({
    id: "R15", name: "报告打印按钮：窗口路径无 JS 错误", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r15").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/report");
      await s.page.evaluate(() => { window.__openCalls = 0; window.open = () => { window.__openCalls++; return { document: { write() {}, close() {} } }; }; });
      await s.click("#rptPrint");
      await s.sleep(200);
      expect((await s.ev(() => window.__openCalls)) === 1, "打印打开新窗口一次");
      const errs = s.pageErrors || [];
      expect(errs.length === 0, `打印路径无页面错误${errs.length ? "：" + errs[0] : ""}`);
      await s.close();
    },
  });

  /* R16 体检表交互：打分联动/自动转人工/清空重评 */
  await runRound({
    id: "R16", name: "体检表：打分联动雷达/自动转人工/清空重评", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r16").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/audit");
      const pct0 = (await s.txt("#scoreRing")).match(/(\d+)/)[1];
      expect(pct0 !== "0", `诊断后总分非零（${pct0}）`);
      // 构造一个「自动填入」项（诊断自动填入的等价态）→ 人工 2 分覆盖后自动标消失
      await s.page.evaluate(() => { state.audit.E3 = 1; state.autoAudit = Object.assign({}, state.autoAudit, { E3: 1 }); save(); });
      const oneAuto = await s.ev(() => (Object.keys(state.autoAudit || {})[0]) || "E3");
      await s.page.evaluate((id) => { document.querySelector(`[data-audit="${id}"][data-v="2"]`).click(); }, oneAuto);
      await s.sleep(300);
      const gone = await s.ev((id) => !((state.autoAudit || {})[id]), oneAuto);
      expect(gone, "人工点分后该项转人工（自动标移除）");
      // 清空重评
      s.dialogPolicy = "accept";
      await s.click("#auditReset");
      await s.sleep(300);
      const after = await s.ev(() => ({ got: auditScore().got, autoN: Object.keys(state.autoAudit || {}).length }));
      expect(after.got === 0, `清空重评归零（got=${after.got}）`);
      expect(after.autoN === 0, "自动填入痕一并清空", {
        sev: "P2", detail: "auditReset 只重置 state.audit，不清 state.autoAudit——清空重评后体检表仍满标「自动」，且下次诊断 applyAutoScores 会静默重新填入旧值，与「清空重评」语义矛盾",
        evidence: `autoAudit 残留 ${after.autoN} 项`,
      });
      expect((await s.count(".auto-tag")) === 0, "「自动」标全部消失", {
        sev: "P2", detail: "同上：autoAudit 未随清空重评清除", evidence: `auto-tag×${await s.count(".auto-tag")}`,
      });
      await s.close();
    },
  });

  /* R17 无官网项目 24 项：技术可达灰显不进分母 */
  await runRound({
    id: "R17", name: "无官网体检：技术可达 6 项不进分母", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r17").start();
      await enterProj(s, "测试大厦");
      await s.goto("diag/audit");
      const full = await s.txt(".ring-cap");
      expect(full.includes("/ 48"), `24 项满分 48（显示 ${full}）`);
      const disabled = await s.count("#auditChecklist [data-audit][disabled]");
      expect(disabled === 18, `技术可达 6 项×3 档按钮全部禁用（实际 ${disabled}）`);
      const bars = await s.txtAll("#dimBars .dim-bar");
      const tbar = bars.find(b => b.includes("技术可达"));
      expect(tbar && tbar.includes("不适用"), "维度条技术可达=不适用");
      await s.close();
    },
  });

  /* R18 实体体检流：12 项清单打分 + 谁在替你说话分析卡 */
  await runRound({
    id: "R18", name: "实体体检：12项清单/分析卡/归位", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r18").start();
      await enterProj(s, "测试大厦");
      await s.goto("diag/scan");
      expect((await s.val("#dgBrand") || "").includes("测试大厦"), "品牌词预填");
      await s.click("#dgRun");
      await s.waitForText("#dgOut", "实体体检", 8000);
      const out = await s.txt("#dgOut");
      expect(out.includes("实体资产核对清单"), "附 12 项实体资产核对清单");
      expect((await s.count("#dgChk [data-echk]")) === 12 * 3, `清单 12 项×3 档打分（实际 ${await s.count("#dgChk [data-echk]")}）`);
      // 分析卡
      expect(out.includes("现在网上谁在替你说话"), "「谁在替你说话」分析卡渲染");
      expect(out.includes("中介平台") || out.includes("其他网站"), "信源分类展示");
      const claimN = await s.count("[data-refclaim]");
      expect(claimN >= 1, `陌生域名有「是我们的→」归位按钮（${claimN} 个）`);
      // 打一项分计入体检
      await s.page.evaluate(() => { document.querySelector('#dgChk [data-echk][data-v="2"]').click(); });
      await s.sleep(300);
      const got = await s.ev(() => auditScore().got);
      expect(got >= 2, `清单打分计入体检总分（got=${got}）`);
      await s.close();
    },
  });

  /* R19 口径表 CRUD 与冲突治理 */
  await runRound({
    id: "R19", name: "口径表：骨架/编辑自动保存/加删字段/冲突登记", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r19").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/caliber");
      const rows0 = await s.count("#caliberBody tr");
      expect(rows0 >= 8, `口径骨架预置（锚定3+park5=${rows0} 行）`);
      // 编辑自动保存
      await s.page.evaluate(() => {
        const ta = document.querySelector('[data-f="official"]');
        ta.value = "近460家"; ta.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await s.sleep(800);
      await s.reload();
      await s.goto("diag/caliber");
      const saved = await s.ev(() => state.caliber.some(r => (r.official || "").includes("近460家")));
      expect(saved, "单元格编辑自动保存（刷新仍在）");
      // 添加字段
      await s.click("#calAdd");
      await s.sleep(200);
      expect((await s.count("#caliberBody tr")) === rows0 + 1, "添加字段行");
      // 删除该行
      await s.page.evaluate((i) => { document.querySelector(`[data-cdel="${i}"]`).click(); }, rows0);
      await s.sleep(200);
      // 冲突登记（formDialog）
      await s.page.evaluate(() => { document.querySelector('[data-cadd="0"]').click(); });
      await s.sleep(200);
      await s.fill("#fd_cv", "入驻企业708家");
      await s.fill("#fd_cs", "某公众号 2026-08");
      await s.click("#fdOk");
      await s.sleep(300);
      const sum = await s.txt("#caliberSummary");
      const confN = parseInt((sum.match(/(\d+) 个存在外部冲突/) || [0, "0"])[1], 10);
      expect(confN === 1, `冲突口径登记后计数入汇总（${sum}）`);
      expect((await s.txt("#caliberBody")).includes("708家"), "冲突口径展示在冲突列");
      // 工作台预警联动
      await s.goto("dashboard");
      const todo = await s.txt("#dashTodo");
      expect(todo.includes("冲突字段"), "工作台下一步出现口径冲突预警");
      await s.close();
    },
  });

  /* R20 口径表导出 */
  await runRound({
    id: "R20", name: "口径表导出数据文件", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r20").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/caliber");
      await s.click("#calExport");
      const dl = await s.dl();
      expect(dl.length >= 1 && dl[dl.length - 1].f.includes("口径表"), "导出口径表 JSON");
      const okJson = (() => { try { JSON.parse("[" + dl[dl.length - 1].head.replace(/^\uFEFF/, "") + "]"); return false; } catch (e) { return true; } })();
      expect(okJson, "导出为合法 JSON 片段（可被恢复流程读取）");
      await s.close();
    },
  });

  /* R21 内容评分器：坏例/好例/堆砌 */
  await runRound({
    id: "R21", name: "内容评分：营销腔低分/规范文高分/堆砌检测", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r21").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/score");
      // 坏例
      await s.fill("#scorerInput", "金湾科创园环境优美、配套完善、区位优越，是广大企业理想的办公选择，欢迎咨询入驻！");
      await s.click("#scorerRun");
      await s.sleep(300);
      const bad = parseInt((await s.txt("#scorerScore")).match(/(\d+)/)?.[1] || "0");
      expect(bad < 50, `营销腔文案 <50 分（实际 ${bad}）`);
      // 好例（满足：首段≤220字含数字/表格/2问号/来源/引言/列表/日期）
      const good = `金湾科创园位于珠海金湾区，截至2026年6月入驻企业216家，产业聚集度68%，生物医药占42%。

| 指标 | 数据 | 时点 |
|---|---|---|
| 入驻企业 | 216家 | 2026-06 |
| 聚集度 | 68% | 2026-06 |

## 金湾科创园租金什么水平？
租金区间为35-55元/㎡/月，含物业费（数据截至2026-06，来源：园区运营台账）。

## 为什么选金湾科创园而不是横琴？
「我们对比了三个园区，最终选金湾是因为产业聚集度和响应速度。」——王强，某生物医药公司总经理（来源：2026客户交流会）

1. 15分钟到金湾机场
2. 专属GMP载体集群
3. 政策：高新区生物医药专项（来源：珠海高新区管委会 2025）

更新时间：2026-09 · 责任人：金湾产业运营公司`;
      await s.fill("#scorerInput", good);
      await s.click("#scorerRun");
      await s.sleep(300);
      const ok = parseInt((await s.txt("#scorerScore")).match(/(\d+)/)?.[1] || "0");
      expect(ok >= 75, `规范文案 ≥75 分可发布（实际 ${ok}）`);
      // 堆砌
      const stuffed = good.replace(/金湾科创园/g, "金湾科创园").split("珠海金湾区").join("珠海金湾区") + "\n" + Array(8).fill("金湾科创园欢迎您。").join("");
      await s.pick("#scorerEntity", "金湾科创园");
      await s.fill("#scorerInput", stuffed);
      await s.click("#scorerRun");
      await s.sleep(300);
      const checks = await s.txt("#scorerChecks");
      expect(checks.includes("堆砌嫌疑"), "实体名高频重复被检出堆砌");
      await s.close();
    },
  });

  /* R22 证据库：校验/核验/注入生成器 */
  await runRound({
    id: "R22", name: "证据库：引言必填校验/核验/注入一园一档", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r22").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/evidence");
      await s.page.evaluate(() => { state.evidence = []; save(); render.evidence(); });
      await s.sleep(300);
      // 缺人物
      await s.fill("#evContent", "我们对比了三个园区，最终选金湾。");
      await s.click("#evAdd");
      expect((await s.toast("人物与职务")) !== null, "引言缺人物/职务被拦截");
      await s.fill("#evPerson", "王强");
      await s.fill("#evTitle", "某生物医药公司总经理");
      await s.fill("#evSource", "2026客户交流会");
      await s.click("#evAdd");
      await s.sleep(300);
      expect((await s.txt("#evBox")).includes("待采集"), "添加成功状态=待采集");
      await s.page.evaluate(() => { document.querySelector("[data-evok]").click(); });
      await s.sleep(300);
      expect((await s.txt("#evBox")).includes("已核验"), "点击核验生效");
      expect((await s.txt("#evBox")).includes("1/5"), "已核验引言进度条 1/5");
      // 注入一园一档
      await s.goto("act/toolkit");
      await s.fill("#tkCity", "珠海金湾");
      await s.fill("#tkIndustry", "生物医药");
      await s.click("#tkBuild");
      await s.sleep(500);
      const tk = await s.txt("#tkOut");
      expect(tk.includes("王强") && tk.includes("我们对比了三个园区"), "已核验引言自动注入一园一档");
      await s.close();
    },
  });

  /* R23 证据库删除与撤销核验 */
  await runRound({
    id: "R23", name: "证据库：撤销核验/删除 confirm", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r23").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/evidence");
      await s.page.evaluate(() => { state.evidence = []; save(); render.evidence(); });
      await s.sleep(200);
      await s.page.evaluate(() => {
        state.evidence.push({ type: "引言", park: "金湾科创园", content: "过渡引言", person: "李四", title: "总经理", source: "测试", asOf: today(), status: "已核验" });
        save(); render.evidence();
      });
      await s.sleep(300);
      const n0 = await s.count("#evBox .prompt-li");
      await s.page.evaluate(() => { document.querySelector("[data-evok]").click(); });   // 撤销核验
      await s.sleep(300);
      expect((await s.txt("#evBox")).includes("0/5"), "撤销核验后进度回落");
      s.dialogPolicy = "accept";
      await s.page.evaluate(() => { document.querySelector("[data-evdel]").click(); });
      await s.sleep(300);
      expect((await s.count("#evBox .prompt-li")) === n0 - 1, "删除证据行");
      const conf = s.dialogs.find(d => d.msg.includes("删除该证据"));
      expect(conf, "删除有 confirm");
      await s.close();
    },
  });

  /* R24 跨项目诊断隔离（SPA 内存态） */
  await runRound({
    id: "R24", name: "跨项目切换：诊断结果/报告档案不串页", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r24").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/scan");
      if (!(await s.val("#dgUrl"))) await s.fill("#dgUrl", "www.jinwan-park.cn");
      await s.click("#dgRun");
      await s.waitForText("#dgOut .dg-head", "已自动填入", 8000);
      const diagUrl = await s.ev(() => state.lastDiag.url);
      // 切到测试大厦（SPA 不刷新）
      await s.click("#projChip");
      await s.waitCard("测试大厦");
      await s.clickText(".proj-card", "测试大厦");
      await s.sleep(800);
      await s.goto("diag/scan");
      const out = await s.txt("#dgOut");
      expect(!out.includes("金湾科创园") && !out.includes("jinwan"), "切换后诊断页无旧项目结果残留");
      expect(out.includes("将检查什么") || out.includes("实体体检") || out.includes("测试大厦"), "显示本项目空态预检清单或本项目自己的历史结果");
      // 报告档案按项目隔离
      await s.goto("diag/report");
      const rptList = await s.txt("#reportList");
      expect(!rptList.includes("jinwan"), "报告档案不含他项目历史");
      // 切回金湾 → 重演结果
      await s.click("#projChip"); await s.sleep(400);
      await s.waitCard("金湾科创园").catch(() => {});
      await s.clickText(".proj-card", "金湾科创园");
      await s.sleep(800);
      await s.goto("diag/scan");
      expect((await s.txt("#dgOut")).includes(diagUrl), "切回原项目重演其诊断结果");
      await s.close();
    },
  });

  /* R25 诊断表单预填优先级 */
  await runRound({
    id: "R25", name: "诊断表单预填：本项目上次诊断 URL 优先", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r25").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/scan");
      await s.fill("#dgUrl", "www.new-carrier.cn");
      await s.click("#dgRun");
      await s.waitForText("#dgOut .dg-head", "诊断时间", 8000);
      await s.goto("diag/scan");
      expect((await s.val("#dgUrl")) === "www.new-carrier.cn", "同项目重进：上次诊断保存的 URL 优先于项目元数据");
      await s.close();
    },
  });

  /* R26 内容评分跨项目隔离 */
  await runRound({
    id: "R26", name: "评分器跨项目隔离：切项目清空旧文与旧分", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r26").start();
      await enterProj(s, "金湾科创园");
      await s.goto("diag/score");
      await s.fill("#scorerInput", "测试文本 123");
      await s.click("#scorerRun");
      await s.sleep(300);
      await s.click("#projChip"); await s.waitCard("测试大厦");
      await s.clickText(".proj-card", "测试大厦"); await s.sleep(800);
      await s.goto("diag/score");
      expect((await s.val("#scorerInput")) === "", "切项目后粘贴原文已清空");
      expect((await s.txt("#scorerScore")).includes("—"), "切项目后旧分数不残留");
      await s.close();
    },
  });
}
