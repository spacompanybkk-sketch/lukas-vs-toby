import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pinHash } from '../../src/cloud/hash';

describe('pinHash', () => {
  it('has crypto.subtle in this environment', () => {
    expect(typeof globalThis.crypto?.subtle?.digest).toBe('function');
  });

  it('is SHA-256 of lvt2|slot|pin in lowercase hex', async () => {
    const expected = createHash('sha256').update('lvt2|p01|123').digest('hex');
    const h = await pinHash('p01', '123');
    expect(h).toBe(expected);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is salted by the slot', async () => {
    expect(await pinHash('p01', '000')).not.toBe(await pinHash('p02', '000'));
  });

  it.each(['12', '1234', 'abc', '12a', ' 123', '', '١٢٣'])('refuses pin %j', async (pin) => {
    await expect(pinHash('p01', pin)).rejects.toThrow(RangeError);
  });
});
