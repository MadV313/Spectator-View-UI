// spectator view UI /scripts/spectatorview.js

(function () {
  const qs = new URLSearchParams(window.location.search);

  // ---- IDs / params ----
  const duelId   = qs.get('duelId') || '';
  const userName = qs.get('user')   || '';

  // Token & API base: prefer globals the HTML boot script sets, then URL, then default
  const TOKEN    = (window.PLAYER_TOKEN || qs.get('token') || '').trim();
  const API_BASE = ((window.API_BASE || qs.get('api') || '/api') + '').replace(/\/+$/, '');

  // Optional image base for card art
  const IMG_BASE = ((qs.get('imgbase') || 'images/cards') + '').replace(/\/+$/, '');

  // Back-of-card image
  const BACK_IMG = `${IMG_BASE}/000_WinterlandDeathDeck_Back.png`;

  // ---- small helpers ----
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }

  // ---- Music bootstrap (only if the HTML provides the elements) ----
  (function setupBgMusic() {
    if (window.__SPEC_MUSIC_INIT__) return;
    const audio = document.getElementById('spec-bgm');
    const btn   = document.getElementById('specAudioToggle');
    if (!audio || !btn) return; // page didn’t include the audio UI, skip

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

    audio.play().catch(() => { /* will unlock on gesture */ });

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

  if (!duelId) {
    setText('#spectator-status', '❌ Missing duelId in URL.');
    console.error('[Spectator] No duelId provided.');
    return;
  }

  // ---- Rendering ----
  function renderCard(cardId, isFaceDown) {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('card');

    const img  = document.createElement('img');
    const name = document.createElement('div');
    name.classList.add('card-name');

    if (isFaceDown) {
      img.src = BACK_IMG;
      name.textContent = '';
    } else {
      const idStr = String(cardId).padStart(3, '0');
      img.src = `${IMG_BASE}/${idStr}.png`;
      img.onerror = () => { img.src = BACK_IMG; };
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
  async function fetchDuelState() {
    try {
      // Prefer token in query string AND header; backend can pick either.
      const url = new URL(apiUrl(`/duel/live/${encodeURIComponent(duelId)}`), location.origin);
      if (TOKEN) url.searchParams.set('token', TOKEN);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(TOKEN ? { 'X-Player-Token': TOKEN } : {}),
        },
        credentials: 'same-origin',
      });

      if (!res.ok) throw new Error(`Failed to fetch duel state (${res.status})`);

      const duelState = await res.json();
      renderSpectatorView(duelState);
      setText('#spectator-status', 'Live match');
    } catch (err) {
      console.error('[Spectator] fetch error:', err);
      setText('#spectator-status', 'Failed to load duel.');
    }
  }

  // Kick off & poll
  fetchDuelState();
  setInterval(fetchDuelState, 2000);
})();
