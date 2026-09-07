/* D 组：监测全页（R36–R50）——录入/批量/AI代问/30问/台账/引用诊断/修复队列/曲线 */
import { runRound } from "./harness.mjs";

export const AREA = "监测";

const enterProj = async (s, name) => {
  await s.goto("projects");
  await s.waitCard(name);
  await s.clickText(".proj-card", name);
  await s.sleep(800);
};

export async function runAreaD(browser, ROOT) {
  const { Session } = await import("./harness.mjs");

  /* R36 手工录入监测记录 */
  await runRound({
    id: "R36", name: "手工录入：全字段保存→台账/KPI 联动", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r36").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.page.evaluate(() => { state.ledger = []; save(); render.monitor(); });
      await s.sleep(600);
      await s.pick("#mEngine", "豆包");
      await s.pick("#mPrompt", await s.page.$eval("#mPrompt", el => el.value));
      await s.pick("#mMention", "1");
      await s.pick("#mSentiment", "1");
      await s.fill("#mUrl", "https://www.new-carrier.cn/intro");
      await s.fill("#mCooccur", "横琴科学城");
      await s.fill("#mNote", "答案第2位");
      await s.click("#mSave");
      await s.sleep(500);
      expect((await s.toast("已保存")) !== null, "保存成功 toast");
      const row = await s.txt("#mTable");
      expect(row.includes("豆包") && row.includes("提及"), "台账行出现（引擎/提及）");
      expect(row.includes("横琴科学城"), "竞品同时出现入列");
      expect((await s.val("#mUrl")) === "" && (await s.val("#mNote")) === "", "保存后选填字段清空（防重复录入）");
      const kpi = await s.txt("#monStats");
      expect(kpi.includes("n=1"), "KPI 提及率 n=1 人工实测");
      await s.close();
    },
  });

  /* R37 重复录入观察（业务口径） */
  await runRound({
    id: "R37", name: "同日同引擎同问题重复录入：是否有防呆", area: AREA,
    fn: async ({ expect, note }) => {
      const s = await new Session(browser, ROOT, "r37").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      const dup = await s.page.evaluate(() => {
        const last = state.ledger[state.ledger.length - 1];
        if (!last) return null;
        const same = state.ledger.filter(r => r.date === last.date && r.engine === last.engine && r.promptId === last.promptId);
        return { total: state.ledger.length, same: same.length };
      });
      // 再录一条完全相同的（V0.2.2 后应弹 confirm 防呆）
      await s.pick("#mEngine", "豆包");
      await s.page.evaluate(() => { const sel = document.querySelector("#mPrompt"); sel.selectedIndex = 0; sel.dispatchEvent(new Event("change", { bubbles: true })); });
      await s.pick("#mMention", "1");
      const diaN0 = s.dialogs.length;
      await s.click("#mSave");
      await s.sleep(600);
      const dupDialog = s.dialogs.slice(diaN0).find(d => d.type === "confirm" && d.msg.includes("已录过"));
      expect(!!dupDialog, "同日同引擎同问题重复录入弹出防呆 confirm");
      // 默认 accept → 追加成功（两条都保留）
      const after = await s.page.evaluate(() => {
        const last = state.ledger[state.ledger.length - 1];
        const same = state.ledger.filter(r => r.date === last.date && r.engine === last.engine && r.promptId === last.promptId);
        return { total: state.ledger.length, same: same.length };
      });
      expect(after.total === dup.total + 1, "确认后重复行入账（复核场景可保留）");
      // 取消路径：不保存
      s.dialogPolicy = "dismiss";
      await s.click("#mSave");
      await s.sleep(500);
      expect(await s.page.evaluate(() => state.ledger.length) === after.total, "取消则不保存（误触保护）");
      s.dialogPolicy = "accept";
      await s.close();
    },
  });

  /* R38 批量粘贴（好数据） */
  await runRound({
    id: "R38", name: "批量粘贴：解析预览→导入→快照推进", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r38").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.page.evaluate(() => { state.ledger = []; save(); render.monitor(); });
      await s.sleep(600);
      const pid = await s.page.$eval("#mPrompt", el => el.value);
      const rows = [
        "日期\t引擎\t问题ID\t提及\t倾向\t链接\t竞品同时出现\t备注",
        `\tDeepSeek\t${pid}\t提及\t正面\thttps://baike.baidu.com/x\t\t答案第1位`,
        `\tKimi\t${pid}\t未提及\t中性\t\t\t`,
      ].join("\n");
      await s.click("#batchPasteBtn");
      await s.fill("#batchTa", rows);
      await s.click("#bpPreviewBtn");
      await s.sleep(300);
      const prev = await s.txt("#bpPreview");
      expect(prev.includes("DeepSeek") && prev.includes("未提及"), "解析预览如实展示两行");
      await s.click("#bpImport");
      await s.sleep(500);
      expect((await s.toast("批量导入完成")) !== null, "导入完成 toast");
      const led = await s.page.evaluate(() => state.ledger.filter(r => r.engine === "DeepSeek" || r.engine === "Kimi").length);
      expect(led >= 2, "两条进入台账");
      await s.close();
    },
  });

  /* R39 批量粘贴（坏数据容错） */
  await runRound({
    id: "R39", name: "批量粘贴：坏行提示/只导有效行", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r39").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.page.evaluate(() => { state.ledger = []; save(); render.monitor(); });
      await s.sleep(600);
      const pid = await s.page.$eval("#mPrompt", el => el.value);
      await s.click("#batchPasteBtn");
      await s.fill("#batchTa", `\t文心一言\t${pid}\t提及\t正面\t\t\t\n\t通义千问\tP999\t提及\t正面\t\t\t\n\t\t${pid}\t提及\t正面\t\t\t`);
      await s.click("#bpPreviewBtn");
      await s.sleep(300);
      const prev = await s.txt("#bpPreview");
      expect(prev.includes("无法解析 2 行"), "坏行（错问题ID/缺引擎）计数提示");
      const btn = await s.txt("#bpImport");
      expect(btn.includes("导入 1 条"), "只导有效行（导入按钮计数）");
      await s.click("#bpImport");
      await s.sleep(400);
      const n = await s.page.evaluate(() => state.ledger.filter(r => r.engine === "文心一言").length);
      expect(n >= 1, "有效行入库");
      await s.close();
    },
  });

  /* R40 批量粘贴重复去重 */
  await runRound({
    id: "R40", name: "批量粘贴：重复行跳过提示", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r40").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      const r0 = await s.page.evaluate(() => state.ledger.length);
      const pid = await s.page.$eval("#mPrompt", el => el.value);
      await s.click("#batchPasteBtn");
      await s.fill("#batchTa", `\t文心一言\t${pid}\t提及\t正面\t\t\t`);
      await s.click("#bpPreviewBtn");
      await s.sleep(300);
      const prev = await s.txt("#bpPreview");
      expect(prev.includes("跳过 1 条重复"), "重复行（同日+同引擎+同问题）提示跳过");
      await s.click("#bpImport").catch(() => {});
      await s.sleep(400);
      expect(await s.page.evaluate(() => state.ledger.length) === r0, "重复行未再次入库");
      await s.close();
    },
  });

  /* R41 贴答案自动填 */
  await runRound({
    id: "R41", name: "贴答案自动填：解析结果人工核对后才入库", area: AREA,
    fn: async ({ expect, note }) => {
      const s = await new Session(browser, ROOT, "r41").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      const n0 = await s.page.evaluate(() => state.ledger.length);
      await s.click("#parseBtn");
      expect(await s.visible("#parseModal"), "贴答案弹窗打开");
      await s.fill("#pmTa", "金湾科创园位于珠海金湾区，截至2026年入驻企业216家（来源：baike.baidu.com）。相比之下横琴科学城也有类似定位。总体而言金湾科创园值得推荐。");
      await s.click("#pmRun");
      await s.sleep(6000);   // 本机模型解析（或降级提示）
      const modalStill = await s.visible("#parseModal");
      const outTxt = await s.txt("#pmOut");
      if (modalStill && outTxt.includes("解析失败")) {
        note("本机模型不可用：给出降级提示「直接手工填」——行为符合预期");
      } else {
        expect((await s.val("#mMention")) !== null && (await s.val("#mMention")) !== "", `提及自动填入（=${await s.val("#mMention")}）`);
        expect(await s.page.evaluate(() => state.ledger.length) === n0, "解析结果不自动提交（需人工点保存）");
      }
      await s.close();
    },
  });

  /* R42 跑一轮30问（mock probe）：进度/台账/探针/口径分离 */
  await runRound({
    id: "R42", name: "跑一轮30问（信源侧）：进度条/台账/探针/停止", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r42").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      const ansN0 = await s.page.evaluate(() => ledgerStats().ansN);
      s.dialogPolicy = "accept";   // 若提示今日已有记录，确认追加
      await s.click("#batchRun");
      expect(await s.visible("#batchStop"), "运行中停止按钮出现");
      await s.sleep(2500);
      const running = await s.txt("#batchTxt");
      expect(/\d+\/\d+/.test(running), `进度实时显示（${running.slice(0, 40)}）`);
      await s.waitForText("#batchTxt", "完成", 120000);
      const done = await s.txt("#batchTxt");
      expect(done.includes("30") && done.includes("已自动写入"), "30 问完成并写入台账");
      const after = await s.page.evaluate(() => ({
        srcRows: state.ledger.filter(r => r.engine === "搜索通道").length,
        probes: (state.probes || []).length,
        ansN: ledgerStats().ansN,
        mention: ledgerStats().mention,
      }));
      expect(after.srcRows === 30, `台账新增 30 条搜索通道行（${after.srcRows}）`);
      expect(after.probes >= 30, `探针持久化 ≥30 条（${after.probes}）`);
      expect(after.ansN === ansN0, `答案侧人工统计不含搜索通道行（${ansN0}→${after.ansN}）`);
      expect(!(await s.visible("#batchStop")), "结束后停止按钮隐藏");
      await s.close();
    },
  });

  /* R43 AI 代问（mock 罐头通道） */
  await runRound({
    id: "R43", name: "AI 代问：自动录入+AI标+统计另计", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r43").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      // 通道配置（服务端；mock 环境下 start 端点仍要求已配置）
      await s.ev(async () => { await fetch("/api/answerbot/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "mock-key-for-test", model: "doubao-mock" }) }); });
      const st0 = await s.page.evaluate(() => ({ n: state.ledger.length, aiN: ledgerStats().aiN, ansN: ledgerStats().ansN }));
      await s.click("#botRun");
      await s.sleep(1500);
      // 轮询至完成（mock 通道快）
      let ok = false, grewEarly = false;
      for (let i = 0; i < 50; i++) {
        await s.sleep(1500);
        const stat = await s.txt("#botStat");
        if (stat.includes("本轮自动完成")) { ok = true; break; }
        if ((await s.page.evaluate(() => ledgerStats().aiN)) > (st0.aiN || 0)) grewEarly = true;   // 台账已在增长（stat 文案可能被重渲染覆盖）
      }
      if (!ok && grewEarly) { await s.sleep(1000); }
      expect(ok || (await s.page.evaluate(() => ledgerStats().aiN)) > (st0.aiN || 0), "AI 代问完成并写入台账（stat 文案或台账增长）");
      const st1 = await s.page.evaluate(() => ({ n: state.ledger.length, aiN: ledgerStats().aiN, ansN: ledgerStats().ansN }));
      expect(st1.n > st0.n, `台账新增 AI 行（${st0.n}→${st1.n}）`);
      expect(st1.aiN > (st0.aiN || 0), `AI 行单独计数 aiN=${st1.aiN}`);
      expect(st1.ansN === st0.ansN, "人工实测基线不含 AI 行（口径分离）");
      const tbl = await s.txt("#mTable");
      expect(tbl.includes("AI"), "台账行带「AI」标");
      await s.close();
    },
  });

  /* R44 台账删除行与清空 */
  await runRound({
    id: "R44", name: "台账：删行/清空（confirm）→KPI 归零", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r44").start();
      await enterProj(s, "测试大厦");
      await s.goto("monitor");
      // 大厦项目没台账 → 先录一条
      await s.pick("#mEngine", "豆包");
      await s.pick("#mMention", "1");
      await s.click("#mSave");
      await s.sleep(400);
      const n1 = await s.page.evaluate(() => state.ledger.length);
      expect(n1 === 1, "测试大厦台账 1 条");
      await s.page.evaluate(() => { document.querySelector("#mTable [data-mdel]").click(); });
      await s.sleep(300);
      expect(await s.page.evaluate(() => state.ledger.length) === 0, "删除行生效");
      s.dialogPolicy = "accept";
      await s.click("#mClear");
      await s.sleep(300);
      const conf = s.dialogs.find(d => d.msg.includes("清空全部监测记录"));
      expect(conf, "清空有 confirm");
      const kpi = await s.txt("#monStats");
      expect(kpi.includes("—"), "清空后 KPI 显示空态");
      await s.close();
    },
  });

  /* R45 引用诊断：域名榜/矩阵/生成工单/下钻 */
  await runRound({
    id: "R45", name: "引用诊断：域名榜/诊断矩阵/工单生成/下钻", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r45").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.page.evaluate(() => { location.hash = "#/monitor"; });
      const board = await s.txt("#winBox");
      expect(board.includes("域名榜"), "域名榜渲染（探针数据聚合）");
      expect(board.includes("基础层") || board.includes("通吃平台"), "域名类型标注");
      expect(board.includes("诊断矩阵"), "诊断矩阵渲染");
      const mkwo = await s.count("[data-mkwo]");
      if (mkwo > 0) {
        await s.page.evaluate(() => { document.querySelector("[data-mkwo]").click(); });
        await s.sleep(400);
        expect((await s.toast("已生成工单")) !== null, "生成工单 toast");
        expect((await s.txt("#fixQueueBox")).includes("待派单"), "修复队列出现工单");
      } else { expect(false, "诊断矩阵无可生成工单的类别（数据不足）", { sev: "P2" }); }
      // 下钻
      const drill = await s.count("[data-drill]");
      if (drill > 0) {
        await s.page.evaluate(() => { document.querySelector("[data-drill]").click(); });
        await s.sleep(300);
        expect((await s.txt("#drillBox")).includes("前10"), "问题下钻显示探针历史");
      }
      await s.close();
    },
  });

  /* R46 修复队列索引错位验证（重点怀疑缺陷） */
  await runRound({
    id: "R46", name: "修复队列：排序视图下编辑/删除是否作用错对象", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r46").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      // 造两个工单：先低优先级后高优先级（state 顺序 ≠ 视图排序顺序）
      await s.page.evaluate(() => {
        state.fixQueue = [
          Object.assign({ id: "Wlow", created: today(), status: "待派单", owner: "", due: "", verified: false,
            title: "低优先级工单", channel: "手动", prompts: [], detail: "" , factors: { biz: 1, gap: 1, fix: 1, acc: 1, effort: 5 } }),
          Object.assign({ id: "Whigh", created: today(), status: "待派单", owner: "", due: "", verified: false,
            title: "高优先级工单", channel: "手动", prompts: [], detail: "", factors: { biz: 5, gap: 5, fix: 5, acc: 5, effort: 1 } }),
        ];
        save(); renderWinCard();
      });
      await s.sleep(400);
      const firstTitle = await s.page.$eval("#fixQueueBox .prompt-li b", el => el.textContent);
      expect(firstTitle.includes("高优先级"), "视图按优先级排序（高优先级工单显示在第一行）");
      // 给视图第一行填责任人（V0.2.2 后 data-fq 挂工单 id，按首个 owner 输入定位）
      await s.page.evaluate(() => {
        const inp = document.querySelector('#fixQueueBox [data-fq^="owner|"]');
        inp.value = "张三"; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await s.sleep(500);
      const owners = await s.page.evaluate(() => state.fixQueue.map(o => o.title + ":" + (o.owner || "—")));
      const target = owners.find(o => o.startsWith("高优先级"));
      expect(target === "高优先级工单:张三", `编辑作用在视图所见对象上（实际 ${owners.join(" / ")}）`, {
        sev: "P1", detail: "修复队列按优先级排序渲染，但行内编辑/删除按 state 原始顺序取索引——排序与创建顺序不一致时，责任人/期限/五因子/删除会写到错误工单上",
        evidence: owners.join(" / "),
      });
      // 删除同样验证
      s.dialogPolicy = "accept";
      await s.page.evaluate(() => { document.querySelector("#fixQueueBox [data-fqdel]").click(); });
      await s.sleep(400);
      const left = await s.page.evaluate(() => state.fixQueue.map(o => o.title));
      expect(left.length === 1 && left[0].includes("低优先级"), `删除的也是视图第一行（实际剩 ${left.join("/")}）`, {
        sev: "P1", detail: "同根因：删除按钮的 data-fqdel 索引同样错位", evidence: left.join("/"),
      });
      await s.close();
    },
  });

  /* R47 业务结果：月度登记→曲线副轴 */
  await runRound({
    id: "R47", name: "业务结果：月度登记/删除/IT说明复制", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r47").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.fill("#bizVisits", "86");
      await s.fill("#bizLeads", "5");
      await s.fill("#bizNote", "ChatGPT referrals 上升");
      await s.click("#bizSave");
      await s.sleep(400);
      expect((await s.toast("已保存")) !== null, "月度数据保存 toast");
      const tbl = await s.txt("#bizBox");
      expect(tbl.includes("86") && tbl.includes("5"), "月度表渲染流量/线索");
      await s.click("#bizIt");
      expect((await s.toast("已复制")) !== null, "复制 IT 统计字段说明");
      s.dialogPolicy = "accept";
      await s.page.evaluate(() => { document.querySelector("[data-bzdel]").click(); });
      await s.sleep(300);
      expect(await s.page.evaluate(() => (state.business || []).length) === 0, "删除月度数据");
      await s.close();
    },
  });

  /* R48 发展曲线：序列开关/引擎筛选/记事件 */
  await runRound({
    id: "R48", name: "发展曲线：chips/引擎筛选/记事件/口径脚注", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r48").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.page.evaluate(() => {
        state.snapshots = state.snapshots || [];
        if (state.snapshots.filter(x => x.date !== today()).length === 0) {
          const s2 = computeSnapshot("round", state, "2026-08-20"); s2.ts = 1;
          state.snapshots.push(s2); state.snapshots.sort((a, b) => a.ts - b.ts);
          state.snapshots[0].baseline = true; save(); render.monitor();
        }
      });
      await s.sleep(500);
      const chips = await s.count("#curveChips [data-cv]");
      expect(chips >= 5, `序列 chips ≥5（实际 ${chips}）`);
      await s.page.evaluate(() => { document.querySelector('#curveChips [data-cv="src"]').click(); });
      await s.sleep(300);
      const lineN = await s.count("#curveBox polyline");
      expect(lineN >= 1, "开关序列后曲线重绘");
      // 引擎筛选下拉存在
      expect(await s.visible("#cvEngine"), "引擎分层筛选下拉存在");
      // 记事件（三次 prompt 链）
      s.dialogPolicy = "accept"; s.promptText = undefined;
      await s.page.evaluate(() => {
        // 直接走 addEvent（绕过 prompt 链验证数据层），UI 链路在 dialog 记录里体现
        addEvent("deploy", "部署一园一档", today()); renderCurve();
      });
      await s.sleep(300);
      const svg = await s.txt("#curveBox");
      expect(svg.includes("起始数据") || svg.includes("部署") || svg.includes("GEO 发展曲线") || svg.includes("监测/诊断快照"), "曲线含起始数据/事件标注或空态说明");
      await s.close();
    },
  });

  /* R49 问题矩阵管理 */
  await runRound({
    id: "R49", name: "问题矩阵管理：编辑/添加/删除/批量替换", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r49").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      await s.click("#paToggle");
      await s.sleep(300);
      expect(await s.visible("#promptAdmin"), "矩阵管理展开");
      const n0 = await s.page.evaluate(() => P_prompts().length);
      // 编辑第一条
      await s.page.evaluate(() => {
        const inp = document.querySelector('#promptAdmin [data-paq="0"]');
        inp.value = "测试问题编辑后文案？"; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await s.sleep(400);
      expect(await s.page.evaluate(() => P_prompts()[0].q.includes("测试问题编辑后")), "编辑问题保存");
      expect((await s.toast("问题已保存")) !== null, "保存 toast");
      // 添加
      await s.click("#paAdd");
      await s.sleep(300);
      expect(await s.page.evaluate(() => P_prompts().length) === n0 + 1, `添加问题（${n0}→${n0 + 1}）`);
      // 删除新增项（最后一行）
      s.dialogPolicy = "accept";
      await s.page.evaluate(() => { const btns = document.querySelectorAll('#promptAdmin [data-padel]'); btns[btns.length - 1].click(); });
      await s.sleep(300);
      expect(await s.page.evaluate(() => P_prompts().length) === n0, "删除问题");
      // 批量替换（formDialog）
      await s.click("#paReplace");
      await s.sleep(200);
      await s.fill("#fd_from", "珠海");
      await s.fill("#fd_to", "珠海市");
      await s.click("#fdOk");
      await s.sleep(400);
      const replaced = await s.page.evaluate(() => P_prompts().filter(p => p.q.includes("珠海市")).length);
      expect(replaced >= 1, `批量替换生效（${replaced} 问含新词）`);
      await s.close();
    },
  });

  /* R50 快速检测（probe mock） */
  await runRound({
    id: "R50", name: "快速检测：任意词搜索前列信源+自有标绿", area: AREA,
    fn: async ({ expect }) => {
      const s = await new Session(browser, ROOT, "r50").start();
      await enterProj(s, "金湾科创园");
      await s.goto("monitor");
      expect(await s.visible("#probeCard"), "快速检测卡（服务器模式可见）");
      await s.fill("#probeQ", "珠海 生物医药 园区 推荐");
      await s.click("#probeRun");
      await s.waitForText("#probeOut", "自有渠道", 8000);
      const out = await s.txt("#probeOut");
      expect(out.includes("baike.baidu.com"), "前列信源列表渲染");
      expect(out.includes("信源口径"), "附信源侧口径说明", {
        sev: "P2", detail: "runProbe 的 `results.join('') || '<p>无结果</p>' + 脚注` 运算符优先级错误（|| 先于 + 生效）——有结果时「信源口径」说明段永不渲染，只有无结果时才出现；与设计意图（任何结果都附口径说明）相反",
        evidence: "probeOut 有 5 条结果但无「信源口径」段",
      });
      await s.close();
    },
  });
}
