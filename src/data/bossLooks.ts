import type { SfxName } from '../audio/sfx';
import type { BossKey } from '../sim/types';

// How each boss looks and sounds (worlds machinery, Task 5): one row per boss, read by the battle
// view's boss shows (`BossFx`), the HUD's boss bar (`BossBar`) and the sound bindings. A new boss
// adds its row here (and its model in `render/models/registry.ts`, its numbers in `Balance.bosses`);
// nothing else names a boss. Data only: no Three.js, no DOM.

/**
 * One square of the boss bar's 12×12 pixel face, in drawing order: `[x, y, w, h, fill]`, or
 * `[x, y, w, h, 'eye']` for an eye (drawn open, or knocked out as an X once the boss is beaten).
 */
export type FacePixel = readonly [x: number, y: number, w: number, h: number, fill: string];

/** Which of the shows `BossFx` knows each moment of the fight uses. */
export interface BossShows {
  /** The roar in the middle of its entrance: arms up (`cheer`) or its ability move. */
  roar: 'cheer' | 'ability';
  /** A summon: a purple ring and a stomp, or leaf sparkles from its crown (with its ability move). */
  summon: 'ring' | 'sparkles';
  /** Its shield: a glass dome round it (shots ping off), or bark plates clapping shut. */
  shield: 'dome' | 'bark';
  /** Beaten: it bursts into brain blocks, or drops its leaves and its acorns roll away. */
  defeat: 'brains' | 'leaves';
  /** Its pupils follow the nearest enemy across the lanes (the model needs a `pupils` part). */
  eyes: 'still' | 'follow';
}

export interface BossLook {
  /** How much bigger than a unit it is drawn (the models are a unit's voxels). */
  scale: number;
  /** Its face on the boss bar and the entrance card. */
  face: readonly FacePixel[];
  /** The bar's fill (CSS colours: a custom property or a hex). */
  bar: { fill: string; hi: string };
  /** Its signature call (the entrance and its patterns) and its defeat sting. */
  call: SfxName;
  defeat: SfxName;
  fx: BossShows;
}

/** The shipped bosses' rows (world 1). */
const SHIPPED = {
  brainTitan: {
    // The model is a unit's voxels.
    scale: 2.4,
    // The green head with its brain crown.
    face: [
      [1, 3, 10, 7, '#9ACD8A'],
      [1, 2, 10, 1, '#FFC83D'],
      [1, 0, 3, 2, '#FF8FB1'],
      [4.5, 0, 3, 2, '#FF8FB1'],
      [8, 0, 3, 2, '#FF8FB1'],
      [2, 4, 3, 3, 'eye'],
      [7, 5, 2, 2, 'eye'],
      [0, 8, 12, 4, '#6FA364'],
      [2, 7, 2, 2, '#F4EBDD'],
      [8, 7, 2, 2, '#F4EBDD'],
    ],
    bar: { fill: 'var(--c-purple)', hi: 'var(--c-purple-hi)' },
    call: 'titanRoar',
    defeat: 'titanDefeat',
    fx: { roar: 'cheer', summon: 'ring', shield: 'dome', defeat: 'brains', eyes: 'still' },
  },
  elderOak: {
    // The model is at half resolution (see elderOak.ts).
    scale: 4,
    // The bark face under leaves.
    face: [
      [0, 0, 12, 4, '#3E9A2E'],
      [1, 0, 10, 2, '#58C13B'],
      [2, 4, 8, 8, '#A8703A'],
      [3, 5, 6, 6, '#C98F55'],
      [3, 4, 2, 1, '#3E9A2E'],
      [7, 4, 2, 1, '#3E9A2E'],
      [3, 5, 2, 2, 'eye'],
      [7, 5, 2, 2, 'eye'],
      [4, 8, 4, 1, '#8BE05A'],
      [4, 9, 4, 1, '#24140A'],
    ],
    bar: { fill: 'var(--c-wood)', hi: 'var(--c-wood-hi)' },
    call: 'oakCreak',
    defeat: 'oakDefeat',
    fx: { roar: 'ability', summon: 'sparkles', shield: 'bark', defeat: 'leaves', eyes: 'follow' },
  },
} satisfies Record<'brainTitan' | 'elderOak', BossLook>;

export const BOSS_LOOK: Record<BossKey, BossLook> = {
  ...SHIPPED,
  // stub: Task 2. The world-2 bosses wear the Titan's and the Oak's rows until their own are drawn.
  moonHowler: { ...SHIPPED.brainTitan },
  frostMelon: { ...SHIPPED.elderOak },
};
