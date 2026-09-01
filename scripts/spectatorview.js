// Canonical SV13 spectator client.
// Public duel state is read only from GET /duel/:session/spectator.
(function spectatorApp() {
  'use strict';

  const API_BASE = 'https://api.sv13tcg.com';
  const DEFAULT_IMAGE_BASE = 'https://collection.sv13tcg.com/images/cards';
  const HUB_URL = 'https://sv13tcg.com/';
  const SESSION_RE = /^[A-Za-z0-9_-]{12,128}$/;
  const POLL_MS = 2500;
  const ERROR_POLL_MS = 6000;
  const FINISHED_POLL_MS = 15000;
  const BGM_STORE_KEY = 'sv13_spectator_bgm.muted';

  const qs = new URLSearchParams(location.search);
  const sessionId = String(qs.get('session') || '').trim();
  const viewerToken = String(qs.get('token') || '').trim();

  // Expose only spectator routing/identity inputs. The token is never used to
  // choose Player 1/Player 2 or request private duel state.
  window.SV13_SPECTATOR = Object.freeze({
    sessionId,
    viewerToken,
    apiBase: API_BASE,
  });

  const state = {
    cardManifest: Object.create(null),
    imageBase: DEFAULT_IMAGE_BASE,
    cardBack: '000_CardBack_Unique.png',
    lastSignature: '',
    lastGood: null,
    timer: null,
    stopped: false,
    resultShownFor: null,
    errorCount: 0,
  };

  const $ = (id) => document.getElementById(id);

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value ?? '');
  }

  function setStatus(message, kind = 'live') {
    const el = $('spectator-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status status--${kind}`;
  }

  function trustedHubUrl() {
    const url = new URL(HUB_URL);
    if (viewerToken) url.searchParams.set('token', viewerToken);
    return url.toString();
  }

  function wireHub() {
    const link = $('hubBtn');
    if (link) link.href = trustedHubUrl();
  }

  function setupMusic() {
    if (window.__SV13_SPEC_BGM_READY__) return;
    const audio = $('spec-bgm');
    const button = $('specAudioToggle');
    if (!audio || !button) return;
    window.__SV13_SPEC_BGM_READY__ = true;

    try {
      const saved = localStorage.getItem(BGM_STORE_KEY);
      if (saved !== null) audio.muted = saved === 'true';
    } catch {}

    function updateButton() {
      button.textContent = audio.muted ? '🔇' : '🔊';
      button.setAttribute('aria-label', audio.muted ? 'Play background music' : 'Mute background music');
    }

    function persist() {
      try { localStorage.setItem(BGM_STORE_KEY, String(audio.muted)); } catch {}
    }

    button.addEventListener('click', () => {
      audio.muted = !audio.muted;
      audio.volume = audio.muted ? 0 : 1;
      persist();
      updateButton();
      audio.play().catch(() => {});
    });

    const unlock = () => {
      audio.play().catch(() => {});
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    updateButton();
  }

  function numericCardId(card) {
    const raw = card && typeof card === 'object'
      ? (card.cardId ?? card.card_id ?? card.id ?? card.number)
      : card;
    if (raw === null || raw === undefined) return null;
    const match = String(raw).match(/(\d{1,3})/);
    return match ? String(Number(match[1])).padStart(3, '0') : null;
  }

  function cardMeta(id) {
    return state.cardManifest[id] || null;
  }

  function isConcealed(card) {
    return Boolean(card?.concealed || card?.isFaceDown || numericCardId(card) === '000');
  }

  function cardImageUrl(card, faceDown = false) {
    if (faceDown || isConcealed(card)) {
      return `${state.imageBase}/${encodeURIComponent(state.cardBack)}`;
    }
    const id = numericCardId(card);
    const meta = id ? cardMeta(id) : null;
    const filename = meta?.image || card?.image || card?.filename || '';
    if (!filename) return `${state.imageBase}/${encodeURIComponent(state.cardBack)}`;
    if (/^https?:\/\//i.test(filename)) return filename;
    return `${state.imageBase}/${encodeURIComponent(String(filename).split('/').pop())}`;
  }

  function setCardImage(img, primary) {
    const fallback = `${state.imageBase}/${encodeURIComponent(state.cardBack)}`;
    img.onerror = null;
    img.addEventListener('error', function onError() {
      img.removeEventListener('error', onError);
      if (img.src !== fallback) img.src = fallback;
    }, { once: true });
    img.src = primary;
  }

  function createCard(card, forceFaceDown = false) {
    const id = numericCardId(card);
    const faceDown = forceFaceDown || isConcealed(card);
    const meta = id ? cardMeta(id) : null;
    const wrap = document.createElement('div');
    wrap.className = `card${faceDown ? ' face-down' : ''}`;
    wrap.dataset.cardId = faceDown ? '000' : (id || '');

    const img = document.createElement('img');
    img.alt = faceDown ? 'Face-down card' : (meta?.name || `Card ${id || ''}`.trim());
    img.loading = 'eager';
    img.decoding = 'async';
    setCardImage(img, cardImageUrl(card, faceDown));
    wrap.appendChild(img);

    if (!faceDown) {
      const label = document.createElement('div');
      label.className = 'card-name';
      label.textContent = meta?.name || (id ? `#${id}` : 'Card');
      wrap.appendChild(label);
    }
    return wrap;
  }

  function fieldSignature(field) {
    return (Array.isArray(field) ? field : []).map(card => {
      const id = numericCardId(card) || '000';
      return `${id}:${card?.isFaceDown ? 1 : 0}:${card?._fired ? 1 : 0}:${card?.concealed ? 1 : 0}`;
    }).join('|');
  }

  function normalizePlayer(player, seat) {
    if (!player || typeof player !== 'object') throw new Error(`Missing ${seat} public state`);
    const field = Array.isArray(player.field) ? player.field : [];
    const discard = Array.isArray(player.discard) ? player.discard : [];
    return {
      displayName: String(player.displayName || seat),
      controller: String(player.controller || 'human'),
      hp: Number.isFinite(Number(player.hp)) ? Number(player.hp) : 0,
      field,
      handCount: Math.max(0, Number(player.handCount) || 0),
      deckCount: Math.max(0, Number(player.deckCount) || 0),
      discardCount: discard.length,
      deckName: String(player.deckName || ''),
    };
  }

  function normalizePayload(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid spectator payload');
    if (String(raw.id || '') !== sessionId) throw new Error('Session mismatch');
    if (!Number.isFinite(Number(raw.revision))) throw new Error('Missing session revision');

    return {
      id: String(raw.id),
      mode: String(raw.mode || 'pvp'),
      status: String(raw.status || 'unknown'),
      revision: Number(raw.revision),
      currentPlayer: raw.currentPlayer === 'player2' ? 'player2' : (raw.currentPlayer === 'player1' ? 'player1' : null),
      turn: Math.max(0, Number(raw.turn) || 0),
      winner: raw.winner === 'player1' || raw.winner === 'player2' ? raw.winner : null,
      reason: String(raw.reason || ''),
      spectatorCount: Math.max(0, Number(raw.spectatorCount) || 0),
      player1: normalizePlayer(raw.player1, 'player1'),
      player2: normalizePlayer(raw.player2, 'player2'),
    };
  }

  function renderPlayer(seat, player, revision) {
    const root = $(seat);
    if (!root) return;

    setText(`${seat}-name`, player.displayName);
    setText(`${seat}-hp`, player.hp);

    const handCount = root.querySelector('.hand-count');
    const deckCount = root.querySelector('.deck-count');
    const discardCount = root.querySelector('.discard-count');
    if (handCount) handCount.textContent = String(player.handCount);
    if (deckCount) deckCount.textContent = String(player.deckCount);
    if (discardCount) discardCount.textContent = String(player.discardCount);

    const field = root.querySelector('.field');
    const hand = root.querySelector('.hand');
    if (field) {
      const signature = `${revision}:${fieldSignature(player.field)}`;
      if (field.dataset.renderSignature !== signature) {
        field.replaceChildren(...player.field.map(card => createCard(card, false)));
        field.dataset.renderSignature = signature;
      }
    }
    if (hand) {
      const signature = `${revision}:${player.handCount}`;
      if (hand.dataset.renderSignature !== signature) {
        const backs = Array.from({ length: player.handCount }, () => createCard({ cardId: '000', isFaceDown: true }, true));
        hand.replaceChildren(...backs);
        hand.dataset.renderSignature = signature;
      }
    }
  }

  function renderPresence(count) {
    setText('watching-count', `Spectators Watching: ${count}`);
    const chatPresence = $('chat-presence');
    if (chatPresence && !window.__SV13_CHAT_HAS_PRESENCE__) chatPresence.textContent = `${count} online`;
  }

  function reasonLabel(reason) {
    const labels = {
      hp_zero: 'HP reached 0',
      no_cards: 'A player ran out of playable cards',
      exhausted: 'Both players exhausted their remaining plays',
      combat_exhaustion: 'Both players exhausted their remaining combat options',
      cards_exhausted: 'Both players ran out of cards',
      forfeit: 'Forfeit',
      forfeited: 'Forfeit',
      abandoned: 'Duel abandoned',
    };
    return labels[reason] || reason.replace(/_/g, ' ') || 'Duel complete';
  }

  function showResult(vm) {
    if (state.resultShownFor === `${vm.id}:${vm.revision}`) return;
    state.resultShownFor = `${vm.id}:${vm.revision}`;

    const wrap = $('duelResult');
    const winner = $('duelResultWinner');
    const reason = $('duelResultReason');
    if (!wrap || !winner || !reason) return;

    if (vm.winner) {
      const player = vm[vm.winner];
      winner.textContent = `Winner: ${player?.displayName || vm.winner}`;
    } else {
      winner.textContent = 'Result: Draw';
    }
    reason.textContent = reasonLabel(vm.reason);
    wrap.hidden = false;
    wrap.classList.add('show');
  }

  function hideResult() {
    const wrap = $('duelResult');
    if (!wrap) return;
    wrap.classList.remove('show');
    wrap.hidden = true;
  }

  function renderState(vm) {
    const signature = [
      vm.revision,
      vm.status,
      vm.currentPlayer || '',
      vm.winner || '',
      vm.player1.hp,
      vm.player2.hp,
      vm.player1.handCount,
      vm.player2.handCount,
      vm.player1.deckCount,
      vm.player2.deckCount,
      vm.player1.discardCount,
      vm.player2.discardCount,
      fieldSignature(vm.player1.field),
      fieldSignature(vm.player2.field),
    ].join('::');

    document.body.classList.toggle('practice-mode', vm.mode === 'practice');
    document.body.classList.toggle('pvp-mode', vm.mode === 'pvp');
    renderPresence(vm.spectatorCount);

    if (vm.status !== 'live' && vm.status !== 'finished') {
      setText('player1-name', vm.player1.displayName);
      setText('player2-name', vm.player2.displayName);
      clearBoardForUnavailable();
      if (['expired', 'denied', 'cancelled', 'forfeited', 'abandoned'].includes(vm.status)) {
        setStatus(`Session ${vm.status}.`, 'error');
      } else {
        setStatus(`Session ${vm.status} — waiting for duel state.`, 'loading');
      }
      return;
    }

    if (signature !== state.lastSignature) {
      state.lastSignature = signature;
      renderPlayer('player1', vm.player1, vm.revision);
      renderPlayer('player2', vm.player2, vm.revision);

      $('player1')?.classList.toggle('active', vm.status === 'live' && vm.currentPlayer === 'player1');
      $('player2')?.classList.toggle('active', vm.status === 'live' && vm.currentPlayer === 'player2');

      if (vm.status === 'live') {
        const current = vm.currentPlayer ? vm[vm.currentPlayer]?.displayName : 'Waiting';
        setText('turn-display', vm.currentPlayer ? `Turn ${vm.turn} — ${current}` : `Turn ${vm.turn}`);
        setStatus(`${vm.mode === 'practice' ? 'Practice' : 'PvP'} duel live • Revision ${vm.revision}`, 'live');
      } else if (vm.status === 'finished') {
        setText('turn-display', 'Duel finished');
        setStatus(`Duel finished • Revision ${vm.revision}`, 'finished');
      } else if (['expired', 'denied', 'cancelled', 'forfeited', 'abandoned'].includes(vm.status)) {
        setText('turn-display', 'Session is no longer active');
        setStatus(`Session ${vm.status}.`, 'error');
      } else {
        setText('turn-display', 'Waiting for duel to begin');
        setStatus(`Session ${vm.status}.`, 'loading');
      }
    }

    if (vm.status === 'finished') showResult(vm);
  }

  function clearBoardForUnavailable() {
    for (const seat of ['player1', 'player2']) {
      setText(`${seat}-hp`, '—');
      const root = $(seat);
      if (!root) continue;
      for (const el of root.querySelectorAll('.hand-count, .deck-count, .discard-count')) el.textContent = '—';
      root.querySelector('.field')?.replaceChildren();
      root.querySelector('.hand')?.replaceChildren();
      root.classList.remove('active');
    }
    setText('turn-display', '');
  }

  function nextDelay(vm) {
    if (document.hidden) return FINISHED_POLL_MS;
    if (vm?.status === 'finished') return FINISHED_POLL_MS;
    return state.errorCount ? ERROR_POLL_MS : POLL_MS;
  }

  function schedule(delay) {
    clearTimeout(state.timer);
    if (state.stopped) return;
    state.timer = setTimeout(loadState, delay);
  }

  async function loadState() {
    if (state.stopped) return;
    if (document.hidden) {
      schedule(FINISHED_POLL_MS);
      return;
    }

    const url = `${API_BASE}/duel/${encodeURIComponent(sessionId)}/spectator`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        state.errorCount = 0;
        state.lastGood = null;
        clearBoardForUnavailable();
        setStatus('Invalid or expired duel session.', 'error');
        return;
      }
      if (!response.ok) throw new Error(`Spectator API returned ${response.status}`);

      const vm = normalizePayload(await response.json());
      state.errorCount = 0;
      state.lastGood = vm;
      renderState(vm);
      schedule(nextDelay(vm));
    } catch (error) {
      state.errorCount += 1;
      console.error('[Spectator] state fetch failed:', error);
      if (state.lastGood) {
        setStatus('Connection interrupted — showing the last confirmed duel state.', 'warning');
      } else {
        clearBoardForUnavailable();
        setStatus('Spectator service unavailable. Retrying…', 'error');
      }
      schedule(ERROR_POLL_MS);
    }
  }

  async function loadCardManifest() {
    try {
      const response = await fetch('data/card-manifest.json?v=10', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Card manifest returned ${response.status}`);
      const payload = await response.json();
      state.cardManifest = payload?.cards && typeof payload.cards === 'object' ? payload.cards : Object.create(null);

      // The actual card PNGs are served by the Collection UI's canonical custom
      // domain. Do not route spectator images through the HUB domain; the HUB is
      // navigation, not an asset host.
      const declaredBase = String(payload?.assetBase || '').trim().replace(/\/+$/, '');
      if (/^https:\/\/collection\.sv13tcg\.com\/images\/cards$/i.test(declaredBase)) {
        state.imageBase = declaredBase;
      }

      const declaredBack = String(payload?.cardBack || '').trim();
      if (declaredBack) state.cardBack = declaredBack.split('/').pop();
    } catch (error) {
      console.warn('[Spectator] card manifest unavailable; card backs will be used as fallback.', error);
    }
  }

  function boot() {
    wireHub();
    setupMusic();
    $('duelResultClose')?.addEventListener('click', hideResult);
    $('duelResult')?.addEventListener('click', event => {
      if (event.target === $('duelResult')) hideResult();
    });

    if (!SESSION_RE.test(sessionId)) {
      clearBoardForUnavailable();
      setStatus('Invalid or missing duel session.', 'error');
      return;
    }

    loadCardManifest().finally(loadState);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !state.stopped) {
        clearTimeout(state.timer);
        loadState();
      }
    });
    window.addEventListener('focus', () => {
      if (!document.hidden && !state.stopped) {
        clearTimeout(state.timer);
        loadState();
      }
    });
    window.addEventListener('pagehide', () => {
      state.stopped = true;
      clearTimeout(state.timer);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
