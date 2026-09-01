# SV13 Repo 9 — Spectator-View-UI audit and repair

## Scope

The supplied `Spectator-View-UI-main(1).zip` was fully extracted and every source file in the repository was reviewed. The current Duel-Bot session/spectator/chat contract was also checked so this frontend uses the backend that is actually present rather than inventing another protocol.

## Backend contract confirmed

The current Duel-Bot already provides the server pieces Repo 9 needs, so **no Duel-Bot files are included in this patch**:

- Public state: `GET /duel/:session/spectator`
- Public serializer: session id/mode/status/revision, current player, turn, winner/reason, Player 1/2 display names, controller, HP, public field, public discard, handCount, deckCount, deckName, spectatorCount.
- Concealed traps are redacted server-side to card `000`; the spectator browser never receives their real card id before reveal.
- Chat namespace: `/spectator-chat`
- Join: `join_room` with `{ session, token? }`
- Server events: `history`, `presence`, `typing`, `message`
- Client chat send: `chat_message`
- Spectator count is sourced from the same per-session room registry used by the safe spectator serializer.

## Critical findings in the supplied Spectator UI

### 1. Wrong/global duel-state lookup

The old client guessed between `/duel/current` and `/duel/state`, added `safeView/allowEmpty`, and special-cased practice mode. That could read the wrong session or depend on compatibility endpoints.

**Repair:** one endpoint only: `/duel/<session>/spectator`. A valid unique session is required for practice and PvP. No requested session ever falls back to unrelated global state.

### 2. Spectator identity could become Player 1 identity

The old code used `?user=`, player-name URL hints, local `DUEL_PLAYER_NAME`, and even `/me/:token/stats` to seed Player 1's displayed name.

**Repair:** Player 1 and Player 2 names now come only from the public session payload. Viewer token is optional and is used only for spectator chat identity and HUB navigation.

### 3. Chat protocol did not match Duel-Bot

The old client connected to the root Socket.IO namespace, never joined a session room, emitted `chat:send`, and listened for `chat:message`/`spectator:joined`. Those are not the current server events.

**Repair:** exact `/spectator-chat` contract, per-session `join_room`, server `history/presence/typing/message`, and client `chat_message`.

### 4. Chat name injection risk

The old chat renderer inserted the display name with `innerHTML`.

**Repair:** names, times, and text are built with DOM nodes and `textContent` only.

### 5. Fake spectator count

The old client forced presence to `1` on socket connect and then used mutation observers/periodic DOM rewriting to make the two counters agree.

**Repair:** both counters are driven from Duel-Bot's room-registry `presence` event and the safe state's authoritative `spectatorCount`.

### 6. Render cache missed card replacements

The old cache compared HP and array counts only. A field card could change while the field stayed the same length and the UI would not redraw it.

**Repair:** render signatures contain the session revision plus card id/concealed/fired state for every public field card.

### 7. Duplicate winner systems

The supplied build had one result modal in `index.html` plus a second dynamically-created winner overlay in `spectatorview.js`, with HP-based winner inference in the browser.

**Repair:** one result modal only. Winner/draw/reason comes from the server session state; the spectator client does not authoritatively infer a winner from HP.

### 8. Duplicate BGM initialization and broken STORE_KEY write

Music was initialized in both `index.html` and `spectatorview.js`; one path wrote literally to localStorage key `STORE_KEY`.

**Repair:** one BGM initializer and one real key: `sv13_spectator_bgm.muted`.

### 9. Card asset resolution was structurally broken

The repo contains no `images/cards` directory, yet the old client defaulted there and guessed filenames such as `001_Attack.png`; canonical files are named like `001_M4A1_Attack.png`.

**Repair:** images use the canonical `https://sv13tcg.com/assets/cards` host. A local metadata manifest generated from the current Duel-Bot `CoreMasterReference.json` maps all 000–127 ids to their exact canonical filenames and names. Image failures fall back to the canonical card back.

### 10. Practice CSS selector was backwards

The script adds `practice-mode` to `<body>`, but CSS used `.practice-mode body`.

**Repair:** `body.practice-mode`.

### 11. Legacy ME/GitHub routing

The old page persisted `sv13.me`, propagated `?me=`, and returned to the old GitHub HUB URL.

**Repair:** no ME path/storage. HUB destination is `https://sv13tcg.com/`; viewer token is appended only when one was explicitly supplied to the spectator page.

## Failure/reconnect behavior

- Missing or malformed session: explicit invalid-session state; no network guessing.
- 404: explicit invalid/expired-session state.
- API/network failure after a good state: preserve the last confirmed board and show a connection warning.
- API/network failure before any good state: show service unavailable and retry at a relaxed interval.
- Hidden tabs poll slowly; returning/focusing performs one catch-up fetch.
- Finished matches poll slowly while chat remains available.

## Files changed/added

- `index.html`
- `scripts/spectatorview.js`
- `scripts/chatClient.js`
- `scripts/net-hygiene.js`
- `styles/spectator.css`
- `data/card-manifest.json` (new, generated from current canonical Duel-Bot master)
- `CNAME` (new)
- `.nojekyll` (new)
- `package.json` (new test harness only)
- `test/repo9-contract.test.mjs` (new)
- `REPO9_AUDIT.md` (new)
- `TEST_REPORT.md` (new)
- `SHA256SUMS.txt` (new)

## Deliberately not changed

The repo's background image, snowfall GIF, and BGM MP3 are preserved and are not duplicated into the updated-files-only package. The Duel UI embedded spectator path is also left alone for now; the dedicated spectator app should be proven in live testing first, exactly as planned.
