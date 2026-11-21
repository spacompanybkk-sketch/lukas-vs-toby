import { pageConnection } from '../cloud/connection';
import { pageCloudMode } from '../cloud/restClient';
import type { CloudMode } from '../cloud/restClient';
import { VS_TIMEOUTS, scaledTimeouts } from '../net/timeouts';
import type { VersusTimeouts } from '../net/timeouts';
import { debugEnabled } from './debug';
import { session } from './session';
import { VersusFlow } from './versus';

/** `?vsquick` shrinks every Versus timeout by this much. */
export const VSQUICK_DIVISOR = 30;

/**
 * The debug page parameters of Versus, honoured only on the fake cloud with the debug gate open:
 * `vsquick` (every timeout ÷ 30) and `vstest=<1..500>` (both bases' health, a short test match).
 * (`vsbuild` is read by `buildId`.)
 */
export function versusParams(search: string, mode: CloudMode, debug: boolean): { timeouts: VersusTimeouts; testBaseHp: number | null } {
  if (mode !== 'fake' || !debug) return { timeouts: VS_TIMEOUTS, testBaseHp: null };
  const params = new URLSearchParams(search);
  const hp = params.get('vstest');
  const n = hp !== null && /^\d{1,3}$/.test(hp) ? Number(hp) : 0;
  return {
    timeouts: params.has('vsquick') ? scaledTimeouts(VSQUICK_DIVISOR) : VS_TIMEOUTS,
    testBaseHp: n >= 1 && n <= 500 ? n : null,
  };
}

/** The page's Versus flow: this page's database, the one player session, the debug parameters. */
export function pageVersusFlow(search: string = location.search): VersusFlow {
  const { timeouts, testBaseHp } = versusParams(search, pageCloudMode(), debugEnabled(import.meta.env.DEV, search));
  return new VersusFlow({ conn: pageConnection, session, timeouts, testBaseHp });
}
