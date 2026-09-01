# SV13 Repo 9 — Live-fix test report

## Automated result

**PASS — 13/13 contract tests**

Command:

`npm test`

Covered:

1. only canonical `GET /duel/:session/spectator` state loading
2. viewer token cannot select Player 1/Player 2 or private duel state
3. revision + public field identity invalidates render cache
4. exact `/spectator-chat` event contract
5. server-driven spectator count
6. legacy ME/GitHub UI routing remains removed
7. one corrected BGM preference path
8. corrected practice CSS selector
9. all 000–127 card metadata plus verified Collection card asset host/card back
10. linked spectator identity remains server-derived and cannot be browser-authored
11. server-authoritative single winner UI
12. room traffic stays scoped to the requested session
13. GitHub Pages custom-domain files remain correct

Additional checks:

- `node --check scripts/spectatorview.js` — PASS
- `node --check scripts/chatClient.js` — PASS
- `node --check scripts/net-hygiene.js` — PASS
- stale asset-base scan — PASS (`sv13tcg.com/assets/cards` absent from production code)
- stale card-back filename scan — PASS (`000_WinterlandDeathDeck_Back.png` absent from production runtime/manifest)
- forbidden legacy protocol scan — PASS

## Current external-contract verification

The current Card-Collection-UI repository contains the live card assets under `images/cards`, including the verified `035_PlateCarrier_Defense.png` and the deployed card back `000_CardBack_Unique.png`.

The current Duel-Bot source resolves `join_room` viewer tokens server-side to the linked Discord name before registering spectator presence/chat. Its current `/spectate` source also attempts to pass a linked token into the spectator URL.

## Required live smoke test after deploying this ZIP

1. Open a fresh `/spectate` link and confirm the URL contains both `session=` and `token=` for a linked viewer.
2. Confirm face-down cards display the Winterland card-back art instead of broken-image placeholders.
3. Confirm visible field cards such as Plate Carrier/SVD render their real card art.
4. Confirm chat header changes from `Resolving linked spectator…` to `Spectating as <DiscordName>` when the token is present.
5. Send one chat message and confirm the rendered chat name is the linked Discord name.
6. Open the same session without `token=` and confirm anonymous public spectating still works intentionally.
7. Open two spectator browsers and confirm presence/chat/session data remain isolated and correct.

If step 1 still produces no `token=` after the current Duel-Bot deployment, do not modify this Spectator UI again for that symptom; inspect the Duel-Bot link-generation/token-storage path next.
