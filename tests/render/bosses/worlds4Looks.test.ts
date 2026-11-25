import { Color, LinearSRGBColorSpace } from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { PUDDLE_COLORS } from '../../../src/render/battle/Hazards';
import { SPORE_BOMB_SIZE, makeFrozenMelon, makeNeedle, makeProjectile, makeSporeBomb } from '../../../src/render/models/props';
import { ICE_DARK, ICE_LIGHT, MIST_COLOR } from '../../../src/render/world/TwistTiles';

// Step 4 Task 2 (Review Focus 3, as worlds3FixWave.test.ts did for the boulders): the Yeti's avalanche and the
// Glowcap's spore cloud are told apart, by colour, from what the Tundra and the Meadow already put on the lawn
// (ice pans, mist, Brain Rot's puddles), and the Glowcap's spore bomb is told apart from the other barrages.

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

describe('the Glowcap\'s spore cloud is not an ice pan, mist or a puddle', () => {
  const warning = BOSS_LOOK.glowcap.fx.strikeWarnings?.poison;

  it('is the poison warning drawn as a purple dither, nothing new in the strike shows', () => {
    expect(warning).toBeDefined();
    expect(warning?.dither).toBe(true);
    expect(BOSS_LOOK.glowcap.fx.strikeWarnings).toEqual({ poison: warning });
    expect(BOSS_LOOK.glowcap.fx.strikeBlow).toBeUndefined();
    // Purple: blue above green, red above green.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt((warning as { fill: string }).fill.slice(i, i + 2), 16)) as [number, number, number];
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });

  it.each(Object.entries(LAWN_COLORS))(`its fill is at least ${APART} apart (ΔE) from %s`, (_name, color) => {
    expect(deltaE(warning!.fill, color)).toBeGreaterThanOrEqual(APART);
  });

  it('is not the Yeti\'s navy either', () => {
    expect(deltaE(warning!.fill, BOSS_LOOK.yeti.fx.strikeWarnings!.stun!.fill)).toBeGreaterThanOrEqual(APART);
  });
});

describe('the Glowcap\'s spore bomb is not a pea, a melon or a needle', () => {
  /** The most common painted colour of a mesh's vertices (its body), as '#RRGGBB' (sRGB). */
  function bodyColor(geometry: BufferGeometry): string {
    const colors = geometry.getAttribute('color');
    const count = new Map<string, number>();
    for (let i = 0; i < colors.count; i++) {
      const hex = `#${new Color().setRGB(colors.getX(i), colors.getY(i), colors.getZ(i), LinearSRGBColorSpace).getHexString()}`;
      count.set(hex, (count.get(hex) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  const geometryOf = (o: unknown): BufferGeometry => (o as Mesh).geometry;
  const bomb = geometryOf(makeSporeBomb());
  const others: Record<string, BufferGeometry> = {
    pea: geometryOf(makeProjectile('pea')),
    acorn: geometryOf(makeProjectile('acorn')),
    'frozen melon': geometryOf(makeFrozenMelon()),
    needle: geometryOf(makeNeedle()),
  };

  it('is a round bomb, SPORE_BOMB_SIZE across, a glowing mesh of its own', () => {
    const mesh = makeSporeBomb() as Mesh;
    expect(mesh.name).toBe('projectile-spore-bomb');
    bomb.computeBoundingBox();
    const box = bomb.boundingBox!;
    const sides = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    for (const side of sides) expect(side).toBeCloseTo(SPORE_BOMB_SIZE, 2);
    expect((mesh.material as unknown as { emissiveIntensity: number }).emissiveIntensity).toBeGreaterThanOrEqual(1.5);
    for (const [name, geometry] of Object.entries(others)) expect(geometry, name).not.toBe(bomb);
  });

  it.each(Object.keys(others))('its body colour is far from the %s\'s', (name) => {
    expect(deltaE(bodyColor(bomb), bodyColor(others[name] as BufferGeometry))).toBeGreaterThanOrEqual(APART);
  });

  it('is violet (blue and red over green), not the pea\'s green, the melon\'s blue or the needle\'s spike', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(bodyColor(bomb).slice(i, i + 2), 16)) as [number, number, number];
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });
});
