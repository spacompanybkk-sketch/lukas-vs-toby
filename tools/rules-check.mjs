#!/usr/bin/env node
/**
 * The live check of database.rules.json against the deployed database, on the `v2test` root
 * only. It is for phase 4a Task 7, AFTER Michal has approved and the rules are deployed:
 *
 *   LVT_TEST_GROWNUP_CODE=<code for v2test> node tools/rules-check.mjs --yes-live
 *
 * Every row below makes one request a forger (or the honest game) would make and says what the
 * rules must answer. It prints a table and exits 1 on any surprise. It uses slots p29 and p30 of
 * `v2test` and removes them again at the end (and at the start, in case an earlier run stopped
 * half-way) with the grown-up proof. `v2test/admin/secret` is set on the first run and can never
 * be changed afterwards except with the current code (the script changes it and back), so keep
 * the same four-digit LVT_TEST_GROWNUP_CODE for every run.
 *
 * No SDK; plain fetch to the REST API. Never touches `v2`, `presence`, `rooms` or `challenges`
 * except the read-only check of `presence`.
 */
import { createHash } from 'node:crypto';

const DATABASE_URL = 'https://lukas-toby-plants-vs-zombies-default-rtdb.firebaseio.com';
const R = 'v2test';
const SV = { '.sv': 'timestamp' };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pinHash = (slot, pin) => sha(`lvt2|${slot}|${pin}`);

if (!process.argv.includes('--yes-live')) {
  console.error('This talks to the live database (v2test root). Run only with Michal\'s go-ahead, with --yes-live.');
  process.exit(2);
}
const code = process.env.LVT_TEST_GROWNUP_CODE;
if (!code) {
  console.error('Set LVT_TEST_GROWNUP_CODE (the grown-up code used for v2test).');
  process.exit(2);
}
// As src/cloud/hash.ts grownUpHash: four digits, SHA-256 of `lvt2|grown-up|<code>`.
if (!/^\d{4}$/.test(code)) {
  console.error('LVT_TEST_GROWNUP_CODE must be four digits.');
  process.exit(2);
}
const G = sha(`lvt2|grown-up|${code}`);
const G2 = sha(`lvt2|grown-up|${code}-next`);
const WRONG = 'f'.repeat(64);

