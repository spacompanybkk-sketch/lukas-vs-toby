import { describe, expect, it } from 'vitest';
import { BUILD_RE, buildId } from '../../src/app/buildId';

describe('buildId', () => {
  it('is the bundle\'s short commit in live mode', () => {
    expect(buildId('', 'live')).toMatch(BUILD_RE);
    expect(buildId('', 'live')).toBe(__LVT_BUILD__);
  });

  it('BUILD_RE takes 7 to 12 lowercase hex digits only', () => {
    expect(BUILD_RE.test('abcdef1')).toBe(true);
    expect(BUILD_RE.test('abcdef123456')).toBe(true);
    expect(BUILD_RE.test('abcdef')).toBe(false);
    expect(BUILD_RE.test('abcdef1234567')).toBe(false);
    expect(BUILD_RE.test('ABCDEF1')).toBe(false);
    expect(BUILD_RE.test('abcdefg')).toBe(false);
  });

  it('?vsbuild overrides it on the fake cloud with ?debug', () => {
    expect(buildId('?debug&cloud=fake&vsbuild=abcdef1', 'fake')).toBe('abcdef1');
    expect(buildId('?debug&vsbuild=0123456789ab', 'fake')).toBe('0123456789ab');
  });

  it.each<[string, string, 'live' | 'test' | 'fake']>([
    ['without ?debug', '?cloud=fake&vsbuild=abcdef1', 'fake'],
    ['in live mode', '?debug&cloud=fake&vsbuild=abcdef1', 'live'],
    ['in test mode', '?debug&cloud=test&vsbuild=abcdef1', 'test'],
    ['too short', '?debug&cloud=fake&vsbuild=abcde', 'fake'],
    ['too long', '?debug&cloud=fake&vsbuild=abcdef1234567', 'fake'],
    ['not hex', '?debug&cloud=fake&vsbuild=abcdefg', 'fake'],
    ['empty', '?debug&cloud=fake&vsbuild=', 'fake'],
  ])('?vsbuild is ignored %s', (_why, search, mode) => {
    expect(buildId(search, mode)).toBe(__LVT_BUILD__);
  });
});
