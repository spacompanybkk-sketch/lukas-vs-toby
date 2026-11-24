import { describe, expect, it } from 'vitest';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { PUDDLE_COLORS } from '../../../src/render/battle/Hazards';
import { ICE_DARK, ICE_LIGHT, MIST_COLOR } from '../../../src/render/world/TwistTiles';

// Step 4 Task 2 (Review Focus 3, as worlds3FixWave.test.ts did for the boulders): the Yeti's avalanche is told apart,
// by colour, from what the Tundra and the Meadow already put on the lawn (ice pans, mist, Brain Rot's puddles).

/** CIE L*a*b* of a '#RRGGBB' colour (D65), for a perceptual distance (ΔE76). */
function lab(hex: string): [number, number, number] {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: string, b: string): number => Math.hypot(...lab(a).map((v, i) => v - (lab(b)[i] as number)));

/** A fill that reads against what is already on the lawn: at least this far (ΔE) from each of it. */
const APART = 35;

/** What a boss's blinking tiles must not be taken for: the Tundra's ice pans, the Meadow's mist, Brain Rot's puddle. */
const LAWN_COLORS: Record<string, string> = {
  'ice (light pan)': ICE_LIGHT,
  'ice (dark pan)': ICE_DARK,
  mist: MIST_COLOR,
  'puddle body': PUDDLE_COLORS.body,
  'puddle ooze': PUDDLE_COLORS.ooze,
  'puddle rim': PUDDLE_COLORS.rim,
};

describe('the Yeti\'s avalanche is not an ice pan, mist or a puddle', () => {
  const warning = BOSS_LOOK.yeti.fx.strikeWarnings?.stun;

  it('uses the stun colours of its row: the Melon\'s navy, with a white blow (no new strike variant)', () => {
    expect(warning).toBeDefined();
    expect(warning).toMatchObject({ fill: '#0A2A70', frame: '#06163F', blow: '#FFFFFF' });
    expect(warning?.dither).toBeUndefined();
    expect(BOSS_LOOK.yeti.fx.strikeBlow).toBeUndefined();
    expect(BOSS_LOOK.yeti.fx.strikeWarnings).toEqual({ stun: warning });
  });

  it.each(Object.entries(LAWN_COLORS))(`its fill is at least ${APART} apart (ΔE) from %s`, (_name, color) => {
    expect(deltaE(warning!.fill, color)).toBeGreaterThanOrEqual(APART);
  });

  it('its outline is darker than the fill\'s ice, and its blow (white) is not the frame\'s navy', () => {
    expect(lab(warning!.frame)[0]).toBeLessThan(lab(ICE_LIGHT)[0]);
    expect(deltaE(warning!.blow as string, warning!.frame)).toBeGreaterThan(APART);
  });
});
