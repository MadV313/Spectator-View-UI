// scripts/chatClient.js
// Browser-side Socket.IO client for Spectator Chat

import { io } from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';

// Pull API info from the globals your index.html sets
const qs = new URLSearchParams(location.search);

// window.API_BASE looks like: "https://duel-bot-production.up.railway.app/api"
// Chat websocket is at the backend ORIGIN, not /api
const API_BASE = (window.API_BASE || '').trim();
const backendOrigin = API_BASE
  ? new URL(API_BASE, location.href).origin
  : location.origin;

const name   = qs.get('user') || 'Spectator';
const mode   = (qs.get('mode') || '').toLowerCase();
const duelId = qs.get('session') || qs.get('duel') || '';
const roomId = duelId || (mode === 'practice'
  ? `practice:${name}`
  : `spectate:${name}`);

const logEl    = document.getElementById('chat-log');
const formEl   = document.getElementById('chat-form');
const inputEl  = document.getElementById('chat-input');
const typingEl = document.getElementById('chat-typing');
const presEl   = document.getElementById('chat-presence');

// Persist a stable userId for nicer "You" tagging
const LS_KEY = 'sv13.chat.uid';
const userId = (() => {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v) return v;
    const n = (crypto?.randomUUID?.() || ('u-' + Math.random().toString(36).slice(2, 10)));
    localStorage.setItem(LS_KEY, n);
    return n;
  } catch { return 'u-' + Math.random().toString(36).slice(2,10); }
})();

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
function atBottom() { return (logEl.scrollTop + logEl.clientHeight) >= (logEl.scrollHeight - 60); }
function scrollToBottom() { logEl.scrollTop = logEl.scrollHeight; }
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

// --- Socket.IO connection ---
const socket = io(backendOrigin, {
  path: '/socket.io',
  transports: ['websocket'],
  withCredentials: false,
  reconnection: true,
  reconnectionDelayMax: 5000,
});

socket.on('connect', () => {
  // join the chat room for this duel/practice session
  socket.emit('join_room', { roomId, userId, name });
});

socket.on('history', ({ messages = [] }) => {
  logEl.innerHTML = '';
  messages.forEach(renderMsg);
  scrollToBottom();
});

socket.on('message', (msg) => {
  const shouldStick = atBottom();
  renderMsg(msg);
  if (shouldStick) scrollToBottom();
});

socket.on('presence', ({ count }) => {
  presEl.textContent = `${count} online`;
});

let typingTimer;
inputEl?.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', false), 1200);
});

socket.on('typing', ({ users = [] }) => {
  typingEl.textContent = users.length ? `${users.length} typing…` : '';
});

// Form submit → send message (defensive: also prevents default)
formEl?.addEventListener('submit', (e) => {
  e.preventDefault(); e.stopPropagation();
  const text = (inputEl.value || '').trim();
  if (!text) return;
  if (text.length > 500) return;
  socket.emit('chat_message', text);
  inputEl.value = '';
  socket.emit('typing', false);
});

// Helpful console breadcrumb
try {
  console.log('[ChatClient] origin:', backendOrigin, 'roomId:', roomId, 'user:', name);
} catch {}
