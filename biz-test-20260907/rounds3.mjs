/* C 组：执行三子页（R27–R35）——优化文件/90天方案/AI助手 */
import { runRound } from "./harness.mjs";

export const AREA = "执行";

const enterProj = async (s, name) => {
  await s.goto("projects");
  await s.waitCard(name);
  await s.clickText(".proj-card", name);
  await s.sleep(800);
};

export async function runAreaC(browser, ROOT) {
  const { Session } = await import("./harness.mjs");

  /* R27 一键优化文件（有官网项目 7 件） */
  await runRound({
    id: "R27", name: "优化文件：有官网 7 件+下载登记资产追踪", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r27").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/toolkit");
      expect((await s.val("#tkPark")).includes("金湾"), "园区名预填当前项目");
      // 城市留空校验
      const city = await s.val("#tkCity");
      if (!city) {
        await s.click("#tkBuild");
        expect((await s.toast("必填")) !== null, "城市/产业缺失时提示补项目设置");
      }
      await s.fill("#tkCity", "珠海金湾");
      await s.fill("#tkIndustry", "生物医药、智能制造");
      await s.click("#tkBuild");
      await s.sleep(600);
      const files = await s.txtAll("#tkOut .card h3");
      expect(files.length === 7, `有官网生成 7 件物料（实际 ${files.length}）`);
      const joined = files.join("|");
      expect(joined.includes("robots") && joined.includes("llms") && joined.includes("结构化数据"), "官网三件（robots/llms/schema）在列");
      expect(joined.includes("一园一档") && joined.includes("FAQ") && joined.includes("地图") && joined.includes("渠道分发"), "通用四件在列");
      // JSON-LD 校验通过 → 无禁用标
      expect(!(await s.exists("#tkOut .tag.tag-bad")), "结构化数据通过 JSON-LD 本地校验（可下载）");
      // 下载第一件 → 资产追踪登记
      await s.page.evaluate(() => { document.querySelector("#tkOut [data-tkdl]").click(); });
      await s.sleep(400);
      const dl = await s.dl();
      expect(dl.length >= 1 && dl[dl.length - 1].f.includes("金湾科创园"), "下载文件名含项目名");
      const watch = await s.txt("#watchBox");
      expect(watch.includes("部署 20") || /\d{4}-\d{2}-\d{2}/.test(watch), "下载即登记资产追踪（含部署日期）");
      await s.close();
    },
  });

  /* R28 优化文件（无官网项目 5 件） */
  await runRound({
    id: "R28", name: "优化文件：无官网 5 件（百科/地图/公众号）", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r28").start();
      await enterProj(s, "测试大厦");
      await s.goto("act/toolkit");
      await s.fill("#tkCity", "深圳南山");
      await s.fill("#tkIndustry", "商务办公");
      await s.click("#tkBuild");
      await s.sleep(600);
      const files = (await s.txtAll("#tkOut .card h3")).join("|");
      expect(files.includes("百科词条更新稿") && files.includes("公众号版") && files.includes("地图信息核对清单"), "无官网出百科/公众号/地图实体物料");
      expect(!files.includes("robots") && !files.includes("结构化数据"), "不出官网部署三件（无假域名）");
      const help = await s.txt("#tkHelpLine");
      expect(help.includes("5") && help.includes("品宣自己"), "说明文案与物料件数一致（5 件）");
      // 楼宇语境
      const body = await s.txt("#tkOut");
      expect(body.includes("商务楼宇") || body.includes("写字楼"), "lite 档位用楼宇语境（venueNoun）");
      await s.close();
    },
  });

  /* R29 物料取数：口径表数值进入物料 */
  await runRound({
    id: "R29", name: "物料取数：口径表数字进百科稿/一园一档", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r29").start();
      await enterProj(s, "测试大厦");
      // 先填口径锚定字段
      await s.goto("diag/caliber");
      await s.page.evaluate(() => {
        const set = (field, v) => {
          const i = state.caliber.findIndex(r => r.field === field);
          if (i >= 0) state.caliber[i].official = v;
        };
        set("实体全称", "测试大厦（深圳）有限公司载体");
        set("租金区间", "120-180元/㎡/月");
        set("入驻率", "92%");
      });
      await s.goto("act/toolkit");
      await s.fill("#tkCity", "深圳南山");
      await s.fill("#tkIndustry", "商务办公");
      await s.click("#tkBuild");
      await s.sleep(600);
      const out = await s.txt("#tkOut");
      expect(out.includes("120-180元"), "口径表租金区间进入物料", {
        sev: "P2", detail: "lite（楼宇）档位的口径骨架字段（租金区间/入驻率/楼层数等）不被物料生成器消费——genBaikeDraft/一园一档/FAQ 模板只读 park 档字段名（面积/入驻企业数/产业聚集度），一园一档「租金区间」行硬编码【待填】。楼宇项目最关键的租金数据填了也不进物料",
        evidence: "tkOut 无 120-180元",
      });
      expect(out.includes("92%"), "口径表入驻率进入物料", { sev: "P2", detail: "同上：lite 档位字段未被模板消费", evidence: "tkOut 无 92%" });
      expect(out.includes("测试大厦（深圳）有限公司载体"), "锚定区实体全称进入百科稿");
      expect(out.includes("【待填"), "未填字段保留【待填】占位（不编造）");
      await s.close();
    },
  });

  /* R30 资产追踪：URL 补填与查排名守卫 */
  await runRound({
    id: "R30", name: "资产追踪：补 URL/无探针守卫/删除", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r30").start();
      await enterProj(s, "金湾科创园");
      // 确定性：清掉历史轮次登记的资产与探针（否则查排名守卫被旧数据短路）
      await s.page.evaluate(() => { state.watchPages = []; state.probes = []; save(); });
      await s.sleep(700);
      await s.goto("act/toolkit");
      await s.fill("#tkCity", "珠海金湾");
      await s.fill("#tkIndustry", "生物医药");
      await s.click("#tkBuild");
      await s.sleep(500);
      await s.page.evaluate(() => { document.querySelector("#tkOut [data-tkdl]").click(); });
      await s.sleep(300);
      // 未补 URL 直接查排名
      await s.page.evaluate(() => { document.querySelector("[data-wpchk]").click(); });
      expect((await s.toast("先补该物料的部署 URL")) !== null, "未补 URL 查排名被拦截并指引");
      // 补 URL 保存
      await s.page.evaluate(() => {
        const inp = document.querySelector("[data-wp]");
        inp.value = "https://www.new-carrier.cn/park";
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await s.sleep(500);
      expect((await s.toast("URL 已保存")) !== null, "部署 URL 保存");
      // 无 ≤7 天探针 → 拦截（本项目没跑过30问）
      await s.page.evaluate(() => { document.querySelector("[data-wpchk]").click(); });
      const t = await s.toast("");
      expect(t && (t.includes("探针") || t.includes("30问")), "无近期探针数据时指引先跑30问");
      await s.close();
    },
  });

  /* R31 渠道分发图 11 卡 */
  await runRound({
    id: "R31", name: "渠道分发图：11 卡+入口链接+项目名替换", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r31").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/toolkit");
      const cards = await s.count("#channelBox .agent-card");
      expect(cards === 11, `渠道卡 11 张（实际 ${cards}）`);
      const hrefs = await s.page.$$eval("#channelBox a[href]", (as) => as.map(a => a.getAttribute("href")));
      expect(hrefs.length === 11 && hrefs.every(h => /^https?:\/\//.test(h)), "每卡有真实 http(s) 入口链接");
      const txt = await s.txt("#channelBox");
      expect(txt.includes("金湾科创园"), "首发内容含本项目名（模板替换）");
      expect(!txt.includes("蛇口网谷"), "无种子项目名残留");
      await s.close();
    },
  });

  /* R32 内容选题单 */
  await runRound({
    id: "R32", name: "内容选题单：场景生成/下载/空口径占位", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r32").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/toolkit");
      await s.pick("#briefCluster", "对比竞品");
      await s.click("#briefGen");
      await s.sleep(300);
      const out = await s.txt("#briefOut");
      expect(out.includes("内容选题单") && out.includes("对比竞品"), "选题单按场景生成");
      expect(out.includes("P") && out.length > 200, "覆盖问题列表来自问题矩阵");
      await s.click("#briefDl");
      const dl = await s.dl();
      expect(dl.length >= 1 && dl[dl.length - 1].f.includes("对比竞品"), "下载文件名含场景");
      // 复制按钮（未生成时提示 → 已生成复制成功）
      await s.click("#briefCopy");
      expect((await s.toast("已复制")) !== null, "复制选题单");
      await s.close();
    },
  });

  /* R33 90 天方案 */
  await runRound({
    id: "R33", name: "90天方案：预填/差距联动/布防持久", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r33").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/plan");
      expect((await s.val("#pName")).includes("金湾"), "园区名默认当前项目");
      await s.click("#pRun");
      await s.sleep(400);
      const md = await s.txt("#planPreview");
      expect(md.includes("# 金湾科创园"), "方案标题含项目名");
      expect(md.includes("现状差距") || md.includes("优先补齐"), "方案含体检差距（联动体检数据）");
      await s.click("#planDl");
      const dl = await s.dl();
      expect(dl.length >= 1 && dl[dl.length - 1].f.includes("行动方案"), "下载方案 .md");
      // 布防清单点击切换
      const bf0 = await s.txt("#battleBar");
      await s.page.evaluate(() => { document.querySelector("#battleBox [data-bf]").click(); });
      await s.sleep(300);
      const bf1 = await s.txt("#battleBar");
      expect(bf0 !== bf1, `渠道铺设进度切换（${bf0}→${bf1}）`);
      await s.sleep(700);   // 等 400ms 防抖 serverSave 落库后再刷新
      await s.reload();
      await s.goto("act/plan");
      const bf2 = await s.txt("#battleBar");
      expect(bf2 === bf1, "布防状态持久化", {
        sev: "P2", detail: "点击类保存走 400ms 防抖：防抖窗口内刷新页面，本地新值尚未上传，loadProjectFromServer 会用服务器旧态整包覆盖——最后一次点击改动丢失（影响所有点击即存的轻量状态：布防/工单五因子/清单打分）",
        evidence: `刷新前=${bf1} 刷新后=${bf2}`,
      });
      await s.close();
    },
  });

  /* R34 Agent 提示词：非种子项目本地化 */
  await runRound({
    id: "R34", name: "Agent 提示词：本地化替换+复制", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r34").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/agent");
      expect((await s.count("#agentGrid .agent-card")) === 4, "4 张 Agent 卡");
      await s.page.evaluate(() => { document.querySelector("#agentGrid [data-agent]").click(); });
      await s.sleep(300);
      expect(await s.visible("#agentDetail"), "提示词详情展开");
      const prompt = await s.txt("#agentPrompt");
      expect(prompt.length > 100, "提示词内容完整");
      expect(!prompt.includes("蛇口网谷"), "非种子项目提示词无蛇口网谷残留（seedLocalize）");
      await s.click("#agentCopy");
      expect((await s.toast("已复制")) !== null, "复制提示词");
      await s.close();
    },
  });

  /* R35 对话助手：打开+知识库 FAQ 命中 */
  await runRound({
    id: "R35", name: "对话助手：打开窗口+FAQ 问答", area: AREA,
    fn: async ({ expect, note }) => {
      const s = await new Session(browser, ROOT, "r35").start();
      await enterProj(s, "金湾科创园");
      await s.goto("act/agent");
      await s.click("#openChatBtn");
      await s.sleep(800);
      expect(await s.visible("#chatPanel, .chat-panel").catch(() => false) || await s.visible("#chatTa"), "助手对话窗打开");
      await s.fill("#chatTa", "这个系统怎么用？");
      await s.click("#chatSend");
      await s.sleep(9000);   // 本机模型/KB 响应
      const msgs = await s.count(".chat-msg");
      expect(msgs >= 2, `提问后有 AI 回复气泡（.chat-msg×${msgs}）`);
      const aiTxt = await s.txtAll(".chat-msg.ai").then(a => a.join(" ").slice(0, 200));
      expect(aiTxt.length > 10, `回复非空（${aiTxt.slice(0, 60)}…）`);
      note("回复摘要: " + aiTxt.slice(0, 80));
      await s.close();
    },
  });
}
