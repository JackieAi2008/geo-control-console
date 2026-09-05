/* GEO智控台 V4.2 · 内置对话助手（真实调用本机Ollama/DeepSeek，经 /api/chat 流式返回；对话历史按项目隔离） */
"use strict";

const CHAT_SUGGEST = [
  "我是新手，教我怎么用这个系统",
  "解读我的一键诊断结果",
  "口径表里的冲突怎么治理？",
  "优化文件的6个文件怎么部署？",
  "30问监测下一步做什么？",
];

(function () {
  /* V4.2：历史记录键跟随当前项目——切换项目互不可见，避免跨项目上下文串味 */
  const chatKey = () => "geodesk.chat.v1." + ((typeof CUR !== "undefined" && CUR) ? CUR : "local");
  let history = [];
  function loadHistory() {
    history = [];
    try { history = JSON.parse(localStorage.getItem(chatKey()) || "[]"); } catch (e) {}
  }
  loadHistory();

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function clean(t) { return t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\n]+/, ""); }

  function inject() {
    if ($("#chatPanel")) return;
    const fab = document.createElement("button");
    fab.id = "chatFab"; fab.className = "chat-fab"; fab.setAttribute("aria-label", "打开GEO使用助手");
    fab.innerHTML = "问";
    const panel = document.createElement("div");
    panel.id = "chatPanel"; panel.className = "chat-panel"; panel.hidden = true;
    panel.innerHTML = `
      <div class="chat-head">
        <div><b>GEO 使用助手</b><span class="chat-model" id="chatModel">本地模型</span></div>
        <div><button class="chat-x" id="chatClear" title="清空对话">清空</button>
        <button class="chat-x" id="llmCfgBtn" title="配置我的 AI 模型">⚙</button>
        <button class="chat-x" id="chatClose" title="收起">×</button></div>
      </div>
      <div class="chat-body" id="chatBody">
        <div class="chat-msg ai">你好，我是本系统的使用助手（本机模型驱动，已接入你的实时数据）。可以问我「怎么用这个系统」「解读诊断结果」「下一步做什么」，或任何园区GEO问题。</div>
      </div>
      <div class="chat-chips" id="chatChips"></div>
      <div class="chat-input">
        <textarea id="chatTa" rows="1" placeholder="输入问题，Enter 发送（Shift+Enter 换行）"></textarea>
        <button id="chatSend" class="btn btn-primary">发送</button>
      </div>`;
    document.body.appendChild(fab); document.body.appendChild(panel);

    const renderAll = () => {
      const body = $("#chatBody");
      body.innerHTML = `<div class="chat-msg ai">你好，我是本系统的使用助手（本机模型驱动，已接入你的实时数据）。可以问我「怎么用这个系统」「解读诊断结果」「下一步做什么」，或任何园区GEO问题。</div>` +
        history.map(m => `<div class="chat-msg ${m.role === "user" ? "user" : "ai"}">${esc(m.content).replace(/\n/g, "<br>")}</div>`).join("");
      body.scrollTop = body.scrollHeight;
    };
    renderAll();
    $("#chatChips").innerHTML = CHAT_SUGGEST.map(s => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join("");

    const open = () => {
      panel.hidden = false; fab.hidden = true; $("#chatTa").focus();
      loadHistory(); renderAll();   /* 每次打开按当前项目重载历史 */
    };
    const close = () => { panel.hidden = true; fab.hidden = false; };
    fab.addEventListener("click", open);
    $("#chatClose").addEventListener("click", close);
    $("#chatClear").addEventListener("click", () => { history = []; localStorage.setItem(chatKey(), "[]"); renderAll(); });
    const ob = $("#openChatBtn"); if (ob) ob.addEventListener("click", open);

    let busy = false;
    /* V4.3.3：SSE 解析器——chunk 边界可能把 data: 行截断，必须按\n拆分重组 */
    function parseSSEChunk(buffer) {
      const lines = buffer.split("\n");
      let keep = lines.pop() || "";            // 末尾不完整的行留到下个 chunk
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("data:")) {
          const payload = line.slice(5).replace(/^ /, "");
          if (payload === "[DONE]") { keep = "__DONE__"; break; }
          out.push(payload);
        }
        /* 其他行（event: / id: / retry: / 心跳注释行）忽略 */
      }
      return { text: out.join(""), keep };
    }
    async function ask(text) {
      if (busy || !text.trim()) return;
      busy = true;
      const send = $("#chatSend"); send.classList.add("is-busy"); send.textContent = "回答中…";
      history.push({ role: "user", content: text.trim() });
      localStorage.setItem(chatKey(), JSON.stringify(history.slice(-24)));
      const body = $("#chatBody");
      body.insertAdjacentHTML("beforeend", `<div class="chat-msg user">${esc(text)}</div><div class="chat-msg ai" id="chatLive"><span class="chat-dots">…</span></div>`);
      body.scrollTop = body.scrollHeight;
      const live = $("#chatLive");
      live.innerHTML = '<span class="chat-dots">连接本机模型…（首次约10–20秒，之后约5秒）</span>';
      const slowTimer = setTimeout(() => {
        if (!live.dataset.started) live.innerHTML = '<span class="chat-dots">模型加载中，仅首次较慢，请稍候…</span>';
      }, 7000);
      try {
        /* V4.3.3：用 AbortController 兜底 90s 超时，避免死等 */
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 90000);
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
          body: JSON.stringify({ messages: history.slice(-12), project: (typeof curProjectId === "function" ? curProjectId() : undefined) }),
          signal: ac.signal
        });
        clearTimeout(to);
        if (!r.ok) {
          let msg = `接口错误 ${r.status}`;
          try { msg = (await r.json()).error || msg; } catch (e) {}
          throw new Error(msg);
        }
        const modelName = r.headers.get("X-Model");
        if (modelName) $("#chatModel").textContent = modelName.split("-")[0];
        const rd = r.body.getReader(); const dec = new TextDecoder();
        let acc = "", last = 0, sseBuf = "";
        while (true) {
          const { done, value } = await rd.read();
          if (done) break;
          sseBuf += dec.decode(value, { stream: true });
          const parsed = parseSSEChunk(sseBuf);
          sseBuf = parsed.keep === "__DONE__" ? "" : parsed.keep;
          if (parsed.text) acc += parsed.text;
          if (!live.dataset.started && acc) { live.dataset.started = "1"; clearTimeout(slowTimer); }
          const now = performance.now();
          if (now - last > 80) {
            last = now;
            live.innerHTML = esc(clean(acc)).replace(/\n/g, "<br>");
            body.scrollTop = body.scrollHeight;
          }
        }
        clearTimeout(slowTimer); delete live.dataset.started;
        acc = clean(acc);
        if (!acc.trim()) acc = "（模型返回为空，请重试或换个小问题）";
        live.innerHTML = esc(acc).replace(/\n/g, "<br>");
        history.push({ role: "assistant", content: acc });
        localStorage.setItem(chatKey(), JSON.stringify(history.slice(-24)));
      } catch (e) {
        clearTimeout(slowTimer); delete live.dataset.started;
        const isAbort = e && (e.name === "AbortError" || /abort/i.test(e.message || ""));
        live.innerHTML = `<span style="color:var(--color-bad)">${isAbort ? "⏱ 请求超时（90s 无响应）" : "出错了：" + esc(e.message || String(e))}</span><br><span class="muted" style="font-size:12px">若长时间无响应：①点对话窗 ⚙ 切服务商+模型再试；②让管理员在服务器终端执行 <code>systemctl restart geo-console</code>。</span>`;
      }
      send.classList.remove("is-busy"); send.textContent = "发送"; busy = false;
      body.scrollTop = body.scrollHeight;
    }

    $("#chatSend").addEventListener("click", () => { const t = $("#chatTa").value; $("#chatTa").value = ""; ask(t); });
    $("#chatTa").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = $("#chatTa").value; $("#chatTa").value = ""; ask(t); }
    });
    $$("#chatChips [data-sug]").forEach(b => b.addEventListener("click", () => ask(b.dataset.sug)));
    if (new URLSearchParams(location.search).get("chat") === "1") open();  /* 截图/演示直达 */
    if (new URLSearchParams(location.search).get("llm") === "1") { open(); openLlm(); }  /* 模型配置直达（演示/排障） */

    /* ── 用户自接入 LLM：⚙ 设置窗（密钥存服务器按账号隔离，界面只回显尾4位）── */
    /* V4.3.2：每家服务商的 models 列表均通过 WebFetch 抓真实在售页面核实（2026-09）。
       凡是无法公开核实或登录后才有完整列表的（如豆包/火山方舟），
       仅保留两个有公开文档/控制台默认列出的备选 + 明确 desc 引导用户查控制台。 */
    const LLM_PROVIDERS = {
      /* DeepSeek：api-docs.deepseek.com/quick_start/pricing 实测在售 3 个 */
      deepseek: { name: "DeepSeek（深度求索）", base: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", keyHint: "格式：sk-xxxxxxxx… 在 deepseek.com 平台控制台 → API Keys 创建",
        models: [
          { id: "deepseek-v4-flash",            desc: "V4 Flash 2026-07-31 旗舰对话（默认，性价比高）" },
          { id: "deepseek-v4-pro",              desc: "V4 Pro 2026-08-13 深度推理（含思考）" },
          { id: "deepseek-v4-flash-vision-exp", desc: "V4 Flash Vision 实验版（多模态）" },
        ] },

      /* 通义千问（阿里百炼）：help.aliyun.com/zh/model-studio/models 实测在售 Qwen 3.8/3.7 */
      qwen: { name: "通义千问（阿里百炼）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-max", keyHint: "格式：sk-xxxxxxxx… 在 dashscope.console.aliyun.com → API-KEY 创建（兼容 OpenAI 模式）",
        models: [
          { id: "qwen3.8-max",  desc: "Qwen3.8 Max（旗舰，长上下文）" },
          { id: "qwen3.7-plus", desc: "Qwen3.7 Plus（默认，性价比高）" },
          { id: "qwen3.8-flash", desc: "Qwen3.8 Flash（速度最快，价格低）" },
          { id: "qwen3.5-omni-plus", desc: "Qwen3.5 Omni Plus（全模态，按需）" },
        ] },

      /* Kimi（月之暗面）：platform.kimi.com/docs/pricing/chat 实测在售 K3/K2.7 Code/K2.6
         （V1 系列已下架；platform.moonshot.cn 301 到 kimi.com） */
      kimi: { name: "Kimi（月之暗面）", base: "https://api.moonshot.cn/v1", model: "kimi-K3", keyHint: "格式：sk-xxxxxxxx… 在 platform.kimi.com 控制台 → API Keys 创建",
        models: [
          { id: "kimi-K3",         desc: "Kimi K3（2026 旗舰）" },
          { id: "kimi-K2.7-code",  desc: "Kimi K2.7 Code（编程/Agent 优化）" },
          { id: "kimi-K2.6",       desc: "Kimi K2.6（开源旗舰 MoE）" },
        ] },

      /* 智谱 GLM：docs.bigmodel.cn/cn/guide/start/model-overview 实测在售 */
      zhipu: { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "GLM-5.3", keyHint: "格式：xxxxxxx.yyyyyyy 在 bigmodel.cn → 个人中心 → API Keys 创建",
        models: [
          { id: "GLM-5.3",            desc: "GLM-5.3（2026 旗舰）" },
          { id: "GLM-5.3-Flash",      desc: "GLM-5.3 Flash（轻量旗舰）" },
          { id: "GLM-5.2",            desc: "GLM-5.2" },
          { id: "GLM-5.1",            desc: "GLM-5.1" },
          { id: "GLM-5",              desc: "GLM-5" },
          { id: "GLM-5-Turbo",        desc: "GLM-5 Turbo（速度优化）" },
          { id: "GLM-4.7",            desc: "GLM-4.7" },
          { id: "GLM-4.7-FlashX",     desc: "GLM-4.7 FlashX" },
          { id: "GLM-4.7-Flash",      desc: "GLM-4.7 Flash" },
          { id: "GLM-4.6",            desc: "GLM-4.6" },
          { id: "GLM-4.5-Air",        desc: "GLM-4.5 Air" },
          { id: "GLM-4.5-AirX",       desc: "GLM-4.5 AirX" },
          { id: "GLM-4-Long",         desc: "GLM-4 Long（超长上下文）" },
          { id: "GLM-4-FlashX-250414", desc: "GLM-4 FlashX 旧版 ID（兼容）" },
          { id: "GLM-4.5-Flash",      desc: "GLM-4.5 Flash" },
          { id: "GLM-4-Flash-250414",  desc: "GLM-4 Flash 旧版 ID（兼容）" },
        ] },

      /* 豆包（火山方舟）：官方文档需登录才能看到完整列表。
         控制台默认开通的「豆包系列推理接入点」与这两个 ID 在 2026 年仍可见；
         其他新模型请到方舟控制台 → 在线推理 → 创建接入点 查准确名称 */
      doubao: { name: "豆包（火山方舟）", base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6-250615", keyHint: "格式：xxxx-xxx-… 在 volcengine.com → 火山方舟 → API Key 管理创建（需先开通模型推理接入点）",
        models: [
          { id: "doubao-seed-1-6-250615", desc: "Seed 1.6（2025 旗舰，方舟控制台默认有）" },
          { id: "doubao-seed-1-6-lite",   desc: "Seed 1.6 Lite（轻量）" },
        ] },

      /* Ollama：本机已确认 qwen3:4b-instruct-2507-q4_K_M；其他选项是 ollama.com/library 常见热模型 */
      ollama: { name: "Ollama（本机大模型，无需密钥）", base: "http://127.0.0.1:11434/v1", model: "qwen3:4b-instruct-2507-q4_K_M", keyHint: "本机 Ollama 通常无需密钥；密钥框留空即可；先在终端 ollama pull <模型>",
        models: [
          { id: "qwen3:4b-instruct-2507-q4_K_M", desc: "Qwen3 4B 量化（本机实测可用）" },
          { id: "qwen3:8b",                  desc: "Qwen3 8B（更强）" },
          { id: "qwen3:14b",                 desc: "Qwen3 14B（要 16G+ 内存）" },
          { id: "deepseek-r1:8b",            desc: "DeepSeek R1 蒸馏 8B" },
          { id: "gemma3:4b",                 desc: "Gemma 3 4B（Google）" },
          { id: "llama3.1:8b",               desc: "Llama 3.1 8B（Meta）" },
        ] },

      custom: { name: "OpenAI 兼容（自定义地址/模型）", base: "", model: "", keyHint: "高级用户：自填兼容 OpenAI 协议的 API 地址与模型名", models: [] },
    };
    async function fetchLlmSettings() {
      try { return await (await fetch("/api/llm/settings")).json(); }
      catch (e) { return null; }
    }
    function providerKeyOf(baseUrl, provider) {
      if (provider && LLM_PROVIDERS[provider]) return provider;
      for (const [k, v] of Object.entries(LLM_PROVIDERS))
        if (v.base && baseUrl && v.base === baseUrl.replace(/\/$/, "")) return k;
      return "custom";
    }
    function paintModelLabel(st) {
      const el = $("#chatModel"); if (!el) return;
      if (!st) return;
      const src = st.active && st.active.source;
      const model = (st.active && st.active.model) || "";
      el.textContent = src === "none" ? "未配置 ⚙" : (model.split("-")[0] || "已配置");
    }
    async function openLlm() {
      const m = $("#llmModal"); m.hidden = false;
      $("#llmProvider").innerHTML = Object.entries(LLM_PROVIDERS)
        .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
      $("#llmKey").value = ""; $("#llmKey").type = "password"; $("#llmEye").textContent = "显示";
      $("#llmTestOut").innerHTML = "";
      const st = await fetchLlmSettings();
      if (!st) { $("#llmState").textContent = "读取失败：需要在服务器模式下使用（本地双击打开时不可配置）。"; return; }
      let savedModel = "";
      if (st.user) {
        $("#llmProvider").value = providerKeyOf(st.user.baseUrl, st.user.provider);
        $("#llmBase").value = st.user.baseUrl;
        savedModel = st.user.model;
        $("#llmKey").placeholder = `已保存 ${st.user.keyTail}（留空则沿用）`;
        $("#llmState").textContent = `我的配置已生效：${st.user.model} · 密钥${st.user.keyTail}（${st.user.updatedAt} 保存）。清除后回退系统默认。`;
      } else {
        const a = st.active || {};
        $("#llmState").textContent = a.source === "server" ? `尚未配置个人模型。当前使用：系统配置（${a.model}）`
          : a.source === "local" ? `尚未配置个人模型。当前使用：本机 Ollama（${a.model}）`
          : "尚未配置任何模型——选服务商 + 选模型 + 填密钥 + 保存 即可启用。";
      }
      /* V4.3.1：填充模型下拉（选中的服务商的 models 列表） */
      const prov = $("#llmProvider").value;
      const p = LLM_PROVIDERS[prov] || LLM_PROVIDERS.custom;
      $("#llmBase").value = p.base;
      $("#llmKey").placeholder = p.keyHint || "sk-…（以服务商控制台为准）";
      fillModelSelect(prov, savedModel || p.model);
      syncLlmAdvanced();
      paintModelLabel(st);
    }
    /* V4.3：非 custom 模式隐藏地址/模型（避免改错），custom 才显示 */
    function syncLlmAdvanced() {
      const prov = $("#llmProvider").value;
      const isCustom = prov === "custom";
      $("#llmBase").closest("label").style.display = isCustom ? "" : "none";
      /* 模型字段始终显示——custom 走 select；非 custom 走 select，下拉由 models 列表填充 */
    }
    /* V4.3.1：填充模型下拉。最末项「自定义」切到手动输入框 */
    function fillModelSelect(prov, currentModel) {
      const p = LLM_PROVIDERS[prov] || LLM_PROVIDERS.custom;
      const sel = $("#llmModel");
      const custom = $("#llmModelCustom");
      const opts = (p.models || []).map(m =>
        `<option value="${esc(m.id)}">${esc(m.id)} — ${esc(m.desc)}</option>`).join("");
      sel.innerHTML = `<option value="${esc(p.model)}" selected>${esc(p.model)}（推荐）</option>` +
                      opts +
                      `<option value="__custom__">自定义（手填）…</option>`;
      /* 若当前 model 不在下拉里（如保存了旧 ID），保留并显示 */
      if (currentModel && currentModel !== p.model && ![...sel.options].some(o => o.value === currentModel)) {
        const o = document.createElement("option");
        o.value = currentModel; o.textContent = currentModel + "（已保存）"; sel.appendChild(o);
        sel.value = currentModel;
      }
      /* custom 模式：无下拉项，直接输入 */
      if (prov === "custom") {
        sel.style.display = "none"; custom.style.display = "";
        custom.value = currentModel || "";
      } else {
        sel.style.display = ""; custom.style.display = "none";
        sel.value = [...sel.options].some(o => o.value === currentModel) ? currentModel : p.model;
      }
    }
    $("#llmCfgBtn").addEventListener("click", openLlm);
    const llmClose = $("#llmClose"); if (llmClose) llmClose.addEventListener("click", () => { $("#llmModal").hidden = true; });
    $("#llmModel").addEventListener("change", () => {
      if ($("#llmModel").value === "__custom__") {
        $("#llmModel").style.display = "none";
        $("#llmModelCustom").style.display = "";
        $("#llmModelCustom").focus();
      }
    });
    $("#llmProvider").addEventListener("change", () => {
      const prov = $("#llmProvider").value;
      const p = LLM_PROVIDERS[prov] || LLM_PROVIDERS.custom;
      $("#llmBase").value = p.base;
      $("#llmKey").placeholder = p.keyHint || "sk-…（以服务商控制台为准）";
      fillModelSelect(prov, p.model);
      syncLlmAdvanced();
    });
    $("#llmEye").addEventListener("click", () => {
      const k = $("#llmKey"); const show = k.type === "password";
      k.type = show ? "text" : "password"; $("#llmEye").textContent = show ? "隐藏" : "显示";
    });
    $("#llmTest").addEventListener("click", async () => {
      const out = $("#llmTestOut"); const btn = $("#llmTest");
      btn.classList.add("is-busy"); btn.textContent = "测试中…";
      out.innerHTML = '<p class="muted">正在真实调用该服务商接口…</p>';
      try {
        const key = $("#llmKey").value.trim();
        const prov = $("#llmProvider").value;
        const modelEl = $("#llmModel");
        const model = (modelEl.style.display === "none") ? $("#llmModelCustom").value.trim() : modelEl.value.trim();
        const body = (key || prov === "ollama")
          ? { provider: prov, baseUrl: $("#llmBase").value.trim(), model, apiKey: key } : {};
        const resp = await fetch("/api/llm/test", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
        /* V4.3：检测 nginx 把请求重定向到 SSO 登录页（302）→ 不是 API 错误，而是 SSO 失效 */
        if (resp.type === "opaqueredirect" || resp.status === 302 || resp.status === 0) {
          out.innerHTML = `<p style="color:var(--color-bad)">✗ 请求被拦截（${resp.status || '重定向'}）</p><p class="muted" style="font-size:12px">多半是 SSO 登录态失效：请刷新页面重新登录，或换用「自定义地址」避开反代。</p>`;
        } else {
          const r = await resp.json();
          out.innerHTML = r.ok
            ? `<p style="color:var(--color-ok)">✓ 连接成功（${r.which} · ${r.model} · ${r.latency_ms}ms）</p>`
            : `<p style="color:var(--color-bad)">✗ ${esc(r.error || "测试失败")}</p>`;
        }
      } catch (e) { out.innerHTML = `<p style="color:var(--color-bad)">✗ 请求失败：${esc(e.message)}</p><p class="muted" style="font-size:12px">可能是 SSO 登录态失效或网络问题，请刷新页面重试。</p>`; }
      btn.classList.remove("is-busy"); btn.textContent = "连接测试";
    });
    $("#llmSave").addEventListener("click", async () => {
      try {
        const modelEl = $("#llmModel");
        const model = (modelEl.style.display === "none") ? $("#llmModelCustom").value.trim() : modelEl.value.trim();
        const resp = await fetch("/api/llm/settings", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: $("#llmProvider").value, baseUrl: $("#llmBase").value.trim(),
                                 model, apiKey: $("#llmKey").value.trim() }), redirect: "manual" });
        if (resp.type === "opaqueredirect" || resp.status === 302 || resp.status === 0) {
          $("#llmTestOut").innerHTML = `<p style="color:var(--color-bad)">✗ 请求被拦截（${resp.status || '重定向'}）</p><p class="muted" style="font-size:12px">多半是 SSO 登录态失效：请刷新页面重新登录。</p>`;
          return;
        }
        const r = await resp.json();
        if (r.ok || r.keyTail) {
          $("#llmKey").value = ""; $("#llmKey").type = "password"; $("#llmEye").textContent = "显示";
          $("#llmKey").placeholder = `已保存 ${r.keyTail}（留空则沿用）`;
          $("#llmState").textContent = `已保存并生效：${$("#llmModel").value.trim()} · 密钥${r.keyTail}`;
          paintModelLabel(await fetchLlmSettings());
          if (typeof toast === "function") toast("模型配置已保存 ✓");
        } else {
          $("#llmState").textContent = "";
          $("#llmTestOut").innerHTML = `<p style="color:var(--color-bad)">✗ ${esc(r.error || "保存失败")}</p>`;
        }
      } catch (e) { $("#llmTestOut").innerHTML = `<p style="color:var(--color-bad)">✗ 保存失败：${esc(e.message)}</p>`; }
    });
    $("#llmClear").addEventListener("click", async () => {
      if (!confirm("清除我保存的模型配置？（不影响其他人）")) return;
      try {
        await fetch("/api/llm/settings/clear", { method: "POST" });
        $("#llmKey").value = ""; $("#llmKey").placeholder = "sk-…（以服务商控制台为准）";
        $("#llmTestOut").innerHTML = "";
        const st = await fetchLlmSettings();
        const a = (st && st.active) || {};
        $("#llmState").textContent = a.source === "server" ? `已清除。当前使用：系统配置（${a.model}）`
          : a.source === "local" ? `已清除。当前使用：本机 Ollama（${a.model}）` : "已清除。当前无可用模型。";
        paintModelLabel(st);
        if (typeof toast === "function") toast("已清除我的配置");
      } catch (e) { $("#llmTestOut").innerHTML = `<p style="color:var(--color-bad)">✗ ${esc(e.message)}</p>`; }
    });
    fetchLlmSettings().then(paintModelLabel);   /* 初始标签即显示当前生效后端 */
  }
  document.addEventListener("DOMContentLoaded", inject);
})();
