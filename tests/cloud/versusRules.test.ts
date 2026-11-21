import { describe, expect, it } from 'vitest';
import { FAKE_DATABASE_URL, FakeDatabase } from '../../src/cloud/fakeCloud';
import type { Json } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import { T0, hex, makeClock, saveFor } from './helpers';

/**
 * The Versus rules (spec 7.2, 7.4, 8.1-8.4) against the fake database, which evaluates the very
 * `database.rules.json` that would be deployed. Each row is a request the honest game or a forger
 * would make, sent raw, the way `tools/rules-check.mjs` sends it to `v2test`.
 */

const SV = { '.sv': 'timestamp' };
/** A match id: 32 lowercase hex digits. */
const ID = '3f9c0a1e5b7d24c68e0f1a2b3c4d5e6f';
/** An ECDH public key as base64url: 87 characters. */
const PUB = `B${'J0n-_x'.repeat(14)}Qw`;
const BUILD = '2289558';
const G = hex('a');

type Root = 'v2' | 'v2test';

function raw(db: FakeDatabase) {
  const call = async (method: string, path: string, body?: Json): Promise<{ status: number; data: unknown }> => {
    const res = await db.fetch(`${FAKE_DATABASE_URL}/${path}.json`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() };
  };
  return {
    get: (p: string) => call('GET', p),
    put: (p: string, b: Json) => call('PUT', p, b),
    patch: (p: string, b: Json) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

/**
 * p01 Lukas (pin 123), p02 Toby (456): always on the Versus list. p05 (555): a stranger, not on
 * it. p06 (666): ticked in by the grown-up (code hash hex('a')).
 */
async function world(R: Root = 'v2') {
  const clock = makeClock();
  const db = new FakeDatabase({ now: clock.now });
  const cloud = createFakeCloud(db, R);
  const h: Record<string, string> = {
    p01: await pinHash('p01', '123'), p02: await pinHash('p02', '456'),
    p05: await pinHash('p05', '555'), p06: await pinHash('p06', '666'),
  };
  for (const s of ['p01', 'p02', 'p05', 'p06'] as const) expect(await cloud.createPlayer(saveFor(s), h[s]!)).toBe('ok');
  expect(await cloud.setGrownUpCode(G)).toBe('ok');
  const r = raw(db);
  expect((await r.patch(R, { 'vs/allowed/p06': true, [`admin/proof/${G}`]: { touch: SV } })).status).toBe(200);
  clock.t = T0 + 1000;
  /** `proof/<slot>/<its pin hash>` written in this very update. */
  const proof = (slot: string, hash = h[slot]!, touch: Json = SV): Record<string, Json> =>
    ({ [`proof/${slot}/${hash}`]: { touch } });
  /** One update at the root. */
  const send = (body: Record<string, Json>) => r.patch(R, body);
  const m = (rest: string) => `vs/matches/${ID}/${rest}`;
  return { db, r, h, clock, proof, send, m, R };
}

const here = (busy = false): Json => ({ at: SV, busy });
const invite = (extra: Record<string, Json> = {}): Json =>
  ({ pub: PUB, side: 'zombies', head: { slot: 'p02', step: 3 }, build: BUILD, at: SV, ...extra });
const reply = (extra: Record<string, Json> = {}): Json => ({ ok: true, pub: PUB, build: BUILD, at: SV, ...extra });
const meta = (extra: Record<string, Json> = {}): Json => ({
  v: 1, build: BUILD, seed: 2718281828, seats: { plants: 'p01', zombies: 'p02' }, host: 'p02',
  head: { slot: 'p02', step: 3 }, turn: 6, delay: 12, created: SV, ...extra,
});

/** Toby (p02) invites Lukas (p01); Lukas accepts and creates the match in the same update. */
async function matchWorld(R: Root = 'v2') {
  const w = await world(R);
  expect((await w.send({ ...w.proof('p02'), 'vs/lobby/p01/in/p02': invite() })).status).toBe(200);
  expect((await w.send({ ...w.proof('p01'), 'vs/lobby/p02/back/p01': reply(), [w.m('meta')]: meta() })).status).toBe(200);
  // Time moves on, so the proofs stored by those updates are stale from here.
  w.clock.t += 1000;
  return w;
}

describe.each<Root>(['v2', 'v2test'])('Versus rules under %s: the honest game', (R) => {
  it('a heartbeat on "who is here" with the pin proof, stamped with the server time', async () => {
    const { send, proof, db, clock, r } = await world(R);
    expect((await send({ ...proof('p01'), 'vs/here/p01': here() })).status).toBe(200);
    expect(db.peek(`${R}/vs/here/p01`)).toEqual({ at: clock.t, busy: false });
    clock.t += 15_000;
    expect((await send({ ...proof('p01'), 'vs/here/p01': here(true) })).status).toBe(200);
    expect((await r.get(`${R}/vs/here`)).status).toBe(200);
    expect((await r.get(`${R}/vs/allowed`)).data).toEqual({ p06: true });
  });

  it('a player the grown-up ticked in may be here, invite and play', async () => {
    const { send, proof, m, clock } = await world(R);
    expect((await send({ ...proof('p06'), 'vs/here/p06': here() })).status).toBe(200);
    clock.t += 1;
    expect((await send({ ...proof('p06'), 'vs/lobby/p01/in/p06': invite({ head: { slot: 'p06', step: 0 } }) })).status).toBe(200);
    clock.t += 1;
    expect((await send({
      ...proof('p06'), [m('meta')]: meta({ seats: { plants: 'p06', zombies: 'p01' }, host: 'p06', head: null }),
    })).status).toBe(200);
  });

  it('an invite and a reply with proof; meta with the invitee\'s proof in the same update as his reply', async () => {
    const { db, r } = await matchWorld(R);
    expect(db.peek(`${R}/vs/lobby/p01/in/p02`)).toMatchObject({ pub: PUB, side: 'zombies' });
    expect(db.peek(`${R}/vs/lobby/p02/back/p01`)).toMatchObject({ ok: true });
    expect((await r.get(`${R}/vs/lobby/p01`)).status).toBe(200);
    expect((await r.get(`${R}/vs/matches/${ID}`)).data).toMatchObject({ meta: { seed: 2718281828, turn: 6 } });
  });

  it('a declining reply needs no key', async () => {
    const { send, proof } = await world(R);
    expect((await send({ ...proof('p01'), 'vs/lobby/p02/back/p01': { ok: false, build: BUILD, at: SV } })).status).toBe(200);
    expect((await send({ ...proof('p01'), 'vs/lobby/p02/back/p01': { ok: true, build: BUILD, at: SV } })).status).toBe(401);
  });

  it('either party clears an invite or a reply with his proof', async () => {
    const { send, proof, db } = await matchWorld(R);
    expect((await send({ ...proof('p01'), 'vs/lobby/p01/in/p02': null })).status).toBe(200);
    expect((await send({ ...proof('p02'), 'vs/lobby/p02/back/p01': null })).status).toBe(200);
    expect(db.peek(`${R}/vs/lobby`)).toBeNull();
  });

  it('turns 0..2 of both seats, the same value again, ready, pause and its delete, sync, end, again, quit', async () => {
    const { r, m, db } = await matchWorld(R);
    const p = (b: Record<string, Json>) => r.patch(`${R}/vs/matches/${ID}`, b);
    expect((await p({ 'ready/plants': SV, 'ready/zombies': SV })).status).toBe(200);
    for (const k of ['t000000', 't000001', 't000002']) {
      expect((await p({ [`turns/plants/${k}`]: '{}', [`turns/zombies/${k}`]: '{"c":[[2,"place","sunflower",1,0]]}' })).status, k).toBe(200);
    }
    expect((await p({ 'turns/plants/t000001': '{}' })).status).toBe(200);
    expect((await p({ 'turns/plants/t009000': 'x'.repeat(400) })).status).toBe(200);
    expect((await p({ pause: { by: 'p02', n: 1 } })).status).toBe(200);
    expect((await r.del(`${R}/${m('pause')}`)).status).toBe(200);
    expect((await p({ 'sync/s1': { tick: 1800, snap: '{"x":1}' } })).status).toBe(200);
    expect((await p({ 'sync/s1': { tick: 1800, snap: '{"x":1}' } })).status).toBe(200);
    expect((await p({ 'end/plants': '{"w":"zombies","t":6120,"h":118734552}' })).status).toBe(200);
    expect((await p({ 'end/plants': '{"w":"zombies","t":6120,"h":118734552}' })).status).toBe(200);
    expect((await p({ 'again/plants': 1, 'again/zombies': 0 })).status).toBe(200);
    expect((await p({ quit: { by: 'p01' } })).status).toBe(200);
    expect((await p({ quit: { by: 'p01' } })).status).toBe(200);
    expect(db.peek(`${R}/${m('turns/zombies/t000002')}`)).toBe('{"c":[[2,"place","sunflower",1,0]]}');
  });

  it('the grown-up clears a player\'s here, lobby and proofs (an un-ticked or removed player)', async () => {
    const { send, proof, db, clock } = await matchWorld(R);
    expect((await send({ ...proof('p01'), 'vs/here/p01': here() })).status).toBe(200);
    db.poke(`${R}/proof/p01/${hex('0')}`, { touch: T0 }); // left behind under an old pin
    clock.t += 1;
    const gu = { [`admin/proof/${G}`]: { touch: SV } };
    expect((await send({ ...gu, 'vs/lobby/p02/back/p01': null })).status).toBe(200);
    clock.t += 1;
    expect((await send({ ...gu, 'vs/here/p01': null, 'vs/lobby/p01': null, 'proof/p01': null })).status).toBe(200);
    expect(db.peek(`${R}/vs/here`)).toBeNull();
    expect(db.peek(`${R}/vs/lobby`)).toBeNull();
    expect(db.peek(`${R}/proof/p01`)).toBeNull();
  });

  it('either device deletes the whole match', async () => {
    const { r, db } = await matchWorld(R);
    expect((await r.patch(`${R}/vs/matches/${ID}`, { 'turns/plants/t000000': '{}' })).status).toBe(200);
    expect((await r.del(`${R}/vs/matches/${ID}`)).status).toBe(200);
    expect(db.peek(`${R}/vs/matches`)).toBeNull();
  });
});

describe.each<Root>(['v2', 'v2test'])('Versus rules under %s: forged requests are refused', (R) => {
  it('a stranger not on the list cannot be here, invite, be invited or be seated', async () => {
    const { send, proof, m } = await world(R);
    expect((await send({ ...proof('p05'), 'vs/here/p05': here() })).status).toBe(401);
    expect((await send({ ...proof('p05'), 'vs/lobby/p01/in/p05': invite({ head: null }) })).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/lobby/p05/in/p01': invite({ head: null }) })).status).toBe(401);
    expect((await send({
      ...proof('p05'), [m('meta')]: meta({ seats: { plants: 'p05', zombies: 'p02' }, host: 'p05', head: null }),
    })).status).toBe(401);
    expect((await send({
      ...proof('p02'), [m('meta')]: meta({ seats: { plants: 'p05', zombies: 'p02' }, head: null }),
    })).status).toBe(401);
  });

  it('only the grown-up ticks a player in', async () => {
    const { send, proof, r } = await world(R);
    expect((await r.put(`${R}/vs/allowed/p05`, true)).status).toBe(401);
    expect((await send({ ...proof('p05'), 'vs/allowed/p05': true })).status).toBe(401);
    expect((await send({ 'vs/allowed/p05': 'yes', [`admin/proof/${G}`]: { touch: SV } })).status).toBe(401);
    expect((await send({ 'vs/allowed/p31': true, [`admin/proof/${G}`]: { touch: SV } })).status).toBe(401);
    expect((await send({ 'vs/allowed/p06': null, [`admin/proof/${G}`]: { touch: SV } })).status).toBe(200);
    expect((await send({ ...proof('p06'), 'vs/here/p06': here() })).status).toBe(401);
  });

  it('a listed slot with a wrong proof hash', async () => {
    const { send, proof } = await world(R);
    expect((await send({ ...proof('p01', hex('0')), 'vs/here/p01': here() })).status).toBe(401);
    expect((await send({ ...proof('p02', hex('0')), 'vs/lobby/p01/in/p02': invite() })).status).toBe(401);
    // Someone else's proof does not prove you.
    expect((await send({ ...proof('p02'), 'vs/here/p01': here() })).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/here/p01': here() })).status).toBe(200);
  });

  it('a stale touch: the proof must be written in this very update, with the server\'s time', async () => {
    const { send, proof, clock, r } = await world(R);
    expect((await send({ ...proof('p01', undefined, T0), 'vs/here/p01': here() })).status).toBe(401);
    expect((await send(proof('p01'))).status).toBe(200);
    clock.t += 1;
    expect((await send({ 'vs/here/p01': here() })).status).toBe(401);
    expect((await r.get(`${R}/proof/p01`)).status).toBe(401);
    expect((await r.get(`${R}/proof`)).status).toBe(401);
  });

  it('a proof stored by another update in the same millisecond cannot be borrowed', async () => {
    const { send, proof, r, m } = await matchWorld(R);
    // p01's honest heartbeat; in the same server millisecond, requests that carry no proof.
    expect((await send({ ...proof('p01'), 'vs/here/p01': here() })).status).toBe(200);
    expect((await send({ 'vs/here/p01': here(true) })).status).toBe(401);
    expect((await r.del(`${R}/vs/lobby/p01/in/p02`)).status).toBe(401);
    expect((await send({ 'vs/lobby/p02/in/p01': invite({ head: null }) })).status).toBe(401);
    expect((await send({ [`vs/matches/${'0'.repeat(32)}/meta`]: meta() })).status).toBe(401);
    expect((await send({ [m('meta')]: null, 'vs/lobby/p02/back/p01': null })).status).toBe(401);
    // The grown-up's proof, likewise.
    expect((await send({ 'vs/allowed/p05': null, [`admin/proof/${G}`]: { touch: SV } })).status).toBe(200);
    expect((await send({ 'vs/allowed/p05': true })).status).toBe(401);
    expect((await send({ 'vs/here/p01': null })).status).toBe(401);
  });

  it('the grown-up may only delete here, lobby and proofs, never write them; nobody else may', async () => {
    const { send, proof, r, db } = await matchWorld(R);
    const gu = { [`admin/proof/${G}`]: { touch: SV } };
    expect((await send({ ...gu, 'vs/here/p05': { at: SV, busy: false } })).status).toBe(401);
    expect((await send({ ...gu, 'vs/lobby/p05/in/p01': invite({ head: null }) })).status).toBe(401);
    expect((await send({ ...gu, 'vs/lobby/p01': { in: { p06: invite({ head: null }) } } })).status).toBe(401);
    expect((await send({ ...gu, [`proof/p05/${hex('0')}`]: { touch: SV } })).status).toBe(401);
    expect((await send({ ...gu, 'proof/p05': { [hex('0')]: { touch: SV } } })).status).toBe(401);
    expect((await r.del(`${R}/vs/lobby/p01`)).status).toBe(401);
    expect((await r.del(`${R}/proof/p01`)).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/lobby/p01': null })).status).toBe(401);
    expect((await send({ [`admin/proof/${hex('0')}`]: { touch: SV }, 'vs/lobby/p01': null })).status).toBe(401);
    expect(db.peek(`${R}/vs/lobby/p01/in/p02`)).not.toBeNull();
  });

  it('deleting someone else\'s "here" entry without his proof', async () => {
    const { send, proof, r, db, clock } = await world(R);
    expect((await send({ ...proof('p01'), 'vs/here/p01': here() })).status).toBe(200);
    clock.t += 1;
    expect((await r.del(`${R}/vs/here/p01`)).status).toBe(401);
    expect((await send({ ...proof('p02'), 'vs/here/p01': null })).status).toBe(401);
    expect((await send({ ...proof('p01', hex('0')), 'vs/here/p01': null })).status).toBe(401);
    expect(db.peek(`${R}/vs/here/p01`)).not.toBeNull();
    expect((await send({ ...proof('p01'), 'vs/here/p01': null })).status).toBe(200);
  });

  it('a heartbeat for an absurd value', async () => {
    const { send, proof } = await world(R);
    expect((await send({ ...proof('p01'), 'vs/here/p01': { at: T0, busy: false } })).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/here/p01': { at: SV, busy: 'no' } })).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/here/p01': { at: SV, busy: false, name: 'x' } })).status).toBe(401);
  });

  it.each<[string, Record<string, Json>]>([
    ['a short key', { pub: 'abc' }],
    ['a key with a bad character', { pub: `${PUB.slice(0, 86)}=` }],
    ['a side that is not one', { side: 'robots' }],
    ['a head for a third player', { head: { slot: 'p06', step: 3 } }],
    ['a head step of 6', { head: { slot: 'p02', step: 6 } }],
    ['a build of 6 digits', { build: '228955' }],
    ['a build in capitals', { build: '2289558A' }],
    ['an old time', { at: T0 }],
    ['an extra field', { name: 'Toby' }],
  ])('an invite with %s', async (_what, extra) => {
    const { send, proof } = await world(R);
    expect((await send({ ...proof('p02'), 'vs/lobby/p01/in/p02': invite(extra) })).status).toBe(401);
  });

  it('an invite to yourself, or a reply written as someone else', async () => {
    const { send, proof } = await world(R);
    expect((await send({ ...proof('p01'), 'vs/lobby/p01/in/p01': invite({ head: null }) })).status).toBe(401);
    expect((await send({ ...proof('p02'), 'vs/lobby/p02/back/p01': reply() })).status).toBe(401);
  });

  it('deleting someone else\'s lobby entry without either party\'s proof', async () => {
    const { send, proof, r, db } = await matchWorld(R);
    expect((await r.del(`${R}/vs/lobby/p01/in/p02`)).status).toBe(401);
    expect((await send({ ...proof('p06'), 'vs/lobby/p01/in/p02': null })).status).toBe(401);
    expect((await send({ ...proof('p06'), 'vs/lobby/p02/back/p01': null })).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/lobby/p01': null })).status).toBe(401);
    expect(db.peek(`${R}/vs/lobby/p01/in/p02`)).not.toBeNull();
  });

  it('meta written twice, or naming the same player twice', async () => {
    const { send, proof, m, r } = await matchWorld(R);
    expect((await send({ ...proof('p01'), [m('meta')]: meta({ seed: 1 }) })).status).toBe(401);
    expect((await send({ ...proof('p01'), [m('meta')]: meta() })).status).toBe(401);
    // Once the match holds more than meta, meta alone cannot be deleted (only the whole match).
    expect((await r.put(`${R}/${m('turns/plants/t000000')}`, '{}')).status).toBe(200);
    expect((await r.del(`${R}/${m('meta')}`)).status).toBe(401);
    const other = `vs/matches/${'0'.repeat(32)}/meta`;
    expect((await send({ ...proof('p01'), [other]: meta({ seats: { plants: 'p01', zombies: 'p01' }, host: 'p01', head: null }) })).status).toBe(401);
  });

  it.each<[string, Record<string, Json>]>([
    ['no proof from a seat', {}],
    ['a host who is not a seat', { host: 'p06' }],
    ['turn 5', { turn: 5 }],
    ['delay 8', { delay: 8 }],
    ['delay 31', { delay: 31 }],
    ['v 2', { v: 2 }],
    ['seed 1.5', { seed: 1.5 }],
    ['a build of 13 digits', { build: '2289558abcdef' }],
    ['a head for a third player', { head: { slot: 'p06', step: 1 } }],
    ['an old created time', { created: T0 }],
    ['an extra field', { note: 'x' }],
    ['no seats', { seats: null }],
  ])('meta with %s', async (what, extra) => {
    const { send, proof, m } = await world(R);
    const p = what === 'no proof from a seat' ? proof('p06') : proof('p01');
    expect((await send({ ...p, [m('meta')]: meta(extra) })).status).toBe(401);
  });

  it('a turn rewritten with another value, past t009000, malformed, or too long', async () => {
    const { r } = await matchWorld(R);
    const p = (b: Record<string, Json>) => r.patch(`${R}/vs/matches/${ID}`, b);
    expect((await p({ 'turns/plants/t000000': '{}' })).status).toBe(200);
    expect((await p({ 'turns/plants/t000000': '{"c":[]}' })).status).toBe(401);
    expect((await p({ 'turns/plants/t000000': null })).status).toBe(401);
    expect((await p({ 'turns/plants/t009001': '{}' })).status).toBe(401);
    expect((await p({ 'turns/plants/t010000': '{}' })).status).toBe(401);
    expect((await p({ 'turns/plants/t00001': '{}' })).status).toBe(401);
    expect((await p({ 'turns/plants/t000001': 'x'.repeat(401) })).status).toBe(401);
    expect((await p({ 'turns/plants/t000001': 7 })).status).toBe(401);
    expect((await p({ 'turns/robots/t000001': '{}' })).status).toBe(401);
    expect((await r.put(`${R}/vs/matches/${ID}/turns/plants`, { t000005: '{}' })).status).toBe(401);
  });

  it('match writes before the match exists', async () => {
    const { r } = await world(R);
    for (const b of <Record<string, Json>[]>[{ 'turns/plants/t000000': '{}' }, { 'ready/plants': SV }, { 'end/plants': 'x' }, { quit: { by: 'p01' } }]) {
      expect((await r.patch(`${R}/vs/matches/${ID}`, b)).status, JSON.stringify(b)).toBe(401);
    }
  });

  it.each<[string, Record<string, Json>]>([
    ['again: 2', { 'again/plants': 2 }],
    ['again changed', { 'again/plants': 0 }],
    ['ready at an old time', { 'ready/zombies': T0 }],
    ['ready for a third seat', { 'ready/robots': SV }],
    ['ready changed', { 'ready/plants': SV }],
    ['end of 100 characters', { 'end/zombies': 'x'.repeat(100) }],
    ['end changed', { 'end/plants': '{}' }],
    ['sync/s4', { 'sync/s4': { tick: 1, snap: '{}' } }],
    ['sync changed', { 'sync/s1': { tick: 1801, snap: '{"x":1}' } }],
    ['a snapshot over 200,000 characters', { 'sync/s2': { tick: 1, snap: 'x'.repeat(200_001) } }],
    ['a pause by a stranger', { pause: { by: 'p06', n: 1 } }],
    ['a pause without n', { pause: { by: 'p01' } }],
    ['a quit by a stranger', { quit: { by: 'p06' } }],
    ['a quit changed', { quit: { by: 'p02' } }],
    ['an unknown child of a match', { chat: 'hi' }],
  ])('%s', async (_what, body) => {
    const { r, clock } = await matchWorld(R);
    const p = (b: Record<string, Json>) => r.patch(`${R}/vs/matches/${ID}`, b);
    expect((await p({
      'again/plants': 1, 'ready/plants': SV, 'end/plants': '{"w":"plants"}',
      'sync/s1': { tick: 1800, snap: '{"x":1}' }, quit: { by: 'p01' },
    })).status).toBe(200);
    clock.t += 1;
    expect((await p(body)).status).toBe(401);
  });

  it('a whole match is never written, only deleted', async () => {
    const { r } = await world(R);
    expect((await r.put(`${R}/vs/matches/${ID}`, { meta: meta() as Json })).status).toBe(401);
  });

  it('listing the matches; reading a match by a wrong id finds nothing', async () => {
    const { r } = await matchWorld(R);
    expect((await r.get(`${R}/vs/matches`)).status).toBe(401);
    expect((await r.get(`${R}/vs`)).status).toBe(401);
    expect((await r.get(`${R}/vs/lobby`)).status).toBe(401);
    expect(await r.get(`${R}/vs/matches/${'0'.repeat(32)}`)).toEqual({ status: 200, data: null });
    expect((await r.get(`${R}/vs/matches/${ID.toUpperCase()}`)).status).toBe(401);
    expect((await r.get(`${R}/vs/matches/${ID.slice(1)}`)).status).toBe(401);
    expect((await r.del(`${R}/vs/matches`)).status).toBe(401);
  });

  it('anything else under vs, and the retired and unknown paths', async () => {
    const { r, send, proof } = await world(R);
    expect((await r.put(`${R}/vs/other`, 'hi')).status).toBe(401);
    expect((await send({ ...proof('p01'), 'vs/other/p01': here() })).status).toBe(401);
    expect((await r.put(`${R}/other`, 'hi')).status).toBe(401);
    for (const p of ['presence', 'rooms', 'challenges']) {
      expect((await r.get(`${p}/x`)).status, p).toBe(401);
      expect((await r.put(`${p}/x`, 'hi')).status, p).toBe(401);
    }
  });
});

describe('the test field of meta (smaller base health for browser tests)', () => {
  it('is refused under v2', async () => {
    const { send, proof, m } = await world('v2');
    expect((await send({ ...proof('p01'), [m('meta')]: meta({ test: 100 }) })).status).toBe(401);
  });

  it('is allowed under v2test, a whole number 1..500', async () => {
    const { send, proof, m } = await world('v2test');
    expect((await send({ ...proof('p01'), [m('meta')]: meta({ test: 0 }) })).status).toBe(401);
    expect((await send({ ...proof('p01'), [m('meta')]: meta({ test: 501 }) })).status).toBe(401);
    expect((await send({ ...proof('p01'), [m('meta')]: meta({ test: 100 }) })).status).toBe(200);
  });
});
