# SV13 Repo 9 — Spectator-View-UI live-fix audit

## Scope

The supplied `Spectator-View-UI-main(2).zip` was fully extracted and every repository source file was reviewed again after the live `spectate.sv13tcg.com` smoke test.

The live test proved the core Repo 9 architecture is working:

- unique practice session loads correctly
- HP changes update live
- turn/revision changes update live
- public field changes update live
- hand/deck/discard counts update live
- concealed hands remain concealed
- spectator chat can join the requested session and send messages

Two live defects remained and are addressed in this pass: card assets and linked spectator identity presentation.

## Live defect 1 — card images were pointed at a non-asset host

The supplied spectator client used:

`https://sv13tcg.com/assets/cards`

That is not where the current production card PNGs are actually published. The current Card-Collection-UI publishes the canonical card files from `images/cards` on its custom domain.

### Repair

The spectator manifest now declares:

`https://collection.sv13tcg.com/images/cards`

The runtime consumes that declared asset base instead of routing images through the HUB domain.

The card-back mismatch was also corrected. The master metadata still names card 000 as `000_WinterlandDeathDeck_Back.png`, but the current Card-Collection-UI repository actually contains `000_CardBack_Unique.png`. Spectator card backs now use the file that is really deployed.

Normal public cards still resolve by the canonical filenames in the existing 000–127 manifest.

## Live defect 2 — linked spectator identity presentation

The spectator frontend correctly did not trust a browser-provided username, but it only displayed `Linked spectator identity` when a viewer token existed and otherwise `Spectating anonymously`.

The current Duel-Bot chat server already resolves a supplied viewer token server-side to the linked Discord name before adding the spectator to the room. The current `/spectate` source also attempts to mint/reuse the linked token and include it in `PlayerLinks.spectator(session, token)`.

### Frontend repair

The frontend now:

- displays `Resolving linked spectator…` while a tokenized viewer is joining
- accepts a future explicit server `identity` acknowledgement without requiring another frontend change
- safely resolves the viewer name from presence when that linked viewer is the only spectator
- safely resolves the viewer name from the viewer's own echoed chat message (`userId === socket.id`)
- displays `Spectating as <discord name>` once resolved
- never uses that spectator identity to select or rename Player 1 or Player 2
- never accepts a username from `?name=`, `?user=`, localStorage, or other browser-authored identity hints

### Important deployment note

A spectator page opened with only `?session=<id>` cannot know the viewer's Discord identity. Anonymous public viewing remains intentional.

For named spectator/chat identity the launch URL must include the linked viewer token:

`?session=<id>&token=<viewer token>`

If the deployed `/spectate` command still outputs a session-only URL after the current Duel-Bot source is redeployed, the remaining issue is outside this frontend and should be traced in Duel-Bot's `cogs/spectate.js`, `utils/playerLinks.js`, and the linked-token storage call.

## Cache/deployment hardening

- spectator JS bumped to `v=10`
- chat JS bumped to `v=10`
- CSS URL bumped to `v=10`
- card manifest fetch bumped to `v=10`

This prevents the previous GitHub Pages/browser cache from masking the live fix.

## Preserved Repo 9 architecture

This pass does not regress the previously repaired design:

- one safe state endpoint: `GET /duel/:session/spectator`
- no global/current duel fallback
- no private hand identities or deck order
- session player names only come from server session metadata
- `/spectator-chat` room is scoped by session
- server-driven spectator count
- revision/card-signature render invalidation
- one server-authoritative winner modal
- one BGM initialization path
- no `sv13.me` / `?me=` architecture
- no GitHub production UI URL
- unique practice sessions remain supported

## Files updated in this pass

- `scripts/spectatorview.js`
- `scripts/chatClient.js`
- `data/card-manifest.json`
- `index.html`
- `package.json`
- `test/repo9-contract.test.mjs`
- `REPO9_AUDIT.md`
- `TEST_REPORT.md`
- `SHA256SUMS.txt`

No Duel-Bot files are included in this Repo 9 patch.
