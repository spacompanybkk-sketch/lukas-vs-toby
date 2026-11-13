import type { CloudMode } from './restClient';

/** The device key prefix of each cloud: the live game's keys stay `lvt2_`. */
export const KEY_PREFIX: Readonly<Record<CloudMode, string>> = Object.freeze({ live: 'lvt2_', fake: 'lvt2f_', test: 'lvt2t_' });

/**
 * The device storage as seen by one cloud mode: every `lvt2_…` key is moved to that mode's own
 * prefix (`lvt2f_…` for the fake, `lvt2t_…` for v2test), so saves, hashes, sync records, locks and
 * the board copy made while playing on the fake or test cloud never meet the real ones. Other
 * keys (the old game's `lpvtz_…`) pass through. The live mode is the storage itself.
 */
export function modeStorage(base: Storage | undefined, mode: CloudMode): Storage | undefined {
  if (base === undefined || mode === 'live') return base;
  const prefix = KEY_PREFIX[mode];
  const map = (key: string): string => (key.startsWith('lvt2_') ? prefix + key.slice(5) : key);
  return {
    get length() { return base.length; },
    key: (i: number) => base.key(i),
    clear: () => {
      for (let i = base.length - 1; i >= 0; i--) {
        const k = base.key(i);
        if (k !== null && k.startsWith(prefix)) base.removeItem(k);
      }
    },
    getItem: (key: string) => base.getItem(map(key)),
    setItem: (key: string, value: string) => base.setItem(map(key), value),
    removeItem: (key: string) => base.removeItem(map(key)),
  };
}
