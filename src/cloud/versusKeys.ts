/**
 * Keeping a Versus match private (spec 7.3): each device makes a fresh ECDH P-256 key pair, puts
 * the public half on its invite or reply, and both derive the same shared secret with WebCrypto.
 * The match id comes from that secret, so the public keys alone never give it. The private key
 * is never exported and lives in memory only.
 */

export interface KeyPair {
  privateKey: CryptoKey;
  /** The raw (uncompressed, 65-byte) P-256 public point as base64url without padding: 87 characters. */
  pub: string;
}

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
/** A public key as it travels: 87 base64url characters. */
export const PUB_RE = /^[A-Za-z0-9_-]{87}$/;

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A fresh key pair; the private key cannot be exported. */
export async function newKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(CURVE, false, ['deriveBits']);
  // A public key is always exportable, whatever the pair's `extractable`.
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, pub: toBase64url(new Uint8Array(raw)) };
}

/** The shared secret with the other device's public key: 64 lowercase hex digits. Rejects a malformed key. */
export async function sharedSecret(mine: KeyPair, theirPub: string): Promise<string> {
  if (!PUB_RE.test(theirPub)) throw new RangeError('a public key is 87 base64url characters');
  const theirs = await crypto.subtle.importKey('raw', fromBase64url(theirPub), CURVE, false, []);
  return hex(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256));
}

/** The id of match `n` (0, then +1 per rematch): the first 32 hex digits of SHA-256("lvt2-vs|<secret>|<n>"). */
export async function matchId(secretHex: string, n: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lvt2-vs|${secretHex}|${n}`));
  return hex(digest).slice(0, 32);
}
