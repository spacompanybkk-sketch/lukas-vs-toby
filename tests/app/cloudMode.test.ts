// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { announceCloudMode, showFakeBadge } from '../../src/app/cloudMode';
import { cloudMode } from '../../src/cloud/restClient';
import type { CloudMode } from '../../src/cloud/restClient';

describe('cloud mode resolution: build variable × address', () => {
  // [VITE_CLOUD, address, mode]
  const table: [string | undefined, string, CloudMode][] = [
    [undefined, '', 'fake'],
    [undefined, '?cloud=test', 'fake'],
    [undefined, '?cloud=test&debug', 'fake'],
    [undefined, '?cloud=fake&debug', 'fake'],
    ['fake', '', 'fake'],
    ['fake', '?cloud=test&debug', 'fake'],
    ['test', '', 'fake'],
    ['live', '', 'live'],
    ['live', '?cloud=fake', 'live'],
    ['live', '?cloud=test', 'live'],
    ['live', '?debug', 'live'],
    ['live', '?cloud=fake&debug', 'fake'],
    ['live', '?debug&cloud=test', 'test'],
    ['live', '?cloud=other&debug', 'live'],
  ];
  it.each(table)('VITE_CLOUD=%s, %s → %s', (flag, search, mode) => {
    expect(cloudMode(search, flag)).toBe(mode);
  });
});

describe('announceCloudMode', () => {
  it.each([['live', 'v2'], ['test', 'v2test'], ['fake', 'fake']] as [CloudMode, string][])('%s: <html data-cloud> and one console line naming the root', (mode, root) => {
    const log = vi.fn();
    announceCloudMode(mode, document, log);
    expect(document.documentElement.dataset.cloud).toBe(mode);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`[lvt] cloud: ${mode} (${root})`);
  });
});

describe('the fake-cloud badge', () => {
  // [mode, dev, address, shown]
  const table: [CloudMode, boolean, string, boolean][] = [
    ['fake', false, '', true],
    ['fake', false, '?cloud=fake', true],
    ['fake', false, '?debug', false],
    ['fake', true, '', false],
    ['live', false, '', false],
    ['test', false, '', false],
  ];
  it.each(table)('%s, dev %s, %s → %s', (mode, dev, search, shown) => {
    expect(showFakeBadge(mode, dev, search)).toBe(shown);
  });
});
