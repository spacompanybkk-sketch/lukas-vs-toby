import type { CloudMode } from '../cloud/restClient';

/** The database root a mode talks to (`fake`: the in-page fake database). */
export const CLOUD_ROOT: Readonly<Record<CloudMode, string>> = Object.freeze({ live: 'v2', test: 'v2test', fake: 'fake' });

/**
 * Makes the page's cloud mode impossible to miss: `<html data-cloud="…">` for anyone inspecting
 * the page, and one console line at startup.
 */
export function announceCloudMode(mode: CloudMode, doc: Document = document, log: (msg: string) => void = (m) => console.info(m)): void {
  doc.documentElement.dataset.cloud = mode;
  log(`[lvt] cloud: ${mode} (${CLOUD_ROOT[mode]})`);
}

/**
 * The "test tube" badge on the Title and Players screens: a production build running on the
 * fake cloud (a wrong deploy: players would exist only on the device). Never in live mode, never
 * in development, never with `?debug` (the tests and tools).
 */
export function showFakeBadge(mode: CloudMode, dev: boolean, search: string): boolean {
  return mode === 'fake' && !dev && !new URLSearchParams(search).has('debug');
}
