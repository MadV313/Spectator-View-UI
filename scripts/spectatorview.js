// spectator view UI /scripts/spectatorview.js
(function () {
  const qs = new URLSearchParams(window.location.search);

  // ---- IDs / params ----
  const mode = (qs.get('mode') || 'duel').toLowerCase();
  const sessionId = qs.get('session') || qs.get('duelId') || '';
  const userName = qs.get('user') || '';

  // Token & API base (normalize to always include /api)
  const TOKEN = (window.PLAYER_TOKEN || qs.get('token') || '').trim();
  const rawApi = (window.API_BASE || qs.get('api') || '/api').replace(/\/+$/, '');
  const API_BASE = rawApi.endsWith('/api') ? rawApi : `${rawApi}/api`;

  // Card images
  const IMG_BASE = ((qs.get('imgbase') || 'images/cards') + '').replace(/\/+$/, '');
  const BACK_IMG_PRIMARY  = `${IMG_BASE}/000.png`;
  const BACK_IMG_FALLBACK = `${IMG_BASE}/000_WinterlandDeathDeck_Back.png`;

  try { console.log('[Spectator] API_BASE =', API_BASE, 'IMG_BASE =', IMG_BASE, 'mode =', mode); } catch {}

  // ---- small helpers ----
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }

  if (mode === 'practice') document.body.classList.add('practice-mode');

  // ---- Music bootstrap (optional elements)
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

    const opt = { passive: true };
    const unlock = () => {
      audio.play().catch(() => {});
      try {
        if (localStorage.getItem(STORE_KEY) !== 'true') {
          audio.muted = false;
          updateBtn();
        }
      } catch {}
      window.removeEventListener('pointerdown', unlock, opt);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', vis);
    };
    const vis = () => { if (!document.hidden) audio.play().catch(() => {}); };

    window.addEventListener('pointerdown', unlock, opt);
    window.addEventListener('keydown', unlock);
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

  // ---- Card id helpers ----
  function to3(n) { return String(n).padStart(3, '0'); }

  function extractNumericId(card) {
    // Accept several shapes: number, "095", "095_Flashlight_Utility", "M4A1_Attack(001)"
    if (!card) return null;

    const direct = card.cardId ?? card.numericId ?? card.id ?? card.code ?? card.name;
    if (direct == null) return null;

    if (typeof direct === 'number') return to3(direct);

    const s = String(direct);
    // Prefer a leading 1–3 digit number
    const mLead = s.match(/^\D?(\d{1,3})\D/); // e.g., "095_Flashlight", "x095y"
    if (mLead) return to3(mLead[1]);

    // Look for any 1–3 digit token in the string
    const mAny = s.match(/(\d{1,3})/);
    if (mAny) return to3(mAny[1]);

    return null;
  }

  function makeFaceUpSrc(card) {
    const id3 = extractNumericId(card);
    return id3 ? `${IMG_BASE}/${id3}.png` : null;
  }

  // ---- Rendering ----
  function renderCard(card, isFaceDown) {
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
      const src = makeFaceUpSrc(card);
      if (src) {
        img.src = src;
        img.onerror = () => { /* keep broken to signal mismatch, don’t fake back for face-up */ };
        const id3 = extractNumericId(card);
        name.textContent = id3 || '';
      } else {
        // No numeric art found; show back so layout doesn’t collapse
        img.src = BACK_IMG_PRIMARY;
        img.onerror = () => { img.src = BACK_IMG_FALLBACK; };
        name.textContent = '';
      }
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
      field && field.appendChild(renderCard(card, false))
    );

    // Redacted hands: draw facedown count
    const facedown = Number(playerData?.handCount ?? (playerData?.hand?.length ?? 0)) || 0;
    for (let i = 0; i < facedown; i++) {
      hand && hand.appendChild(renderCard({ cardId: 0 }, true));
    }
  }

  // ---- Normalizer: accepts many backend shapes and returns a single view model
  function normalizeState(raw) {
    // figure current turn
    const current =
      raw?.currentPlayer ||
      raw?.turn?.current ||
      raw?.turn?.player ||
      raw?.activePlayer ||
      raw?.whoseTurn ||
      'player1';

    // pull spectators if present
    const spectators = Array.isArray(raw?.spectators) ? raw.spectators : [];

    // locate players in various formats
    let p1 = raw?.players?.player1 || raw?.players?.p1 || raw?.challenger || null;
    let p2 = raw?.players?.player2 || raw?.players?.p2 || raw?.opponent   || null;

    if (!p1 || !p2) {
      // players as array
      if (Array.isArray(raw?.players)) {
        p1 = raw.players[0] || p1;
        p2 = raw.players[1] || p2;
      }
      // fallback by roles
      p1 = p1 || raw?.player1 || raw?.playerA || raw?.a || null;
      p2 = p2 || raw?.player2 || raw?.playerB || raw?.b || null;
    }

    // unify hp/field/handCount/name for each
    function unifyPlayer(p, defaults) {
      if (!p) return { name: defaults?.name || 'Player', hp: 200, field: [], handCount: 0 };

      const name = p.discordName || p.name || p.displayName || defaults?.name || 'Player';

      const hp =
        p.hp ?? p.HP ?? p.health ?? p.life ?? defaults?.hp ?? 200;

      // field may be under: field, board, battlefield, slots, inPlay
      const fieldRaw = p.field || p.board || p.battlefield || p.slots || p.inPlay || [];
      const field = Array.isArray(fieldRaw) ? fieldRaw : [];

      // hand length may be given directly or as array
      const handCount =
        p.handCount ??
        (Array.isArray(p.hand) ? p.hand.length : 0);

      return { name, hp: Number(hp) || 0, field, handCount };
    }

    const P1 = unifyPlayer(p1, { name: 'Challenger', hp: 200 });
    const P2 = unifyPlayer(p2, { name: 'Opponent',   hp: 200 });

    const vm = {
      currentPlayer: current,
      spectators,
      players: {
        player1: P1,
        player2: P2
      }
    };

    try {
      console.log('[Spectator] normalized:', {
        turn: vm.currentPlayer,
        p1: { name: P1.name, hp: P1.hp, field: P1.field.length, handCount: P1.handCount },
        p2: { name: P2.name, hp: P2.hp, field: P2.field.length, handCount: P2.handCount }
      });
    } catch {}
    return vm;
  }

  function renderSpectatorView(rawState) {
    const state = normalizeState(rawState);

    setText('#turn-display', `Current Turn: ${state.currentPlayer || 'player1'}`);
    setText('#watching-count', `Spectators Watching: ${Array.isArray(state.spectators) ? state.spectators.length : 0}`);

    const p1Name = state.players.player1.name || 'Challenger';
    const p2Name = state.players.player2.name || 'Opponent';
    setText('#player1-name', p1Name);
    setText('#player2-name', p2Name);

    renderPlayer('player1', state.players.player1);
    renderPlayer('player2', state.players.player2);
  }

  // ---- Polling with mild backoff on 429 ----
  let pollMs = 3000;

  async function fetchDuelStateOnce() {
    const buildUrl = (path) => {
      const url = new URL(apiUrl(path), location.origin);
      if (mode !== 'practice' && sessionId) url.searchParams.set('session', sessionId);
      url.searchParams.set('safeView', 'true'); // keep hands redacted
      if (TOKEN) url.searchParams.set('token', TOKEN);
      return url;
    };

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
            'Cache-Control': 'no-cache'
          },
          credentials: 'same-origin',
        });
        if (!res.ok) {
          if (res.status === 429) {
            // backoff a bit
            pollMs = Math.min(pollMs + 1000, 7000);
          }
          throw new Error(`Failed (${res.status}) on ${path}`);
        }
        pollMs = 3000; // reset on success
        return await res.json();
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
    } finally {
      // schedule next tick with current backoff value
      setTimeout(fetchDuelState, pollMs);
    }
  }

  // Kick off
  fetchDuelState();
})();
