import { NET_LIMITS, pageHidden } from './net-hygiene.js';

(function initSpectatorChat() {
  'use strict';
  if (window.__SV13_SPECTATOR_CHAT_WIRED__) return;
  window.__SV13_SPECTATOR_CHAT_WIRED__ = true;

  const cfg = window.SV13_SPECTATOR || {};
  const sessionId = String(cfg.sessionId || '').trim();
  const viewerToken = String(cfg.viewerToken || '').trim();
  const apiBase = String(cfg.apiBase || 'https://api.sv13tcg.com').replace(/\/+$/, '');
  const SESSION_RE = /^[A-Za-z0-9_-]{12,128}$/;

  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const typing = document.getElementById('chat-typing');
  const presence = document.getElementById('chat-presence');
  const identity = document.getElementById('chat-identity');

  if (!log || !form || !input || !send) return;
  if (!SESSION_RE.test(sessionId)) {
    input.disabled = true;
    send.disabled = true;
    if (typing) typing.textContent = 'Chat unavailable without a valid session.';
    return;
  }

  if (identity) identity.textContent = viewerToken ? 'Resolving linked spectator…' : 'Spectating anonymously';

  const fmtTime = value => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  function setTypingText(text) {
    if (typing) typing.textContent = text || '';
  }

  let resolvedViewerName = '';
  function setViewerIdentity(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!viewerToken || !clean || clean === 'Spectator') return;
    resolvedViewerName = clean;
    if (identity) identity.textContent = `Spectating as ${clean}`;
  }

  function consumeIdentity(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.roomId && String(payload.roomId) !== sessionId) return;
    setViewerIdentity(payload.name || payload.displayName || payload.viewerName || payload.selfName);
  }

  function setPresence(count) {
    const n = Math.max(0, Number(count) || 0);
    window.__SV13_CHAT_HAS_PRESENCE__ = true;
    if (presence) presence.textContent = `${n} online`;
    const header = document.getElementById('watching-count');
    if (header) header.textContent = `Spectators Watching: ${n}`;
    window.dispatchEvent(new CustomEvent('spectator:presence', { detail: { count: n } }));
  }

  function appendMessage(msg) {
    if (!msg || !msg.text) return;
    const row = document.createElement('div');
    row.className = `chat-row${msg.userId && socket?.id === msg.userId ? ' me' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    const meta = document.createElement('div');
    meta.className = 'chat-meta';

    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = String(msg.name || 'Spectator');

    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = fmtTime(msg.ts);

    const text = document.createElement('div');
    text.className = 'chat-text';
    text.textContent = String(msg.text || '');

    meta.append(name, time);
    bubble.append(meta, text);
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function renderHistory(messages) {
    log.replaceChildren();
    for (const msg of Array.isArray(messages) ? messages : []) appendMessage(msg);
  }

  let previousPresenceNames = new Set();
  function handlePresence(payload) {
    if (!payload || String(payload.roomId || '') !== sessionId) return;
    const names = Array.isArray(payload.users) ? payload.users.map(value => String(value || 'Spectator')) : [];
    setPresence(payload.count ?? names.length);
    consumeIdentity(payload);

    // Current Duel-Bot presence exposes display names but not a socket->name map.
    // When this linked viewer is the only spectator, the one non-anonymous name is
    // unambiguously ours. With multiple viewers we wait for an explicit identity
    // event or our first echoed chat message rather than guessing.
    if (viewerToken && !resolvedViewerName && names.length === 1) {
      setViewerIdentity(names[0]);
    }

    const next = new Set(names);
    if (previousPresenceNames.size) {
      for (const name of next) {
        if (!previousPresenceNames.has(name)) {
          window.dispatchEvent(new CustomEvent('spectator:user_joined', { detail: { name } }));
        }
      }
    }
    previousPresenceNames = next;
  }

  function showJoinToast(name) {
    const toast = document.getElementById('joinToast');
    if (!toast) return;
    toast.textContent = `@${String(name || 'Spectator')} joined the crowd`;
    toast.classList.add('show', 'highlight-blue');
    clearTimeout(showJoinToast.timer);
    showJoinToast.timer = setTimeout(() => toast.classList.remove('show', 'highlight-blue'), 5000);
  }
  window.addEventListener('spectator:user_joined', event => showJoinToast(event.detail?.name));

  if (!window.io || typeof window.io !== 'function') {
    input.disabled = true;
    send.disabled = true;
    setTypingText('Live chat unavailable.');
    return;
  }

  const namespaceUrl = `${new URL(apiBase).origin}/spectator-chat`;
  const socket = window.io(namespaceUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: NET_LIMITS.RECONNECT_ATTEMPTS,
    reconnectionDelay: 800,
    reconnectionDelayMax: NET_LIMITS.RECONNECT_DELAY_MAX_MS,
    timeout: 7000,
  });

  let lastSendAt = 0;
  let lastTypingEmitAt = 0;
  let typingStopTimer = null;
  const MIN_SEND_GAP_MS = 1200;

  function joinRoom() {
    socket.emit('join_room', {
      session: sessionId,
      ...(viewerToken ? { token: viewerToken } : {}),
    });
  }

  socket.on('connect', () => {
    setTypingText('');
    input.disabled = false;
    send.disabled = false;
    joinRoom();
  });

  socket.on('disconnect', () => {
    setPresence(0);
    setTypingText('Chat reconnecting…');
  });

  socket.on('connect_error', () => {
    setTypingText('Chat reconnecting…');
  });

  socket.on('error', payload => {
    const text = String(payload?.error || 'Chat error');
    if (/session not found|session\/roomid required/i.test(text)) {
      input.disabled = true;
      send.disabled = true;
      setTypingText('Chat session unavailable.');
    }
  });

  socket.on('history', payload => {
    if (!payload || String(payload.roomId || '') !== sessionId) return;
    consumeIdentity(payload);
    renderHistory(payload.messages);
  });

  // Forward-compatible acknowledgement: the server can emit this after resolving
  // the viewer token without exposing any player-seat/private duel information.
  socket.on('identity', payload => consumeIdentity(payload));

  socket.on('presence', handlePresence);

  socket.on('typing', payload => {
    if (!payload || String(payload.roomId || '') !== sessionId) return;
    const users = Array.isArray(payload.users) ? payload.users.filter(id => String(id) !== String(socket.id)) : [];
    setTypingText(users.length ? (users.length === 1 ? 'Someone is typing…' : `${users.length} spectators are typing…`) : '');
  });

  socket.on('message', msg => {
    if (!msg || String(msg.roomId || '') !== sessionId) return;
    if (msg.userId && String(msg.userId) === String(socket.id)) setViewerIdentity(msg.name);
    appendMessage(msg);
  });

  function emitTyping(active) {
    if (!socket.connected) return;
    socket.emit('typing', Boolean(active));
  }

  input.addEventListener('input', () => {
    if (pageHidden()) return;
    const now = Date.now();
    if (now - lastTypingEmitAt >= NET_LIMITS.TYPING_MIN_INTERVAL_MS) {
      emitTyping(true);
      lastTypingEmitAt = now;
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => emitTyping(false), NET_LIMITS.TYPING_IDLE_STOP_MS);
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = String(input.value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text || !socket.connected) return;

    const now = Date.now();
    if (now - lastSendAt < MIN_SEND_GAP_MS) {
      setTypingText('Slow down a bit.');
      return;
    }

    lastSendAt = now;
    input.value = '';
    clearTimeout(typingStopTimer);
    emitTyping(false);
    socket.emit('chat_message', text);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket.connected) {
      setTimeout(joinRoom, NET_LIMITS.VISIBILITY_RESUME_DELAY_MS);
    }
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(typingStopTimer);
    if (socket.connected) emitTyping(false);
    socket.disconnect();
  }, { once: true });
})();