async function call(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${DATABASE_URL}/${path}.json`, {
      method,
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: String(e) };
  } finally {
    clearTimeout(timer);
  }
}
const get = (p) => call('GET', p);
const put = (p, b) => call('PUT', p, b);
const patch = (b) => call('PATCH', R, b);

const save = (slot, name, extra = {}) => ({
  v: 1, slot, name, picture: 'peashooter', coins: 0, upgrades: {},
  plants: { stars: {}, unlocked: [] }, zombies: { stars: {}, unlocked: [] },
  bestWave: 0, versusWins: 0, computerWins: 0, difficulty: { plants: 'medium', zombies: 'medium' },
  importedOld: false, updatedAt: Date.now() - 1000, ...extra,
});
const row = (slot, name, extra = {}) => ({
  slot, name, picture: 'peashooter', stars: 0, wave: 0, versusWins: 0, computerWins: 0, updatedAt: SV, ...extra,
});
const createBody = (slot, name, hash) => ({
  [`secrets/${slot}`]: hash,
  [`saves/${slot}/${hash}`]: { save: JSON.stringify(save(slot, name)), touch: SV },
  [`players/${slot}`]: { name, picture: 'peashooter' },
  [`board/${slot}`]: row(slot, name),
});
const ownerWrite = (slot, name, hash, rowExtra = {}) => ({
  [`saves/${slot}/${hash}`]: { save: JSON.stringify(save(slot, name)), touch: SV },
  [`board/${slot}`]: row(slot, name, rowExtra),
});
const removeBody = (slot) => ({
  [`secrets/${slot}`]: null, [`saves/${slot}`]: null, [`players/${slot}`]: null, [`board/${slot}`]: null,
  [`admin/proof/${G}`]: { touch: SV },
});

const A = 'p29';
const B = 'p30';
const hA = pinHash(A, '123');
const hB = pinHash(B, '456');

/** [what, request, expected HTTP status]. 200 = allowed, 401 = refused by the rules. */
const ROWS = [
  // Setup and honest use.
  ['grown-up code: set if none (200), or already set (401)', () => put(`${R}/admin/secret`, G), [200, 401]],
  ['grown-up proof with the right code', () => put(`${R}/admin/proof/${G}`, { touch: SV }), 200],
  ['cleanup before: remove p29 with the grown-up proof', () => patch(removeBody(A)), 200],
  ['cleanup before: remove p30 with the grown-up proof', () => patch(removeBody(B)), 200],
  ['create p29 (secret + save + player + board in one update)', () => patch(createBody(A, 'CheckA', hA)), 200],
  ['create p30', () => patch(createBody(B, 'CheckB', hB)), 200],
  ['players are public', () => get(`${R}/players`), 200],
  ['board is public', () => get(`${R}/board`), 200],
  ['owner reads own save at the exact path', () => get(`${R}/saves/${A}/${hA}`), 200],
  ['owner writes save + board row', () => patch(ownerWrite(A, 'CheckA', hA, { stars: 12 })), 200],

  // Reads that must fail.
  ['read the v2test root', () => get(R), 401],
  ['read secrets', () => get(`${R}/secrets`), 401],
  ['read one secret', () => get(`${R}/secrets/${A}`), 401],
  ['list a slot\'s saves', () => get(`${R}/saves/${A}`), 401],
  ['read a save with a wrong hash', () => get(`${R}/saves/${A}/${WRONG}`), 401],
  ['read the grown-up secret', () => get(`${R}/admin/secret`), 401],
  ['read the grown-up proofs', () => get(`${R}/admin/proof`), 401],

  // Forged writes (review focus 3).
  ['save under a wrong hash', () => patch({ [`saves/${A}/${WRONG}`]: { save: JSON.stringify(save(A, 'CheckA')), touch: SV } }), 401],
  ['board row without the pin proof', () => put(`${R}/board/${A}`, row(A, 'CheckA', { stars: 240 })), 401],
  ['player row without the pin proof', () => put(`${R}/players/${A}`, { name: 'Hacked', picture: 'peashooter' }), 401],
  ['another player\'s board row with your own proof', () => patch({ ...ownerWrite(B, 'CheckB', hB), [`board/${A}`]: row(A, 'CheckA') }), 401],
  ['stale touch (not this update\'s time)', () => patch({ [`saves/${A}/${hA}`]: { save: JSON.stringify(save(A, 'CheckA')), touch: 1 }, [`board/${A}`]: row(A, 'CheckA') }), 401],
  ['stars 241', () => patch(ownerWrite(A, 'CheckA', hA, { stars: 241 })), 401],
  ['stars 1.5', () => patch(ownerWrite(A, 'CheckA', hA, { stars: 1.5 })), 401],
  ['wave 10000', () => patch(ownerWrite(A, 'CheckA', hA, { wave: 10000 })), 401],
  ['versusWins 100000', () => patch(ownerWrite(A, 'CheckA', hA, { versusWins: 100000 })), 401],
  ['computerWins -1', () => patch(ownerWrite(A, 'CheckA', hA, { computerWins: -1 })), 401],
  ['updatedAt in the future', () => patch(ownerWrite(A, 'CheckA', hA, { updatedAt: Date.now() + 86_400_000 })), 401],
  ['name of 11 letters', () => patch(ownerWrite(A, 'CheckA', hA, { name: 'ABCDEFGHIJK' })), 401],
  ['unknown picture', () => patch(ownerWrite(A, 'CheckA', hA, { picture: 'boneMinion' })), 401],
  ['extra field in a board row', () => patch(ownerWrite(A, 'CheckA', hA, { email: 'x@y.z' })), 401],
  ['a 31st slot, every proof in place', () => patch(createBody('p31', 'Extra', pinHash('p31', '000'))), 401],
  ['slot p00', () => patch(createBody('p00', 'Extra', pinHash('p00', '000'))), 401],
  ['overwrite a secret', () => put(`${R}/secrets/${A}`, WRONG), 401],
  ['delete a secret', () => call('DELETE', `${R}/secrets/${A}`), 401],
  ['claim a secret without a player row', () => put(`${R}/secrets/p28`, WRONG), 401],
  ['a secret that is not 64 hex digits', () => patch({ 'secrets/p28': 'short', 'players/p28': { name: 'Eve', picture: 'peashooter' } }), 401],
  ['change the grown-up code', () => put(`${R}/admin/secret`, WRONG), 401],
  ['grown-up proof with a wrong code', () => put(`${R}/admin/proof/${WRONG}`, { touch: SV }), 401],
  ['delete a player with a wrong grown-up code', () => patch({ ...removeBody(A), [`admin/proof/${G}`]: null, [`admin/proof/${WRONG}`]: { touch: SV } }), 401],
  ['write anything else under v2test', () => put(`${R}/notes`, 'hi'), 401],

  // Fix round 1.
  ['owner deletes own player row (would leave a ghost)', () => patch({ [`saves/${A}/${hA}`]: { save: JSON.stringify(save(A, 'CheckA')), touch: SV }, [`players/${A}`]: null }), 401],
  ['owner deletes own board row', () => patch({ [`saves/${A}/${hA}`]: { save: JSON.stringify(save(A, 'CheckA')), touch: SV }, [`board/${A}`]: null }), 401],
  ['owner deletes own save', () => call('DELETE', `${R}/saves/${A}/${hA}`), 401],
  ['delete a slot\'s saves without the grown-up proof', () => call('DELETE', `${R}/saves/${A}`), 401],
  ['save as an object, not a string', () => patch({ [`saves/${A}/${hA}`]: { save: save(A, 'CheckA'), touch: SV }, [`board/${A}`]: row(A, 'CheckA') }), 401],
  ['save string over 20,000 characters', () => patch({ [`saves/${A}/${hA}`]: { save: 'x'.repeat(20001), touch: SV }, [`board/${A}`]: row(A, 'CheckA') }), 401],
  ['save string of exactly 20,000 characters', () => patch({ [`saves/${A}/${hA}`]: { save: 'x'.repeat(20000), touch: SV }, [`board/${A}`]: row(A, 'CheckA') }), 200],
  ['put the honest save back', () => patch(ownerWrite(A, 'CheckA', hA)), 200],
  ['change the grown-up code with the current proof', () => patch({ 'admin/secret': G2, [`admin/proof/${G}`]: { touch: SV } }), 200],
  ['change it back with the new proof', () => patch({ 'admin/secret': G, [`admin/proof/${G2}`]: { touch: SV } }), 200],

  // The old paths stay as they are (read-only check: nothing is written there).
  ['old presence path still readable', () => get('presence'), 200],

  // Grown-up reset, then cleanup.
  ['reset p29\'s pin with the grown-up proof', () => patch({
    [`secrets/${A}`]: pinHash(A, '999'),
    [`saves/${A}`]: { [pinHash(A, '999')]: { save: JSON.stringify(save(A, 'CheckA')), touch: SV } },
    [`board/${A}`]: row(A, 'CheckA'),
    [`admin/proof/${G}`]: { touch: SV },
  }), 200],
  ['the old pin no longer reads', () => get(`${R}/saves/${A}/${hA}`), 401],
  ['cleanup after: remove p29', () => patch(removeBody(A)), 200],
  ['cleanup after: remove p30', () => patch(removeBody(B)), 200],
];

let surprises = 0;
const out = [];
for (const [what, run, expected] of ROWS) {
  const { status } = await run();
  const ok = Array.isArray(expected) ? expected.includes(status) : status === expected;
  if (!ok) surprises += 1;
  out.push({ ok: ok ? 'ok' : 'SURPRISE', expected: Array.isArray(expected) ? expected.join('|') : expected, got: status, what });
}
console.table(out);
if (surprises > 0) {
  console.error(`${surprises} surprise(s).`);
  process.exit(1);
}
console.log(`All ${ROWS.length} rows as expected.`);
