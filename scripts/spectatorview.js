// spectator view UI /scripts/spectatorview.js

(function () {
  const qs = new URLSearchParams(window.location.search);

  // ---- IDs / params ----
  const mode = (qs.get('mode') || 'duel').toLowerCase();
  const sessionId = qs.get('session') || qs.get('duelId') || '';
  const userName = qs.get('user') || '';

  // Token & API base: prefer globals the HTML boot script sets, then URL, then default
  const TOKEN    = (window.PLAYER_TOKEN || qs.get('token') || '').trim();
  const API_BASE = ((window.API_BASE || qs.get('api') || '/api') + '').replace(/\/+$/, '');

  // Optional image base for card art
  const IMG_BASE = ((qs.get('imgbase') || 'images/cards') + '').replace(/\/+$/, '');

  // ---- small helpers ----
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }

  // Optional: visually accent practice mode
  if (mode === 'practice') document.body.classList.add('practice-mode');

  /* -----------------------------------------------------------
   * Image helpers with smart fallbacks (.png → .PNG, alt names)
   * ---------------------------------------------------------*/
  const EXT_FALLBACKS = ['.png', '.PNG', '.webp', '.jpg', '.jpeg'];

  // back image base names we’ll try (no extension)
  const BACK_BASES = [
    `${IMG_BASE}/000_WinterlandDeathDeck_Back`,
    `${IMG_BASE}/000_WinterlandDeathDeck-Back`,
    `${IMG_BASE}/000_WinterlandDeathDeck%20Back`,
  ];

  // tiny 1x1 transparent PNG as a last resort (data URL)
  const CLEAR_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMB9F2cK2sAAAAASUVORK5CYII=';

  function trySources(img, basesNoExt, exts = EXT_FALLBACKS, finalFallback = CLEAR_PIXEL) {
    let bi = 0, ei = 0;

    function next() {
      if (bi >= basesNoExt.length) {
        img.onerror = null;
        img.src = finalFallback;
        return;
      }
      const src = `${basesNoExt[bi]}${exts[ei]}`;
      img.onerror = () => {
        ei++;
        if (ei >= exts.length) { ei = 0; bi++; }
        next();
      };
      img.src = src;
    }
    next();
  }

  function setCardImage(img, idStr) {
    // for numbered cards we only need the base/id (no extension)
    const bases = [`${IMG_BASE}/${idStr}`];
    trySources(img, bases);
  }

  function setBackImage(img) {
    trySources(img, BACK_BASES);
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

  if (mode !== 'practice' && !sessionId) {
    setText('#spectator-status', '❌ Missing session id.');
    console.error('[Spectator] No session id provided.');
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
      setBackImage(img);
      name.textContent = '';
    } else {
      const idStr = String(cardId).padStart(3, '0');
      setCardImage(img, idStr);
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

    setText('#spectator-status', 'Live match');
  }

  // ---- Polling ----
  async function fetchDuelState() {
    try {
      // Prefer token in query string AND header; backend can pick either.
      const url = new URL(apiUrl('/duel/current'), location.origin);
      if (mode !== 'practice' && sessionId) url.searchParams.set('session', sessionId);
      url.searchParams.set('safeView', 'true'); // keep hands redacted for spectators
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
    } catch (err) {
      console.error('[Spectator] fetch error:', err);
      setText('#spectator-status', 'Failed to load duel.');
    }
  }

  // Kick off & poll
  fetchDuelState();
  setInterval(fetchDuelState, 2000);
})();
