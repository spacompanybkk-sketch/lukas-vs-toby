import type { SfxName } from '../audio/sfx';
import type { BossKey, StatusKind } from '../sim/types';

// How each boss looks and sounds (worlds machinery, Task 5): one row per boss, read by the battle
// view's boss shows (`BossFx`), the HUD's boss bar (`BossBar`) and the sound bindings. A new boss
// adds its row here (and its model in `render/models/registry.ts`, its numbers in `Balance.bosses`);
// nothing else names a boss. Data only: no Three.js, no DOM.

/**
 * One square of the boss bar's 12×12 pixel face, in drawing order: `[x, y, w, h, fill]`, or
 * `[x, y, w, h, 'eye']` for an eye (drawn open, or knocked out as an X once the boss is beaten).
 */
export type FacePixel = readonly [x: number, y: number, w: number, h: number, fill: string];

/** A strike's warning colours (CSS hex): the blinking fill and its opacity, the steady outline. */
export interface StrikeWarning {
  fill: string; frame: string; opacity: number;
  /** The fill drawn as a crawling pixel dither (smoke) that stays up, not a solid blink. */
  dither?: boolean;
  /** The colour the blow lands in (its rings and sparkles), where the outline's would be too dark. Left out: `frame`. */
  blow?: string;
}

