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
  }
  document.addEventListener("DOMContentLoaded", inject);
})();
