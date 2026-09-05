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
        const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-12), project: (typeof curProjectId === "function" ? curProjectId() : undefined) }) });
        if (!r.ok) {
          let msg = `接口错误 ${r.status}`;
          try { msg = (await r.json()).error || msg; } catch (e) {}
          throw new Error(msg);
        }
        const modelName = r.headers.get("X-Model");
        if (modelName) $("#chatModel").textContent = modelName.split("-")[0];   /* 短名：qwen3:4b-instruct-2507-q4_K_M → qwen3:4b */
        const rd = r.body.getReader(); const dec = new TextDecoder();
        let acc = "", last = 0;
        while (true) {
          const { done, value } = await rd.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          if (!live.dataset.started) { live.dataset.started = "1"; clearTimeout(slowTimer); }
          const now = performance.now();
          if (now - last > 80) { last = now; live.innerHTML = esc(clean(acc)).replace(/\n/g, "<br>"); body.scrollTop = body.scrollHeight; }
        }
        clearTimeout(slowTimer); delete live.dataset.started;
        acc = clean(acc);
        if (!acc.trim()) acc = "（模型返回为空，请重试或换个小问题）";
        live.innerHTML = esc(acc).replace(/\n/g, "<br>");
        history.push({ role: "assistant", content: acc });
        localStorage.setItem(chatKey(), JSON.stringify(history.slice(-24)));
      } catch (e) {
        clearTimeout(slowTimer); delete live.dataset.started;
        live.innerHTML = `<span style="color:var(--color-bad)">出错了：${esc(e.message)}</span><br><span class="muted" style="font-size:12px">若提示连接失败：请联系系统管理员启动后台服务。</span>`;
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
    /* V4.3：预填主流服务商的 API 地址+模型名，用户只填 API 密钥即可；自定义模式保留高级用户入口 */
    const LLM_PROVIDERS = {
      deepseek: { name: "DeepSeek（深度求索）", base: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "格式：sk-xxxxxxxx… 在 deepseek.com 平台控制台 → API Keys 创建" },
      qwen:     { name: "通义千问（阿里百炼）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "格式：sk-xxxxxxxx… 在 dashscope.console.aliyun.com → API-KEY 创建（兼容 OpenAI 模式）" },
      kimi:     { name: "Kimi（月之暗面）", base: "https://api.moonshot.cn/v1", model: "kimi-k2-0905-preview", keyHint: "格式：sk-xxxxxxxx… 在 platform.moonshot.cn → API Keys 创建" },
      zhipu:    { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", keyHint: "格式：xxxxxxx.yyyyyyy 在 bigmodel.cn → 个人中心 → API Keys 创建" },
      doubao:   { name: "豆包（火山方舟）", base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6-250615", keyHint: "格式：xxxx-xxx-… 在 volcengine.com → 火山方舟 → API Key 管理创建（需先开通模型推理接入点）" },
      ollama:   { name: "Ollama（本机大模型，无需密钥）", base: "http://127.0.0.1:11434/v1", model: "qwen3:4b-instruct-2507-q4_K_M", keyHint: "本机 Ollama 通常无需密钥；密钥框留空即可" },
      custom:   { name: "OpenAI 兼容（自定义地址/模型）", base: "", model: "", keyHint: "高级用户：自填兼容 OpenAI 协议的 API 地址与模型名" },
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
      if (st.user) {
        $("#llmProvider").value = providerKeyOf(st.user.baseUrl, st.user.provider);
        $("#llmBase").value = st.user.baseUrl;
        $("#llmModel").value = st.user.model;
        $("#llmKey").placeholder = `已保存 ${st.user.keyTail}（留空则沿用）`;
        $("#llmState").textContent = `我的配置已生效：${st.user.model} · 密钥${st.user.keyTail}（${st.user.updatedAt} 保存）。清除后回退系统默认。`;
      } else {
        const a = st.active || {};
        $("#llmState").textContent = a.source === "server" ? `尚未配置个人模型。当前使用：系统配置（${a.model}）`
          : a.source === "local" ? `尚未配置个人模型。当前使用：本机 Ollama（${a.model}）`
          : "尚未配置任何模型——选服务商 + 填密钥 + 保存 即可启用。";
      }
      /* V4.3：下拉选服务商后自动填地址/模型 + 切换高级字段显隐（custom 模式显示） */
      const prov = $("#llmProvider").value;
      const p = LLM_PROVIDERS[prov] || LLM_PROVIDERS.custom;
      $("#llmBase").value = p.base; $("#llmModel").value = p.model;
      $("#llmKey").placeholder = p.keyHint || "sk-…（以服务商控制台为准）";
      syncLlmAdvanced();
      paintModelLabel(st);
    }
    /* V4.3：非 custom 模式隐藏地址/模型（避免改错），custom 才显示 */
    function syncLlmAdvanced() {
      const prov = $("#llmProvider").value;
      const isCustom = prov === "custom";
      $("#llmBase").closest("label").style.display = isCustom ? "" : "none";
      $("#llmModel").closest("label").style.display = isCustom ? "" : "none";
    }
    $("#llmCfgBtn").addEventListener("click", openLlm);
    const llmClose = $("#llmClose"); if (llmClose) llmClose.addEventListener("click", () => { $("#llmModal").hidden = true; });
    $("#llmProvider").addEventListener("change", () => {
      const p = LLM_PROVIDERS[$("#llmProvider").value] || LLM_PROVIDERS.custom;
      $("#llmBase").value = p.base; $("#llmModel").value = p.model;
      $("#llmKey").placeholder = p.keyHint || "sk-…（以服务商控制台为准）";
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
        const body = (key || prov === "ollama")
          ? { provider: prov, baseUrl: $("#llmBase").value.trim(), model: $("#llmModel").value.trim(), apiKey: key } : {};
        const r = await (await fetch("/api/llm/test", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
        out.innerHTML = r.ok
          ? `<p style="color:var(--color-ok)">✓ 连接成功（${r.which} · ${r.model} · ${r.latency_ms}ms）</p>`
          : `<p style="color:var(--color-bad)">✗ ${esc(r.error || "测试失败")}</p>`;
      } catch (e) { out.innerHTML = `<p style="color:var(--color-bad)">✗ 请求失败：${esc(e.message)}</p>`; }
      btn.classList.remove("is-busy"); btn.textContent = "连接测试";
    });
    $("#llmSave").addEventListener("click", async () => {
      try {
        const r = await (await fetch("/api/llm/settings", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: $("#llmProvider").value, baseUrl: $("#llmBase").value.trim(),
                                 model: $("#llmModel").value.trim(), apiKey: $("#llmKey").value.trim() }) })).json();
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
