import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const spectator = read('scripts/spectatorview.js');
const chat = read('scripts/chatClient.js');
const html = read('index.html');
const css = read('styles/spectator.css');
const manifest = JSON.parse(read('data/card-manifest.json'));

test('uses exactly the canonical per-session spectator endpoint', () => {
  assert.match(spectator, /\/duel\/\$\{encodeURIComponent\(sessionId\)\}\/spectator/);
  assert.doesNotMatch(spectator, /\/duel\/(?:current|state)/);
  assert.doesNotMatch(spectator, /safeView|allowEmpty/);
  assert.doesNotMatch(spectator, /\/me\//);
});

test('viewer token is not used to choose player identity or fetch private duel state', () => {
  assert.doesNotMatch(spectator, /DUEL_PLAYER_NAME|player1=|player2=|p1name|p2name|opponentToken|role=/);
  const loadStart = spectator.indexOf('async function loadState()');
  const loadEnd = spectator.indexOf('async function loadCardManifest()');
  const loadStateBlock = spectator.slice(loadStart, loadEnd > loadStart ? loadEnd : undefined);
  assert.doesNotMatch(loadStateBlock, /viewerToken|searchParams|token/);
  assert.match(spectator, /player\.displayName/);
});

test('render signature includes revision and public field identity', () => {
  assert.match(spectator, /fieldSignature\(vm\.player1\.field\)/);
  assert.match(spectator, /fieldSignature\(vm\.player2\.field\)/);
  assert.match(spectator, /vm\.revision/);
});

test('chat matches the Duel-Bot spectator-chat namespace and event contract', () => {
  for (const required of ['/spectator-chat', "'join_room'", "'history'", "'presence'", "'typing'", "'chat_message'", "'message'"]) {
    assert.ok(chat.includes(required), `missing ${required}`);
  }
  assert.doesNotMatch(chat, /chat:send|chat:message|spectator:joined/);
  assert.doesNotMatch(chat, /innerHTML\s*=/);
  assert.doesNotMatch(chat, /DUEL_PLAYER_NAME|qs\.get\(['"]user['"]\)/);
});

test('spectator count is driven by server presence/state, not a local fake count', () => {
  assert.doesNotMatch(chat, /setPresence\(1\)/);
  assert.match(chat, /payload\.count/);
  assert.match(spectator, /vm\.spectatorCount/);
});

test('legacy ME and GitHub UI routing are removed', () => {
  const joined = `${html}\n${spectator}\n${chat}`;
  assert.doesNotMatch(joined, /sv13\.me|\?me=|ME_BASE|madv313\.github\.io/);
  assert.match(joined, /https:\/\/sv13tcg\.com\//);
});

test('BGM preference uses the actual key and is initialized in one client path', () => {
  assert.match(spectator, /sv13_spectator_bgm\.muted/);
  assert.doesNotMatch(spectator, /setItem\(['"]STORE_KEY['"]/);
  assert.doesNotMatch(html, /setupSpectatorMusic|sv13_spectator_bgm\.muted/);
});

test('practice CSS targets the body correctly', () => {
  assert.match(css, /body\.practice-mode/);
  assert.doesNotMatch(css, /\.practice-mode\s+body/);
});

test('card manifest covers 000-127 and points at the verified collection asset host', () => {
  assert.equal(Object.keys(manifest.cards).length, 128);
  assert.equal(manifest.assetBase, 'https://collection.sv13tcg.com/images/cards');
  assert.equal(manifest.cardBack, '000_CardBack_Unique.png');
  assert.equal(manifest.cards['000'].image, '000_CardBack_Unique.png');
  assert.equal(manifest.cards['034'].image, '034_CombatBoots_Defense.png');
  assert.ok(manifest.cards['127']);
  assert.match(spectator, /https:\/\/collection\.sv13tcg\.com\/images\/cards/);
  assert.doesNotMatch(spectator, /sv13tcg\.com\/assets\/cards/);
});

test('linked spectator identity is never browser-authored and can resolve from server chat events', () => {
  assert.match(chat, /Resolving linked spectator/);
  assert.match(chat, /Spectating as \$\{clean\}/);
  assert.match(chat, /socket\.on\('identity'/);
  assert.match(chat, /msg\.userId[\s\S]*socket\.id[\s\S]*setViewerIdentity\(msg\.name\)/);
  assert.doesNotMatch(chat, /searchParams\.get\(['"]name['"]\)|qs\.get\(['"]user['"]\)|displayName:\s*viewer/);
});

test('winner rendering is single-source and server-authoritative', () => {
  assert.match(html, /id="duelResult"/);
  assert.doesNotMatch(html, /spectator-summary-overlay/);
  assert.doesNotMatch(spectator, /detectWinnerFromState|hp\s*<=\s*0/);
  assert.match(spectator, /vm\.winner/);
});

test('room traffic is scoped to the requested session id', () => {
  assert.match(chat, /socket\.emit\('join_room',\s*\{[\s\S]*?session:\s*sessionId/);
  assert.match(chat, /payload\.roomId[^\n]*sessionId/);
});

test('GitHub Pages custom domain files are present', () => {
  assert.equal(read('CNAME').trim(), 'spectate.sv13tcg.com');
  assert.ok(fs.existsSync(path.join(root, '.nojekyll')));
});