/** Which of the shows `BossFx` knows each moment of the fight uses. */
export interface BossShows {
  /** The roar in the middle of its entrance: arms up (`cheer`) or its ability move. */
  roar: 'cheer' | 'ability';
  /** A summon: a purple ring and a stomp, or leaf sparkles from its crown (with its ability move). */
  summon: 'ring' | 'sparkles';
  /**
   * Its shield: a glass dome round it (shots ping off), the same dome glowing in moonlight
   * (`moon`), bark plates clapping shut (the model's `barkL`/`barkR`), or ice plates (`iceL`/`iceR`).
   */
  shield: 'dome' | 'moon' | 'bark' | 'ice';
  /**
   * Beaten: it bursts into brain blocks, drops its leaves and its acorns roll away, or breaks into
   * chips of `shards`' colours (across the lanes it stands in, or along its fallen length).
   */
  defeat: 'brains' | 'leaves' | 'shards';
  /** Its pupils follow the nearest enemy across the lanes (the model needs a `pupils` part). */
  eyes: 'still' | 'follow';
  /**
   * The move it makes through a strike's wind-up, drawn out to end with the blow (a one-shot clip
   * slowed to fit, a looping one held). Left out: no move (the Titan's test-only strike).
   */
  strike?: 'cheer' | 'ability' | 'shoot';
  /** Model parts (built hidden) that blink with the strike's warning tiles: the Melon's icicle crown. */
  strikeParts?: readonly string[];
  /** Model parts (built hidden) shown from phase 2 on, after its first shield mark. */
  phaseParts?: readonly string[];
  /** A `shards` defeat's colours (hex). */
  shards?: readonly string[];
  /**
   * Its own strike warning colours by the status the strike leaves, where the shared tint would not
   * read on its world's ground (the Howler's grey blind on the night Meadow): the fill blinks in
   * `fill` at `opacity`, the outline stays in `frame`, and the blow flies in `frame`.
   */
  strikeWarnings?: Partial<Record<StatusKind | 'none', StrikeWarning>>;
  /** The units it summons come on as its pups, with wolf ears (the Howler's); views only. */
  pups?: boolean;
  /** What its barrage throws: acorns (left out), or frozen melons that tumble and trail ice. */
  barrage?: 'acorn' | 'frozenMelon';
  /**
   * Seconds its slam clip (`ability`) takes to raise the arm; the clip is sped up or slowed so the
   * rise fills each slam's own wind-up. Left out: the clip is timed to the wind-up as it is.
   */
  slamRise?: number;
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
  moonHowler: {
    // The model is a unit's voxels, a little bigger than the Titan.
    scale: 2.6,
    // The green head between two grey wolf ears, its snout and nose, a fur ruff and the moon pendant.
    face: [
      [1, 0, 3, 4, '#9C98B8'],
      [8, 0, 3, 4, '#9C98B8'],
      [2, 1, 1, 2, '#F2A0BE'],
      [9, 1, 1, 2, '#F2A0BE'],
      [1, 3, 10, 7, '#9ACD8A'],
      [1, 3, 10, 1, '#9C98B8'],
      [2, 4, 3, 3, 'eye'],
      [7, 5, 2, 2, 'eye'],
      [3, 7, 6, 3, '#CDEDBE'],
      [5, 7, 2, 1, '#22202C'],
      [4, 9, 1, 1, '#FFF7E3'],
      [7, 9, 1, 1, '#FFF7E3'],
      [0, 10, 12, 2, '#9C98B8'],
      [5, 10, 2, 2, '#FFF2A8'],
    ],
    bar: { fill: 'var(--c-slate)', hi: 'var(--c-slate-hi)' },
    call: 'howlerHowl',
    defeat: 'howlerDefeat',
    fx: {
      roar: 'cheer', summon: 'ring', shield: 'moon', defeat: 'shards', eyes: 'still',
      // The howl: head thrown back through the blinding strike's wind-up.
      strike: 'shoot',
      // Phase 2: its pendant lights up as a little full moon, a crescent moon glows over its head, its eyes glow.
      phaseParts: ['glow', 'glowMoon', 'glowEyes'],
      shards: ['#9C98B8', '#66627F', '#9ACD8A', '#7B4BD6', '#FFF2A8'],
      slamRise: 1.5,
      // The blinding howl's lane: dark purple smoke, a crawling pixel dither, inside a light outline, which reads on the night lawn
      // (the shared grey came out near-white there).
      strikeWarnings: { blind: { fill: '#1C1430', frame: '#E6E0F5', opacity: 0.88, dither: true } },
      pups: true,
    },
  },
  frostMelon: {
    // The model is at half resolution, like the Oak's (see frostMelon.ts).
    scale: 4,
    // A green melon under a cap of snow and an icicle crown, frosty brows and a frosty moustache.
    face: [
      [2, 0, 2, 3, '#7FD3F5'],
      [5, 0, 2, 3, '#B8ECFF'],
      [8, 0, 2, 3, '#7FD3F5'],
      [0, 4, 12, 8, '#3FA34D'],
      [0, 4, 1, 8, '#27733A'],
      [11, 4, 1, 8, '#27733A'],
      [1, 3, 10, 2, '#F4FBFF'],
      [2, 5, 8, 6, '#BFEBB0'],
      [2, 5, 3, 1, '#E8FAFF'],
      [7, 5, 3, 1, '#E8FAFF'],
      [3, 6, 2, 2, 'eye'],
      [7, 6, 2, 2, 'eye'],
      [3, 9, 6, 1, '#B8ECFF'],
      [4, 10, 4, 1, '#3B1530'],
    ],
    bar: { fill: 'var(--c-sky)', hi: 'var(--c-sky-hi)' },
    call: 'melonCrack',
    defeat: 'melonDefeat',
    fx: {
      roar: 'ability', summon: 'sparkles', shield: 'ice', defeat: 'shards', eyes: 'follow',
      // The freeze: it swells and shivers, its crown rising, through the strike's wind-up, then stamps.
      strike: 'cheer',
      // Its icicle crown lights up and blinks with the lanes about to freeze.
      strikeParts: ['crownGlow'],
      // Phase 2: glowing cracks in its rind, big icicles out of its top and its near end, its eyes alight.
      phaseParts: ['frostCracks', 'frostSpikes', 'glowEyes'],
      shards: ['#3FA34D', '#27733A', '#B8ECFF', '#7FD3F5', '#F4FBFF'],
      // The freeze's lanes: deep-water navy blinking inside a frost-white outline. Seen on the real
      // Tundra, any icy blue (the shared pale one, or a strong one) is lost on the icy lanes and makes
      // a plain lane look like one more sheet of ice; the navy is dark on ice and on snow alike, the
      // white outline stands on the ice. The blow lands in bright ice.
      strikeWarnings: { stun: { fill: '#0A2A70', frame: '#F4FBFF', opacity: 0.85, blow: '#39C6FF' } },
      barrage: 'frozenMelon',
    },
  },
};
