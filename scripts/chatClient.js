// scripts/chatClient.js
// Spectator Chat client — robust loader + correct namespace (/spectator-chat)

async function getIo() {
  // Prefer a globally loaded client (from <script src="https://cdn.socket.io/...">)
  if (window.io) return window.io;
  // Fallback: ESM import
  try {
    const mod = await import('https://cdn.socket.io/4.7.5/socket.io.esm.min.js');
    return mod.io;
  } catch (e) {
    console.error('[ChatClient] Unable to load Socket.IO client:', e);
    return null;
  }
}

(function initChatClient() {
  const qs = new URLSearchParams(location.search);

  // Identify the spectator + which room to join
  const name   = qs.get('user') || 'Spectator';
  const mode   = (qs.get('mode') || '').toLowerCase();
  const duelId = qs.get('session') || qs.get('duel') || '';
  const roomId = duelId || (mode === 'practice' ? `practice:${name}` : `spectate:${name}`);

  // API_BASE is set in index.html; sockets use the ORIGIN (not /api)
  const API_BASE = (window.API_BASE || '').trim();
  const backendOrigin = API_BASE ? new URL(API_BASE, location.href).origin : location.origin;

  // DOM hooks
  const logEl    = document.getElementById('chat-log');
  const formEl   = document.getElementById('chat-form');
  const inputEl  = document.getElementById('chat-input');
  const typingEl = document.getElementById('chat-typing');
  const presEl   = document.getElementById('chat-presence');
  const sendBtn  = document.getElementById('chat-send');

  // Stable userId for local viewer
  const LS_KEY = 'sv13.chat.uid';
  const userId = (() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v) return v;
      const n = crypto?.randomUUID?.() || ('u-' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(LS_KEY, n);
      return n;
    } catch {
      return 'u-' + Math.random().toString(36).slice(2, 10);
    }
  })();

  // Helpers
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function atBottom() {
    return (logEl.scrollTop + logEl.clientHeight) >= (logEl.scrollHeight - 60);
  }
  function scrollToBottom() {
    logEl.scrollTop = logEl.scrollHeight;
  }
  function renderMsg({ userId: uid, name: uname, text, ts }) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-row' + (uid === userId ? ' me' : '');
    const when = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrap.innerHTML = `
      <div class="chat-bubble">
        <div class="chat-meta">
          <span class="chat-name">${escapeHtml(uname || 'Spectator')}${uid === userId ? ' (You)' : ''}</span>
          <span class="chat-time">${when}</span>
        </div>
        <div class="chat-text">${escapeHtml(text || '')}</div>
      </div>`;
    logEl.appendChild(wrap);
  }

  // Defensive: never submit if not connected
  function setSendEnabled(ok) {
    if (!sendBtn) return;
    sendBtn.disabled = !ok;
    sendBtn.style.opacity = ok ? '1' : '0.6';
    sendBtn.style.cursor  = ok ? 'pointer' : 'not-allowed';
  }
  setSendEnabled(false);

  // Always prevent default submit
  formEl?.addEventListener('submit', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!socket || !socket.connected) return;
    const text = (inputEl.value || '').trim();
    if (!text || text.length > 500) return;
    socket.emit('chat_message', text);
    inputEl.value = '';
    socket.emit('typing', false);
  });

  let socket = null;
  let typingTimer = null;

  // Load client + connect
  (async () => {
    const io = await getIo();
    if (!io) {
      console.error('[ChatClient] Socket.IO client unavailable; chat disabled.');
      return;
    }

    try {
      // IMPORTANT: correct namespace
      const nsUrl = `${backendOrigin}/spectator-chat`;
      socket = io(nsUrl, {
        path: '/socket.io',
        transports: ['websocket'],
        withCredentials: false,
        reconnection: true,
        reconnectionDelayMax: 5000,
      });

      socket.on('connect', () => {
        console.log('[ChatClient] connected → joining room', { ns: nsUrl, roomId, userId, name });
        setSendEnabled(true);
        socket.emit('join_room', { roomId, userId, name });
      });

      socket.on('connect_error', (err) => {
        console.error('[ChatClient] connect_error:', err?.message || err);
        setSendEnabled(false);
      });

      socket.on('disconnect', (reason) => {
        console.warn('[ChatClient] disconnected:', reason);
        setSendEnabled(false);
      });

      socket.on('error', (e) => console.error('[ChatClient] socket error:', e));

      socket.on('history', ({ messages = [] }) => {
        logEl.innerHTML = '';
        messages.forEach(renderMsg);
        scrollToBottom();
      });

      socket.on('message', (msg) => {
        const stick = atBottom();
        renderMsg(msg);
        if (stick) scrollToBottom();
      });

      socket.on('presence', ({ count }) => {
        presEl.textContent = `${count} online`;
        // 🔥 mirror presence into the main header counter
        const wc = document.getElementById('watching-count');
        if (wc) wc.textContent = `Spectators Watching: ${count}`;
      });

      // 🔔 optional: server can emit when a user joins -> show toast in UI
      socket.on('user_joined', ({ name: joinedName }) => {
        try {
          window.dispatchEvent(new CustomEvent('spectator:user_joined', { detail: { name: joinedName } }));
        } catch {}
      });

      inputEl?.addEventListener('input', () => {
        if (!socket || !socket.connected) return;
        socket.emit('typing', true);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => socket.emit('typing', false), 1200);
      });

      socket.on('typing', ({ users = [] }) => {
        typingEl.textContent = users.length ? `${users.length} typing…` : '';
      });

      // 🏁 Forward duel end events to the page (spectator-only UI)
      socket.on('duel_result', (payload = {}) => {
        try { window.dispatchEvent(new CustomEvent('spectator:duel_result', { detail: payload })); } catch {}
      });
      socket.on('match_end', (payload = {}) => {
        try { window.dispatchEvent(new CustomEvent('spectator:duel_result', { detail: payload })); } catch {}
      });

      console.log('[ChatClient] origin:', backendOrigin, 'namespace: /spectator-chat', 'roomId:', roomId, 'user:', name);
    } catch (e) {
      console.error('[ChatClient] init failed:', e);
    }
  })();
})();
