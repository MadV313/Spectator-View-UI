// spectator view UI /scripts/spectatorview.js
(function () {
  const qs = new URLSearchParams(window.location.search);

  // ---- IDs / params ----
  const mode = (qs.get('mode') || 'duel').toLowerCase();
  const sessionId = qs.get('session') || qs.get('duelId') || '';
  const userName = qs.get('user') || '';

  // Token & API base (normalize to always include /api)
  const TOKEN = (window.PLAYER_TOKEN || qs.get('token') || '').trim();
  const apiParamRaw = qs.get('api');
  let apiParam = apiParamRaw ? decodeURIComponent(apiParamRaw) : '';
  const rawApi = (window.API_BASE || apiParam || '/api').replace(/\/+$/, '');
  const API_BASE = rawApi.endsWith('/api') ? rawApi : `${rawApi}/api`;

  // Card images
  const IMG_BASE = ((qs.get('imgbase') || 'images/cards') + '').replace(/\/+$/, '');
  // Manifest (loaded on boot if present)
  let CARD_MANIFEST = null;      // object map { "095": "095_Name_Attack.png", back?: "..." }
  let MANIFEST_READY = false;
  let BACK_OVERRIDE = null;      // string filename from manifest.back when present

  // 🔒 Sticky names cache so later sparse payloads can’t revert to generic labels
  const STICKY_NAMES = {
    player1: null,
    player2: null,
  };

  // URL name hints (optional)
  const P1_HINT = qs.get('p1') || qs.get('player1') || qs.get('p1name') || userName || null;
  const P2_HINT = qs.get('p2') || qs.get('player2') || qs.get('p2name') || null;

  // Fallback chain for card backs (prevents 404 spam). We’ll prepend manifest.back if available.
  const STATIC_BACK_CHAIN = [
    `${IMG_BASE}/000.png`,
    `${IMG_BASE}/000_CardBack_Unique.png`,
    `${IMG_BASE}/000_WinterlandDeathDeck_Back.png`
  ];
  function getBackChain() {
    return BACK_OVERRIDE
      ? [`${IMG_BASE}/${BACK_OVERRIDE}`, ...STATIC_BACK_CHAIN]
      : STATIC_BACK_CHAIN.slice();
  }

  try { console.log('[Spectator] API_BASE =', API_BASE, 'IMG_BASE =', IMG_BASE, 'mode =', mode); } catch {}

  // ---- small helpers ----
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }

  // simple onerror fallback chain for <img>
  function setImgWithFallbacks(img, urls) {
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) return;
      img.onerror = () => { i++; tryNext(); };
      img.src = urls[i];
    };
    tryNext();
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

    const toggle = () => {
      audio.muted = !audio.muted;
      try { localStorage.setItem(STORE_KEY, String(audio.muted)); } catch {}
      updateBtn();
      audio.play().catch(() => {});
    };
    btn.addEventListener('click', toggle);
    // Improve mobile reliability
    btn.addEventListener('touchend', (e) => { e.preventDefault(); toggle(); }, { passive: false });

    // ensure clickable even above overlays
    try {
      btn.style.pointerEvents = 'auto';
      btn.style.zIndex = '10001';
    } catch {}
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
    const mLead = s.match(/^\D?(\d{1,3})\D/);
    if (mLead) return to3(mLead[1]);

    const mAny = s.match(/(\d{1,3})/);
    if (mAny) return to3(mAny[1]);

    return null;
  }

  // --- Trap detection (range-only; no manifest needed)
  function isTrapIdByRange(id3) {
    const n = Number(String(id3).replace(/\D/g, ''));
    return Number.isFinite(n) && n >= 106 && n <= 120;
  }

  const FACEUP_SUFFIXES = [
    '', '_Attack', '_Utility', '_Support', '_Trap', '_Defense',
    '_Action', '_Item', '_Weapon', '_Armor', '_Vehicle', '_Supply', '_Unique'
  ];

  function makeFaceUpSrcCandidates(card) {
    const id3 = extractNumericId(card);
    if (!id3) return [];
    if (CARD_MANIFEST && typeof CARD_MANIFEST[id3] === 'string' && CARD_MANIFEST[id3].trim()) {
      return [`${IMG_BASE}/${CARD_MANIFEST[id3].trim()}`];
    }
    const list = FACEUP_SUFFIXES.map(s => `${IMG_BASE}/${id3}${s}.png`);
    return list;
  }

  // ---- Rendering ----
  // cache of last rendered counts to avoid unnecessary re-renders
  const lastRenderCounts = { player1: {}, player2: {} };

  function renderCard(card, forceFaceDown) {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('card');

    const img  = document.createElement('img');
    const name = document.createElement('div');
    name.classList.add('card-name');

    // If server sent explicit states, respect them; then enforce trap facedown unless _fired.
    const id3    = extractNumericId(card);
    const fired  = Boolean(card && card._fired);
    const statedFaceDown = Boolean(card && card.isFaceDown);
    const isTrap = isTrapIdByRange(id3);
    const isFaceDown = Boolean(forceFaceDown || statedFaceDown || (isTrap && !fired));

    if (isFaceDown) {
      setImgWithFallbacks(img, getBackChain());
      name.textContent = ''; // hide card id/name when facedown
    } else {
      const candidates = makeFaceUpSrcCandidates(card);
      if (candidates.length) {
        setImgWithFallbacks(img, candidates);
        name.textContent = id3 || '';
      } else {
        setImgWithFallbacks(img, getBackChain());
        name.textContent = '';
      }
    }

    // helpful flags for debugging
    cardDiv.dataset.cardId = id3 || '';
    cardDiv.dataset.isTrap = String(!!isTrap);
    cardDiv.dataset.fired  = String(!!fired);

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
    const deckEl = playerDiv.querySelector('.piles .deck-count');
    const discEl = playerDiv.querySelector('.piles .discard-count');

    // skip re-render if counts unchanged
    const key = playerKey;
    const prev = lastRenderCounts[key];
    const same =
      prev.hp === playerData?.hp &&
      prev.field === playerData?.field?.length &&
      prev.hand === playerData?.handCount &&
      prev.deck === playerData?.deckCount &&
      prev.disc === playerData?.discardCount;
    if (same) return;
    lastRenderCounts[key] = {
      hp: playerData?.hp,
      field: playerData?.field?.length,
      hand: playerData?.handCount,
      deck: playerData?.deckCount,
      disc: playerData?.discardCount
    };

    if (hpEl)   hpEl.textContent = `HP: ${playerData?.hp ?? 0}`;
    if (deckEl) deckEl.textContent = String(playerData?.deckCount ?? 0);
    if (discEl) discEl.textContent = String(playerData?.discardCount ?? 0);

    if (field)  field.innerHTML = '';
    if (hand)   hand.innerHTML  = '';

    // FIELD: enforce facedown for traps that haven't fired
    (playerData?.field || []).forEach(card => {
      const id3 = extractNumericId(card);
      const fired = Boolean(card && card._fired);
      const isTrap = isTrapIdByRange(id3);
      const facedown = Boolean(card && card.isFaceDown) || (isTrap && !fired);
      field && field.appendChild(renderCard(card, facedown));
    });

    // HAND: always facedown in spectator view, just render counts
    const facedown = Number(playerData?.handCount ?? (playerData?.hand?.length ?? 0)) || 0;
    for (let i = 0; i < facedown; i++) {
      hand && hand.appendChild(renderCard({ cardId: 0 }, true));
    }
  }

  // ---- Name fetch helper (optional, once) ----
  let _nameFetched = false;
  async function fetchNameFromTokenOnce() {
    if (_nameFetched || !TOKEN) return;
    _nameFetched = true;
    try {
      const url = apiUrl(`/me/${encodeURIComponent(TOKEN)}/stats`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const nick = (data?.discordName || data?.name || '').trim();
      if (nick) {
        STICKY_NAMES.player1 = STICKY_NAMES.player1 || nick;
        console.log('[Spectator] resolved player1 from token:', nick);
      }
    } catch {}
  }

  // ---- Winner overlay ----
  let summaryShown = false;
  function nameOrSticky(key, fallback) {
    return STICKY_NAMES[key] || $(`#${key}-name`)?.textContent || fallback;
  }
  function showWinnerOverlayFrom(stateLike) {
    if (summaryShown) return;
    summaryShown = true;

    const overlay = document.createElement('div');
    overlay.id = 'spectator-summary-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.78); z-index:10000;
      display:flex; align-items:center; justify-content:center; padding:24px;`;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#0f1114; color:#e6e6e6; width:min(900px, 96vw); border-radius:16px;
      box-shadow: 0 20px 60px rgba(0,0,0,.6); padding:22px 22px 16px;`;

    const wKey = stateLike?.winner || 'player1';
    const lKey = wKey === 'player1' ? 'player2' : 'player1';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px; font-weight:800; margin-bottom:6px;';
    title.textContent = `🏆 Winner: ${nameOrSticky(wKey, wKey)}`;

    const sub = document.createElement('div');
    sub.style.cssText = 'opacity:.8; margin-bottom:14px;';
    sub.textContent = 'Duel Summary (spectator)';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr; gap:14px;';

    const p1 = stateLike?.players?.player1 || {};
    const p2 = stateLike?.players?.player2 || {};
    const cardFor = (key, label, P) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border:1px solid #26303a; border-radius:12px; padding:12px;';
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700; margin-bottom:8px;';
      h.textContent = `${label} — ${nameOrSticky(key, key)}`;
      const list = document.createElement('div');
      list.innerHTML = `
        <div>HP: <b>${P.hp ?? 0}</b></div>
        <div>Field: <b>${(P.field||[]).length}</b></div>
        <div>Hand: <b>${P.handCount ?? (Array.isArray(P.hand) ? P.hand.length : 0)}</b></div>
        <div>Deck: <b>${P.deckCount ?? (Array.isArray(P.deck) ? P.deck.length : 0)}</b></div>
        <div>Discard: <b>${P.discardCount ?? (Array.isArray(P.discardPile) ? P.discardPile.length : 0)}</b></div>
      `;
      wrap.appendChild(h); wrap.appendChild(list);
      return wrap;
    };
    grid.appendChild(cardFor('player1', wKey === 'player1' ? 'Winner' : 'Opponent', p1));
    grid.appendChild(cardFor('player2', wKey === 'player2' ? 'Winner' : 'Opponent', p2));

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'margin-top:14px; padding:10px 14px; border-radius:10px; border:1px solid #2b3946; background:#16202a; color:#e6e6e6; cursor:pointer;';
    close.onclick = () => overlay.remove();

    panel.appendChild(title);
    panel.appendChild(sub);
    panel.appendChild(grid);
    panel.appendChild(close);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  // Listen for duel-end events forwarded by chatClient.js
  window.addEventListener('spectator:duel_result', (e) => {
    try {
      const payload = e.detail || {};
      if (payload && payload.winner) {
        showWinnerOverlayFrom(payload);
        pollMs = Math.max(pollMs, MAX_POLL_MS); // slow down polling after finish
      }
    } catch {}
  });

  // ---- Normalizer: matches your live payload
  function normalizeState(raw) {
    const current =
      raw?.currentPlayer ||
      raw?.turn?.current ||
      raw?.turn?.player ||
      raw?.activePlayer ||
      raw?.whoseTurn ||
      'player1';

    const watcherCount = Number(
      raw?.spectatorCount ??
      (Array.isArray(raw?.spectators) ? raw.spectators.length : 0)
    ) || 0;

    let p1 = raw?.players?.player1 || raw?.players?.p1 || raw?.challenger || null;
    let p2 = raw?.players?.player2 || raw?.players?.p2 || raw?.opponent   || null;

    // pick up bot data for practice duels
    if (!p2 && raw?.players?.bot) p2 = raw.players.bot;

    if (!p1 || !p2) {
      if (Array.isArray(raw?.players)) {
        p1 = raw.players[0] || p1;
        p2 = raw.players[1] || p2;
      }
      p1 = p1 || raw?.player1 || raw?.playerA || raw?.a || null;
      p2 = p2 || raw?.player2 || raw?.playerB || raw?.b || null;
    }

    function isGeneric(n) {
      const s = String(n || '').toLowerCase();
      return !s || s === 'player' || s === 'player 1' || s === 'player1' || s === 'challenger';
    }

    function unifyPlayer(p, defaults, key) {
      // compose fallback → sticky → url hint → defaults
      const urlHint =
        (key === 'player1' ? P1_HINT : P2_HINT) ||
        (key === 'player2' && mode === 'practice' ? 'Practice Bot' : null);

      const fallbackName = STICKY_NAMES[key] || urlHint || defaults?.name || 'Player';

      if (!p) {
        return {
          name: fallbackName,
          hp: 200,
          field: [],
          handCount: 0,
          deckCount: 0,
          discardCount: 0
        };
      }

      let computedName =
        p.discordName || p.name || p.displayName || fallbackName;

      // If the server gave us a generic label, prefer URL hint / sticky
      if (isGeneric(computedName)) {
        computedName = fallbackName;
      }

      // stick the first non-empty non-generic name we see
      if (computedName && !isGeneric(computedName) && !STICKY_NAMES[key]) {
        STICKY_NAMES[key] = computedName;
      }

      const hp = p.hp ?? p.HP ?? p.health ?? p.life ?? defaults?.hp ?? 200;
      const fieldRaw = p.field || p.board || p.battlefield || p.slots || p.inPlay || [];
      const field = Array.isArray(fieldRaw) ? fieldRaw : [];
      const handCount = p.handCount ?? (Array.isArray(p.hand) ? p.hand.length : 0);
      const deckCount = Array.isArray(p.deck) ? p.deck.length : (p.deckCount ?? 0);
      const discardCount = Array.isArray(p.discardPile) ? p.discardPile.length : (p.discardCount ?? 0);

      return { name: computedName, hp: Number(hp) || 0, field, handCount, deckCount, discardCount };
    }

    const P1 = unifyPlayer(p1, { name: 'Challenger', hp: 200 }, 'player1');
    const P2 = unifyPlayer(p2, { name: mode === 'practice' ? 'Practice Bot' : 'Opponent', hp: 200 }, 'player2');

    const vm = {
      currentPlayer: current,
      spectatorCount: watcherCount,
      players: { player1: P1, player2: P2 },
      winner: raw?.winner || null
    };

    try {
      console.log('[Spectator] normalized:', {
        turn: vm.currentPlayer,
        spectators: vm.spectatorCount,
        winner: vm.winner || '(none)',
        p1: { name: P1.name, hp: P1.hp, field: P1.field.length, hand: P1.handCount, deck: P1.deckCount, discard: P1.discardCount },
        p2: { name: P2.name, hp: P2.hp, field: P2.field.length, hand: P2.handCount, deck: P2.deckCount, discard: P2.discardCount }
      });
    } catch {}
    return vm;
  }

  function resolveTurnLabel(current, players) {
    const key = String(current || '').toLowerCase();
    if (key === 'player1' || key === 'player2') {
      return players?.[key]?.name || STICKY_NAMES[key] || key;
    }
    return current || 'player1';
  }

  function detectWinnerFromState(vm) {
    if (vm.winner) return vm.winner;
    const p1hp = Number(vm.players?.player1?.hp ?? 0);
    const p2hp = Number(vm.players?.player2?.hp ?? 0);
    if (p1hp <= 0 && p2hp > 0) return 'player2';
    if (p2hp <= 0 && p1hp > 0) return 'player1';
    if (p1hp <= 0 && p2hp <= 0) return 'player1'; // tie-breaker
    return null;
  }

  function renderSpectatorView(rawState) {
    const state = normalizeState(rawState);

    // Spectator presence count (keeps header in sync with chat presence)
    const wc = document.getElementById('watching-count');
    if (wc && Number.isFinite(state.spectatorCount)) {
      wc.textContent = `Spectators Watching: ${state.spectatorCount}`;
    }

    const turnName = resolveTurnLabel(state.currentPlayer, state.players);
    setText('#turn-display', `Current Turn: ${turnName}`);

    const p1Name = state.players.player1.name || STICKY_NAMES.player1 || 'Challenger';
    const p2Name = state.players.player2.name || STICKY_NAMES.player2 || 'Opponent';
    setText('#player1-name', p1Name);
    setText('#player2-name', p2Name);

    renderPlayer('player1', state.players.player1);
    renderPlayer('player2', state.players.player2);

    // Winner overlay (once)
    const computedWinner = detectWinnerFromState(state);
    if (computedWinner && !summaryShown) {
      showWinnerOverlayFrom({ ...state, winner: computedWinner });
      // after finish, relax polling to reduce API pressure
      pollMs = Math.max(pollMs, MAX_POLL_MS);
    }
  }

  // ---- Polling with robust backoff on 429 (and temporary errors)
  let pollMs = 3000;
  const BASE_POLL_MS = 3000;
  const MAX_POLL_MS = 15000;

  function bumpBackoff(prev) {
    // exponential-ish + small jitter
    const next = Math.min(Math.ceil(prev * 1.6) + Math.floor(Math.random() * 400), MAX_POLL_MS);
    return next;
  }

  // ETag + last-good snapshot to avoid flicker and cut 429s
  let lastETag = null;
  let lastGoodState = null;

  async function fetchDuelStateOnce() {
    const buildUrl = (path) => {
      const url = new URL(apiUrl(path), location.origin);
      if (mode !== 'practice' && sessionId) url.searchParams.set('session', sessionId);
      url.searchParams.set('safeView', 'true');
      // when no duel exists, return a harmless stub instead of 404 → easier polling
      url.searchParams.set('allowEmpty', 'true');
      if (TOKEN) url.searchParams.set('token', TOKEN);
      return url;
    };

    // Prefer the live endpoint; keep the old heartbeat as a last resort
    const candidates = ['/duel/state', '/duel/current'];

    let lastErr = null;
    for (const path of candidates) {
      try {
        const url = buildUrl(path);
        const headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
        if (lastETag) headers['If-None-Match'] = lastETag;

        const res = await fetch(url.toString(), { cache: 'no-store', headers });

        if (res.status === 304 && lastGoodState) {
          // Not modified → reuse last snapshot (no UI churn)
          pollMs = BASE_POLL_MS;
          return lastGoodState;
        }

        if (!res.ok) {
          if (res.status === 429) pollMs = bumpBackoff(pollMs);
          else if (res.status >= 500) pollMs = bumpBackoff(pollMs);
          throw new Error(`Failed (${res.status}) on ${path}`);
        }

        // success → reset backoff
        pollMs = BASE_POLL_MS;

        // Track ETag for conditional next time
        const et = res.headers.get('ETag');
        if (et) lastETag = et;

        const json = await res.json();
        lastGoodState = json;
        return json;
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
      setTimeout(fetchDuelState, pollMs);
    }
  }

  // ---- Manifest loader (non-blocking; best-effort)
  async function loadManifest() {
    try {
      const url = `${IMG_BASE}/manifest.json`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      if (!json || typeof json !== 'object') return;
      CARD_MANIFEST = json;
      if (typeof CARD_MANIFEST.back === 'string' && CARD_MANIFEST.back.trim()) {
        BACK_OVERRIDE = CARD_MANIFEST.back.trim();
      }
      MANIFEST_READY = true;
      try { console.log('[Spectator] card manifest loaded:', Object.keys(CARD_MANIFEST).length, 'entries'); } catch {}
    } catch {
      // optional; ignore errors
    }
  }

  (async () => {
    // Prime stickies from URL hints immediately (no flicker)
    if (P1_HINT && !STICKY_NAMES.player1) STICKY_NAMES.player1 = P1_HINT;
    if (P2_HINT && !STICKY_NAMES.player2) STICKY_NAMES.player2 = P2_HINT || (mode === 'practice' ? 'Practice Bot' : null);

    // Optionally resolve player1 from token once
    await fetchNameFromTokenOnce().catch(()=>{});

    await loadManifest().catch(() => {});
    fetchDuelState();
  })();
})();
