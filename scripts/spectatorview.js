// spectator view UI /scripts/spectatorview.js

(function () {
  const qs = new URLSearchParams(window.location.search);

  // ---- IDs / params ----
  const mode = (qs.get('mode') || 'duel').toLowerCase();
  const sessionId = qs.get('session') || qs.get('duelId') || '';
  const userName = qs.get('user') || '';

  // Token & API base: prefer globals set by index.html boot, then URL, then default
  const TOKEN = (window.PLAYER_TOKEN || qs.get('token') || '').trim();

  // Normalize API so it always includes `/api`
  const rawApi = (window.API_BASE || qs.get('api') || '/api').replace(/\/+$/, '');
  const API_BASE = rawApi.endsWith('/api') ? rawApi : `${rawApi}/api`;

  // Optional image base for card art (we’ll log what we resolved to)
  const IMG_BASE = ((qs.get('imgbase') || 'images/cards') + '').replace(/\/+$/, '');
  try { console.log('[Spectator] API_BASE =', API_BASE, 'IMG_BASE =', IMG_BASE); } catch {}

  // Back-of-card image (try numeric first, then named fallback)
  const BACK_IMG_PRIMARY = `${IMG_BASE}/000.png`;
  const BACK_IMG_FALLBACK = `${IMG_BASE}/000_WinterlandDeathDeck_Back.png`;

  // ---- small helpers ----
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }

  // Optional: visually accent practice mode
  if (mode === 'practice') document.body.classList.add('practice-mode');

  // ---- Music bootstrap (only if the HTML provides the elements) ----
  (function setupBgMusic() {
    if (window.__SPEC_MUSIC_INIT__) return;
    const audio = document.getElementById('spec-bgm');
    const btn   = document.getElementById('specAudioToggle');
    if (!audio || !btn) return;

    window.__SPEC_MUSIC_INIT__ = true;
    const STORE_KEY = 'sv13_spectator_bgm.muted';

    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (stored !== null) audio.muted = (stored === 'true');
    } catch {}

    function updateBtn() {
      btn.textContent = audio.muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', audio.muted ? 'Play background music' : 'Mute background music');
    }
    updateBtn();

    audio.play().catch(() => {});

    const unlock = () => {
      audio.play().catch(() => {});
      try {
        if (localStorage.getItem(STORE_KEY) !== 'true') {
          audio.muted = false;
          updateBtn();
        }
      } catch {}
      cleanupUnlock();
    };
    function cleanupUnlock() {
      window.removeEventListener('pointerdown', unlock, opt);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', vis);
    }
    const opt = { passive: true };
    window.addEventListener('pointerdown', unlock, opt);
    window.addEventListener('keydown', unlock);

    const vis = () => { if (!document.hidden) audio.play().catch(() => {}); };
    document.addEventListener('visibilitychange', vis);

    btn.addEventListener('click', () => {
      audio.muted = !audio.muted;
      try { localStorage.setItem(STORE_KEY, String(audio.muted)); } catch {}
      updateBtn();
      audio.play().catch(() => {});
    });
  })();

  // ---- UI boot ----
  if (userName) {
    const msg = document.createElement('p');
    msg.textContent = `@${userName} joined to watch the madness!`;
    msg.style.fontStyle = 'italic';
    msg.style.color = '#ccc';
    msg.style.textAlign = 'center';
    document.querySelector('.spectator-header')?.appendChild(msg);
  }

  if (mode !== 'practice' && !sessionId) {
    setText('#spectator-status', '❌ Missing session id.');
    console.error('[Spectator] No session id provided.');
    return;
  }

  // ---- Rendering ----
  function makeCardImgSrc(idStr) {
    // Primary expectation: numeric filenames like 001.png on Card-Collection-UI
    return `${IMG_BASE}/${idStr}.png`;
  }

  function renderCard(cardId, isFaceDown) {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('card');

    const img  = document.createElement('img');
    const name = document.createElement('div');
    name.classList.add('card-name');

    if (isFaceDown) {
      img.src = BACK_IMG_PRIMARY;
      img.onerror = () => { img.src = BACK_IMG_FALLBACK; };
      name.textContent = '';
    } else {
      const idStr = String(cardId).padStart(3, '0');
      img.src = makeCardImgSrc(idStr);
      // If this 404s, we don’t have a second pattern to try without filenames;
      // you can add a second convention here if you ever host non-numeric images.
      img.onerror = () => { /* leave as-is; back image would be misleading for face-up */ };
      name.textContent = idStr;
    }

    cardDiv.appendChild(img);
    cardDiv.appendChild(name);
    return cardDiv;
  }

  function renderPlayer(playerKey, playerData) {
    const playerDiv = document.getElementById(playerKey);
    if (!playerDiv) return;

    const hpEl   = playerDiv.querySelector('.hp');
    const field  = playerDiv.querySelector('.field');
    const hand   = playerDiv.querySelector('.hand');

    if (hpEl)   hpEl.textContent = `HP: ${playerData?.hp ?? 0}`;
    if (field)  field.innerHTML = '';
    if (hand)   hand.innerHTML  = '';

    (playerData?.field || []).forEach(card =>
      field && field.appendChild(renderCard(card.cardId, false))
    );
    (playerData?.hand || []).forEach(() =>
      hand && hand.appendChild(renderCard('000', true))
    );
  }

  function renderSpectatorView(state) {
    setText('#turn-display', `Current Turn: ${state.currentPlayer || 'player1'}`);
    setText('#watching-count', `Spectators Watching: ${Array.isArray(state.spectators) ? state.spectators.length : 0}`);

    // Optional names
    const p1Name = state?.players?.player1?.discordName || state?.players?.player1?.name || 'Challenger';
    const p2Name = state?.players?.player2?.discordName || state?.players?.player2?.name || 'Opponent';
    setText('#player1-name', p1Name);
    setText('#player2-name', p2Name);

    renderPlayer('player1', state?.players?.player1 || { hp: 200, field: [], hand: [] });
    renderPlayer('player2', state?.players?.player2 || { hp: 200, field: [], hand: [] });
  }

  // ---- Polling ----
  async function fetchDuelStateOnce() {
    // Prefer token both in query string AND header; backend can pick either.
    const buildUrl = (path) => {
      const url = new URL(apiUrl(path), location.origin);
      if (mode !== 'practice' && sessionId) url.searchParams.set('session', sessionId);
      url.searchParams.set('safeView', 'true'); // keep hands redacted for spectators
      if (TOKEN) url.searchParams.set('token', TOKEN);
      return url;
    };

    // Try canonical path first, then the legacy one
    const candidates = ['/duel/live/current', '/duel/current'];

    let lastErr = null;
    for (const path of candidates) {
      try {
        const url = buildUrl(path);
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(TOKEN ? { 'X-Player-Token': TOKEN } : {}),
          },
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`Failed (${res.status}) on ${path}`);
        const duelState = await res.json();
        return duelState;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Unable to fetch duel state');
  }

  async function fetchDuelState() {
    try {
      const state = await fetchDuelStateOnce();
      renderSpectatorView(state);
      setText('#spectator-status', 'Live match —');
    } catch (err) {
      console.error('[Spectator] fetch error:', err);
      setText('#spectator-status', 'Failed to load duel.');
    }
  }

  // Kick off & poll
  fetchDuelState();
  setInterval(fetchDuelState, 2000);
})();
