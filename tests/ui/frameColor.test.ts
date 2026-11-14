import { describe, expect, it } from 'vitest';
import { SLOTS } from '../../src/progress/save';
import { FRAME_COLORS, frameColor } from '../../src/ui/frameColor';

describe('frameColor', () => {
  it('ten different colours, fixed by place: p01 and p11 share, neighbours never do', () => {
    expect(new Set(FRAME_COLORS).size).toBe(10);
    expect(frameColor('p01')).toBe(FRAME_COLORS[0]);
    expect(frameColor('p11')).toBe(frameColor('p01'));
    for (let i = 0; i + 1 < SLOTS.length; i++) expect(frameColor(SLOTS[i]!)).not.toBe(frameColor(SLOTS[i + 1]!));
  });
});
