import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPortraits, setPortraitPainter } from '../../src/render/portraits';
import type { UnitKey } from '../../src/sim/types';

afterEach(() => setPortraitPainter(null));

describe('renderPortraits', () => {
  it('draws each key once per size for the session, sharing a request in flight', async () => {
    const painter = vi.fn((key: UnitKey, size: number) => `data:image/png;base64,${key}-${size}`);
    setPortraitPainter(painter);
    const [a, b] = await Promise.all([
      renderPortraits(['peashooter', 'sunflower'], 96),
      renderPortraits(['peashooter'], 96),
    ]);
    expect(a).toEqual({ peashooter: 'data:image/png;base64,peashooter-96', sunflower: 'data:image/png;base64,sunflower-96' });
    expect(b).toEqual({ peashooter: 'data:image/png;base64,peashooter-96' });
    await renderPortraits(['sunflower', 'peashooter'], 96);
    expect(painter).toHaveBeenCalledTimes(2);
    await renderPortraits(['peashooter'], 64); // another size is another picture
    expect(painter).toHaveBeenCalledTimes(3);
  });

  it('leaves out a key that failed (the card shows its placeholder) and tries it again next time', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    setPortraitPainter((key) => {
      if (key === 'walnutBomb' && fail) throw new Error('no GL');
      return `url:${key}`;
    });
    expect(await renderPortraits(['walnutBomb', 'peashooter'], 80)).toEqual({ peashooter: 'url:peashooter' });
    fail = false;
    expect(await renderPortraits(['walnutBomb'], 80)).toEqual({ walnutBomb: 'url:walnutBomb' });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('returns nothing (no throw) before a painter is set', async () => {
    expect(await renderPortraits(['peashooter'], 80)).toEqual({});
  });
});

describe('anyAlpha', () => {
  it('tells an empty read (all alpha 0, as a failed float read leaves it) from a picture', async () => {
    const { anyAlpha } = await import('../../src/render/portraits');
    expect(anyAlpha(new Float32Array(16))).toBe(false);
    const px = new Uint8Array(16);
    px[11] = 255;
    expect(anyAlpha(px)).toBe(true);
  });
});
