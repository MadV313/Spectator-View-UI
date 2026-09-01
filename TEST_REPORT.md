# SV13 Repo 9 — Test Report

## Automated validation

Result: **PASS — 12/12 contract tests**

Command: `npm test`

Covered automatically:

1. Only `GET /duel/:session/spectator` is used for duel state.
2. Viewer token is not used for Player 1/2 identity or private state fetching.
3. Render invalidation includes session revision and public field-card identity/signature.
4. Socket.IO uses `/spectator-chat` and the current `join_room/history/presence/typing/message/chat_message` contract.
5. Spectator count comes from server presence/state instead of a client-forced value.
6. Legacy `ME`, `sv13.me`, and GitHub production routing are absent.
7. BGM has one initialization path and the corrected localStorage key.
8. Practice CSS targets `body.practice-mode` correctly.
9. Canonical card manifest contains all cards `000` through `127`, including the card back and Combat Boots.
10. Winner rendering is single-source and uses server winner/status rather than HP inference.
11. Chat/history/presence/typing/message traffic is filtered to the requested session room.
12. GitHub Pages custom-domain files target `spectate.sv13tcg.com`.

Additional validation:

- `node --check scripts/spectatorview.js` — PASS
- `node --check scripts/chatClient.js` — PASS
- `node --check scripts/net-hygiene.js` — PASS
- Forbidden legacy/protocol scan — PASS for `madv313.github.io`, `sv13.me`, `ME_BASE`, `/duel/current`, `/duel/state`, `chat:send`, `chat:message`, and `spectator:joined`.

## Live smoke tests still required after deployment

These require real Duel-Bot sessions and browsers and therefore are intentionally not claimed as automated passes:

- Open two simultaneous duel sessions and confirm spectators/chat remain isolated by session.
- Inspect the spectator network payload in DevTools and confirm no hand identities or future deck order are present.
- Invalid/expired session shows unavailable and never falls back to another duel.
- Unique practice session renders correctly.
- PvP session renders both real player names from session metadata.
- Two spectators verify chat history, presence count, typing indicator, and messages.
- Finish a match and confirm exactly one winner overlay.
- Replace a public field card while the field count stays the same and confirm the card redraws.

## Backend changes

None required for this Repo 9 frontend patch. The current Duel-Bot already exposes the canonical safe spectator serializer and `/spectator-chat` room contract consumed here.
