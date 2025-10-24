// scripts/chatClient.js
import { io } from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
import { API_BASE } from './config.js'; // you already have this in your UI

const qs = new URLSearchParams(location.search);
const roomId = qs.get('session') || qs.get('duel') || (`practice:${qs.get('user') || 'anon'}`);
const name   = qs.get('user') || 'Spectator';
const userId = (localStorage.getItem('sv13.chat.id') || cryptoRandomId());
try { localStorage.setItem('sv13.chat.id', userId); } catch {}

const logEl    = document.getElementById('chat-log');
const formEl   = document.getElementById('chat-form');
const inputEl  = document.getElementById('chat-input');
const typingEl = document.getElementById('chat-typing');
const presEl   = document.getElementById('chat-presence');

const socket = io(API_BASE, { path: '/socket.io', transports: ['websocket'], withCredentials: false, forceNew: false, reconnection: true, reconnectionDelayMax: 5000, });
socket.on('connect', () => {
  socket.emit('join_room', { roomId, userId, name });
});

socket.on('history', ({ messages }) => {
  logEl.innerHTML = '';
  messages.forEach(renderMsg);
  scrollIfNearBottom();
});

socket.on('message', (msg) => {
  renderMsg(msg);
  scrollIfNearBottom(true);
});

socket.on('presence', ({ count }) => {
  presEl.textContent = `${count} online`;
});

let typingTimeout;
inputEl?.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1200);
});

socket.on('typing', ({ users }) => {
  typingEl.textContent = users.length ? `${users.length} typing…` : '';
});

formEl?.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = (inputEl.value || '').trim();
  if (!text) return;
  if (text.length > 500) return;
  socket.emit('chat_message', text);
  inputEl.value = '';
  socket.emit('typing', false);
});

function renderMsg({ userId: uid, name: uname, text, ts }) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-row' + (uid === userId ? ' me' : '');
  const when = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.innerHTML = `
    <div class="chat-bubble">
      <div class="chat-meta"><span class="chat-name">${escapeHtml(uname || 'Spectator')}${uid === userId ? ' (You)' : ''}</span><span class="chat-time">${when}</span></div>
      <div class="chat-text">${escapeHtml(text || '')}</div>
    </div>`;
  logEl.appendChild(wrap);
}

function scrollIfNearBottom(force = false) {
  const nearBottom = (logEl.scrollTop + logEl.clientHeight) >= (logEl.scrollHeight - 60);
  if (force || nearBottom) logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function cryptoRandomId(){ try{ return crypto.randomUUID(); } catch { return 'u-'+Math.random().toString(36).slice(2,10); } }
