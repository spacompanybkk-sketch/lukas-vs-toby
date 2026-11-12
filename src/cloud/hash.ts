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
