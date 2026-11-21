import { describe, expect, it } from 'vitest';
import { matchId, newKeyPair, sharedSecret } from '../../src/cloud/versusKeys';

/** The match id from an ECDH handshake (spec 7.3, 10 "ECDH derivation"). */
describe('versus keys', () => {
  it('two fresh pairs derive the same secret both ways; a third pair gets another', async () => {
    const a = await newKeyPair();
    const b = await newKeyPair();
    const c = await newKeyPair();
    const ab = await sharedSecret(a, b.pub);
    expect(ab).toMatch(/^[0-9a-f]{64}$/);
    expect(await sharedSecret(b, a.pub)).toBe(ab);
    expect(await sharedSecret(c, a.pub)).not.toBe(ab);
  });

  it('a public key is the raw point as 87 base64url characters; the private key cannot be exported', async () => {
    const a = await newKeyPair();
    expect(a.pub).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(a.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', a.privateKey)).rejects.toThrow();
  });

  it('a malformed public key is refused', async () => {
    const a = await newKeyPair();
    await expect(sharedSecret(a, 'short')).rejects.toThrow();
    await expect(sharedSecret(a, 'A'.repeat(87))).rejects.toThrow();
  });

  it('match ids: the fixed vectors, 32 hex digits, a rematch gets a new id', async () => {
    expect(await matchId('00'.repeat(32), 0)).toBe('a96e5cf3f7d895c1b070a56ea70af37c');
    expect(await matchId('00'.repeat(32), 1)).toBe('abeb34ec542f68c1761c3a578dda556f');
    const a = await newKeyPair();
    const b = await newKeyPair();
    const s = await sharedSecret(a, b.pub);
    const ids = [await matchId(s, 0), await matchId(s, 1), await matchId(s, 2)];
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(3);
  });

  it('the two public keys alone cannot make the secret (a KeyPair with its private key is needed)', async () => {
    const a = await newKeyPair();
    const b = await newKeyPair();
    // @ts-expect-error: a public key is not a KeyPair.
    await expect(sharedSecret(a.pub, b.pub)).rejects.toThrow();
  });
});
