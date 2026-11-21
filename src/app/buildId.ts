import type { CloudMode } from '../cloud/restClient';
import { pageCloudMode } from '../cloud/restClient';

/** A build id as a match record carries it (spec 8.1): 7 to 12 lowercase hex digits. */
export const BUILD_RE = /^[0-9a-f]{7,12}$/;

/**
 * This page's build id: the bundle's short commit. On the fake cloud with `?debug`, a valid
 * `?vsbuild=<hex>` stands in for it, so a test can put two pages on different builds.
 */
export function buildId(
  search: string = typeof location === 'undefined' ? '' : location.search,
  mode: CloudMode = pageCloudMode(),
): string {
  if (mode === 'fake') {
    const params = new URLSearchParams(search);
    const asked = params.get('vsbuild');
    if (params.has('debug') && asked !== null && BUILD_RE.test(asked)) return asked;
  }
  return __LVT_BUILD__;
}
