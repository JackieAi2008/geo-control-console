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

  /* V4.4：安全 Markdown 渲染——先整篇 esc 防 XSS，再恢复受限语法（粗体/代码/标题/列表/链接文字） */
  function mdToHtml(src) {
    let s = esc(String(src || ""));
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    const lines = s.split("\n");
    let html = "", inUl = false, inOl = false;
    const closeLists = () => { if (inUl) { html += "</ul>"; inUl = false; } if (inOl) { html += "</ol>"; inOl = false; } };
    for (const raw of lines) {
      const t = raw.trim();
      const ul = t.match(/^[-•]\s+(.*)/);
      const ol = t.match(/^(\d+)[.、]\s+(.*)/);
      if (ul) { if (!inUl) { closeLists(); html += "<ul>"; inUl = true; } html += "<li>" + ul[1] + "</li>"; continue; }
      if (ol) { if (!inOl) { closeLists(); html += "<ol>"; inOl = true; } html += "<li>" + ol[2] + "</li>"; continue; }
      if (/^#{1,4}\s/.test(t)) { closeLists(); html += "<h4>" + t.replace(/^#{1,4}\s+/, "") + "</h4>"; continue; }
      if (/^\|/.test(t)) { closeLists(); html += "<p class='mono'>" + t + "</p>"; continue; }  // 表格行暂以等宽段呈现
      if (!t) { closeLists(); continue; }
      closeLists();
      html += "<p>" + t + "</p>";
    }
    closeLists();
    return html || "<p></p>";
  }

  /* V4.4：聊天排版样式（inject 一次） */
  function injectChatStyles() {
    if ($("#chatMdStyle")) return;
    const st = document.createElement("style");
    st.id = "chatMdStyle";
    st.textContent = `
      .chat-msg.ai p { margin:0 0 7px; line-height:1.75; }
      .chat-msg.ai p:last-child { margin-bottom:0; }
      .chat-msg.ai ul, .chat-msg.ai ol { margin:2px 0 8px 20px; padding:0; }
      .chat-msg.ai li { margin:3px 0; line-height:1.7; }
      .chat-msg.ai h4 { font-size:14px; margin:10px 0 6px; }
      .chat-msg.ai code { background:rgba(1,64,112,.08); padding:1px 5px; border-radius:4px; font-size:12px; font-family:var(--font-mono,monospace); }
      .chat-msg.ai table { border-collapse:collapse; font-size:12px; margin:4px 0 8px; }
      .think-badge { display:flex; width:fit-content; align-items:center; gap:4px; font-size:11px; color:var(--color-ink-3,#8895a7); background:rgba(1,64,112,.06); border:1px solid rgba(1,64,112,.12); border-radius:10px; padding:1px 8px; margin:0 0 6px; }
      .kb-badge { display:flex; width:fit-content; align-items:center; gap:4px; font-size:11px; color:#8a6d1a; background:rgba(201,158,45,.12); border:1px solid rgba(201,158,45,.3); border-radius:10px; padding:1px 8px; margin:0 0 6px; }
    `;
    document.head.appendChild(st);
  }

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
    injectChatStyles();

    /* V4.4：渲染一条历史/完成消息（Markdown 排版 + 过滤旧版残留的 [思考] 尾巴） */
    function renderAssistantMd(text) {
      const pure = String(text || "").split("\n[思考]")[0].trim();
      return mdToHtml(pure);
    }

    const renderAll = () => {
      const body = $("#chatBody");
      /* V4.4：过滤空内容消息（旧版本 bug 可能存入空串 → 空泡） */
      const items = history.filter(m => (m.content || "").trim());
      body.innerHTML = `<div class="chat-msg ai">你好，我是本系统的使用助手（已接入你的实时数据）。可以问我「怎么用这个系统」「解读诊断结果」「下一步做什么」，或任何园区GEO问题。</div>` +
        items.map(m => m.role === "user"
          ? `<div class="chat-msg user">${esc(m.content).replace(/\n/g, "<br>")}</div>`
          : `<div class="chat-msg ai">${renderAssistantMd(m.content)}</div>`).join("");
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
    /* V4.4：SSE 解析器——识别 event: think / data: 两种事件 */
    function parseSSEChunk(buffer) {
      const lines = buffer.split("\n");
      let keep = lines.pop() || "";
      const out = [];
      let curEvent = "data";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("event:")) { curEvent = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const payload = line.slice(5).replace(/^ /, "");
          if (payload === "[DONE]") { keep = "__DONE__"; break; }
          out.push({ event: curEvent, data: payload });
          curEvent = "data";
        }
      }
      return { items: out, keep };
    }
    async function ask(text) {
      if (busy || !text.trim()) return;
      busy = true;
      const send = $("#chatSend"); send.classList.add("is-busy"); send.textContent = "回答中…";
      history.push({ role: "user", content: text.trim() });
      localStorage.setItem(chatKey(), JSON.stringify(history.filter(m => (m.content || "").trim()).slice(-24)));
      const body = $("#chatBody");

      /* V4.4：用局部节点引用（不再依赖 id 查找）——防 renderAll 重建后引用失效留空泡 */
      const userNode = document.createElement("div");
      userNode.className = "chat-msg user";
      userNode.textContent = text.trim();
      const liveNode = document.createElement("div");
      liveNode.className = "chat-msg ai";
      body.appendChild(userNode);
      body.appendChild(liveNode);
      const scrollToBottom = () => { body.scrollTop = body.scrollHeight; };
      scrollToBottom();

      /* V4.4：①知识库优先——命中高频问题秒回标准答案 */
      const kb = (typeof kbSearch === "function") ? kbSearch(text) : null;
      if (kb) {
        liveNode.innerHTML = `<span class="kb-badge">📖 系统知识库</span><div class="kb-answer">${renderAssistantMd(kb.answer)}</div>`;
        history.push({ role: "assistant", content: kb.answer });
        localStorage.setItem(chatKey(), JSON.stringify(history.filter(m => (m.content || "").trim()).slice(-24)));
        scrollToBottom();
        send.classList.remove("is-busy"); send.textContent = "发送"; busy = false;
        return;
      }

      /* ②LLM 流式回答。思考过程不展示全文，仅显示「深度思考中 → 已深度思考」徽标 */
      liveNode.innerHTML = '<span class="chat-dots">思考中…</span>';
      const slowTimer = setTimeout(() => {
        if (!liveNode.dataset.started) liveNode.innerHTML = '<span class="chat-dots">模型加载中，仅首次较慢，请稍候…</span>';
      }, 7000);
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 90000);
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
          body: JSON.stringify({ messages: history.filter(m => (m.content || "").trim()).slice(-12), project: (typeof curProjectId === "function" ? curProjectId() : undefined) }),
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
        let acc = "", thought = false, last = 0, sseBuf = "";
        const renderLive = () => {
          /* 防游离节点：面板被重建就把节点挂回去 */
          if (!liveNode.isConnected) body.appendChild(liveNode);
          const badge = thought ? '<span class="think-badge">💡 已深度思考</span>' : "";
          liveNode.innerHTML = badge + (acc
            ? mdToHtmlStream(acc)
            : '<span class="chat-dots">思考中…</span>');
          scrollToBottom();
        };
        /* 流式期间用轻量排版（增量安全：逐字符累计后统一 esc+md） */
        const mdToHtmlStream = (t) => mdToHtml(t);
        while (true) {
          const { done, value } = await rd.read();
          if (done) break;
          sseBuf += dec.decode(value, { stream: true });
          const parsed = parseSSEChunk(sseBuf);
          sseBuf = parsed.keep === "__DONE__" ? "" : parsed.keep;
          for (const it of parsed.items) {
            if (it.event === "think") thought = true;      /* V4.4：思考只点亮徽标，不展示全文 */
            else acc += it.data;
          }
          if (!liveNode.dataset.started && (acc || thought)) { liveNode.dataset.started = "1"; clearTimeout(slowTimer); }
          const now = performance.now();
          if (now - last > 100) { last = now; renderLive(); }
        }
        clearTimeout(slowTimer); delete liveNode.dataset.started;

        const finalText = clean(acc).trim();
        if (!liveNode.isConnected) body.appendChild(liveNode);
        if (!finalText) {
          /* V4.4：空回答直接移除气泡，不留空泡 */
          liveNode.remove();
          history.pop();   /* 把刚 push 的 user 消息也撤回（本次问答无效） */
        } else {
          const badge = thought ? '<span class="think-badge">💡 已深度思考</span>' : "";
          liveNode.innerHTML = badge + mdToHtml(finalText);
          history.push({ role: "assistant", content: finalText });
        }
        localStorage.setItem(chatKey(), JSON.stringify(history.filter(m => (m.content || "").trim()).slice(-24)));
        scrollToBottom();
      } catch (e) {
        clearTimeout(slowTimer); delete liveNode.dataset.started;
        const isAbort = e && (e.name === "AbortError" || /abort/i.test(e.message || ""));
        if (!liveNode.isConnected) body.appendChild(liveNode);
        liveNode.innerHTML = `<span style="color:var(--color-bad)">${isAbort ? "⏱ 请求超时（90s 无响应）" : "出错了：" + esc(e.message || String(e))}</span><br><span class="muted" style="font-size:12px">可点右上角 ⚙ 检查模型配置，或稍后重试。</span>`;
        scrollToBottom();
      }
      send.classList.remove("is-busy"); send.textContent = "发送"; busy = false;
      scrollToBottom();
    }

    $("#chatSend").addEventListener("click", () => {
      const t = $("#chatTa").value;
      if (busy) { if (typeof toast === "function") toast("上一问还在回答中，请稍候…"); return; }
      $("#chatTa").value = ""; ask(t);
    });
    $("#chatTa").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const t = $("#chatTa").value;
        if (busy) { if (typeof toast === "function") toast("上一问还在回答中，请稍候…"); return; }
        $("#chatTa").value = ""; ask(t);
      }
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
