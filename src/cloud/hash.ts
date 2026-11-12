import type { Slot } from '../progress/save';

export const PIN = /^\d{3}$/;

/**
 * The only form in which a password leaves the device: SHA-256 of `lvt2|<slot>|<pin>`, as 64
 * lowercase hex digits. The slot salts it, so two players with the same digits get different
 * hashes. Rejects when `pin` is not exactly three digits.
 */
export async function pinHash(slot: Slot, pin: string): Promise<string> {
  if (!PIN.test(pin)) throw new RangeError('a pin is exactly three digits');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lvt2|${slot}|${pin}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The grown-up code has six digits (spec 20 review: four were too easy to guess). */
export const GROWN_UP_DIGITS = 6;
export const GROWN_UP_CODE = /^\d{6}$/;

/** The grown-up code as it is stored and proven: SHA-256 of `lvt2|grown-up|<code>`, 64 hex digits. */
export async function grownUpHash(code: string): Promise<string> {
  if (!GROWN_UP_CODE.test(code)) throw new RangeError('a grown-up code is exactly six digits');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lvt2|grown-up|${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
