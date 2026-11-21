// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../../../src/app/session';
import { FakeDatabase } from '../../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../../src/cloud/restClient';
import type { CloudError } from '../../../src/cloud/types';
import type { Slot } from '../../../src/progress/save';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import { GrownUp } from '../../../src/ui/screens/GrownUp';
import type { VersusTicksProps } from '../../../src/ui/screens/GrownUp';
import { CLOUD_OFF } from '../../../src/ui/screens/pictures';
import { MemoryStorage } from '../../progress/memoryStorage';

let root: HTMLElement;
const NOW = 1_762_900_000_000;

beforeEach(async () => {
  session.configure({ cloud: createFakeCloud(new FakeDatabase({ now: () => NOW })), storage: new MemoryStorage(), now: () => NOW, window: null, document: null });
  for (const [name, picture, slot] of [['Lukas', 'peashooter', 'p01'], ['Toby', 'brainEater', 'p02'], ['Mia', 'sunflower', 'p03']] as const) {
    const made = await session.create(name, picture, '123', slot);
    if (typeof made === 'string') throw new Error(made);
    session.logout();
  }
  await session.setGrownUp('246802');
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  session.dispose();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
async function see(sel: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    el = need(sel);
  }, { timeout: 3000, interval: 5 });
  return el as unknown as HTMLElement;
}
async function typeCode(code: string): Promise<void> {
  for (const d of code) act(() => need(`[data-key="${d}"]`).click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function mount(versus: VersusTicksProps | undefined): void {
  act(() => render(<GrownUp {...(versus !== undefined ? { versus } : {})} />, root));
}

const ticked = (slot: Slot): boolean => need(`[data-tick-row="${slot}"] [data-action="versus-tick"]`).getAttribute('aria-checked') === 'true';

describe('the grown-up Versus ticks', () => {
  it('after the code: every existing player with a tick box; Lukas and Toby always ticked and fixed', async () => {
    mount({ allowed: new Set<Slot>(), set: vi.fn() });
    await typeCode('246802');
    await see('[data-versus-ticks]');
    const rows = [...root.querySelectorAll<HTMLElement>('[data-versus-ticks] [data-tick-row]')];
    expect(rows.map((r) => r.dataset.tickRow)).toEqual(expect.arrayContaining(['p01', 'p02', 'p03']));
    expect(rows).toHaveLength(3);
    for (const slot of ['p01', 'p02'] as Slot[]) {
      const box = need(`[data-tick-row="${slot}"] [data-action="versus-tick"]`);
      expect(box.getAttribute('aria-checked')).toBe('true');
      expect((box as HTMLButtonElement).disabled).toBe(true);
    }
    expect(ticked('p03')).toBe(false);
    expect((need('[data-tick-row="p03"] [data-action="versus-tick"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a player already allowed shows ticked', async () => {
    mount({ allowed: new Set<Slot>(['p03']), set: vi.fn() });
    await typeCode('246802');
    await see('[data-versus-ticks]');
    expect(ticked('p03')).toBe(true);
  });

  it('toggling calls set(slot, on, code) and keeps the tick', async () => {
    const set = vi.fn(async (): Promise<'ok' | CloudError> => 'ok');
    mount({ allowed: new Set<Slot>(), set });
    await typeCode('246802');
    await see('[data-versus-ticks]');
    act(() => need('[data-tick-row="p03"] [data-action="versus-tick"]').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(set).toHaveBeenCalledWith('p03', true, '246802');
    expect(ticked('p03')).toBe(true);
    act(() => need('[data-tick-row="p03"] [data-action="versus-tick"]').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(set).toHaveBeenLastCalledWith('p03', false, '246802');
    expect(ticked('p03')).toBe(false);
    expect(q('[data-versus-offline]')).toBeNull();
  });

  it('an offline answer shows the crossed-out cloud and leaves the box as it was', async () => {
    const set = vi.fn(async (): Promise<'ok' | CloudError> => 'offline');
    mount({ allowed: new Set<Slot>(), set });
    await typeCode('246802');
    await see('[data-versus-ticks]');
    act(() => need('[data-tick-row="p03"] [data-action="versus-tick"]').click());
    const off = await see('[data-versus-offline]');
    expect([...off.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(pixelPaths(CLOUD_OFF).map((p) => p.d));
    expect(ticked('p03')).toBe(false);
  });

  it('without the Versus props the list has no ticks', async () => {
    mount(undefined);
    await typeCode('246802');
    await see('[data-row="p01"]');
    expect(q('[data-versus-ticks]')).toBeNull();
  });
});
