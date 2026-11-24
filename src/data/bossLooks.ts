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
   * (`moon`), bark plates clapping shut (the model's `barkL`/`barkR`, which may be any material:
   * the Cactus King's are green spines, see `plateChips`), ice plates (`iceL`/`iceR`), or a
   * swirling ring of sand pixels round it (`sand`), or the same dome tinted snow white and ice blue
   * (`snow`: the Yeti's fort).
   */
  shield: 'dome' | 'moon' | 'bark' | 'ice' | 'sand' | 'snow';
  /** The chips that fly off its shut `bark` plates, and the ring thrown as they go up (hex): left out, walnut bark. */
  plateChips?: readonly string[];
  /**
   * Beaten: it bursts into brain blocks, drops its leaves and its acorns roll away, or breaks into
   * chips of `shards`' colours (across the lanes it stands in, or along its fallen length).
   */
  defeat: 'brains' | 'leaves' | 'shards';
  /** Its pupils follow the nearest enemy across the lanes (the model needs a `pupils` part). */
  eyes: 'still' | 'follow';
  /**
   * How a strike's blow lands: a boulder drops on each warned tile (the warning tiles show it
   * hanging over them, coming lower as the blow nears). Left out: rings and sparkles only.
   */
  strikeBlow?: 'boulder';
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
  /**
   * How the units it summons are dressed (views only: nothing in the simulation knows): as its
   * pups, with wolf ears (the Howler's), or wrapped in bandages as mummies (the Pharaoh's).
   */
  summonLook?: 'pups' | 'mummies';
  /** What its barrage throws: acorns (left out), frozen melons that tumble and trail ice, or cactus needles that fly point first. */
  barrage?: 'acorn' | 'frozenMelon' | 'needle';
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

const LOOKS = {
  ...SHIPPED,
  sandPharaoh: {
    // The model is a unit's voxels, a good deal bigger than the Titan.
    scale: 2.8,
    // The gold headdress striped in blue over a green face in bandages, a blue beard, a gold collar.
    face: [
      [1, 0, 10, 3, '#FFC83D'],
      [3, 0, 1, 3, '#2F6FD6'],
      [6, 0, 1, 3, '#2F6FD6'],
      [9, 1, 1, 2, '#2F6FD6'],
      [0, 3, 3, 8, '#FFC83D'],
      [9, 3, 3, 8, '#F0A21E'],
      [0, 5, 3, 1, '#2F6FD6'],
      [9, 5, 3, 1, '#1E4BA0'],
      [3, 3, 6, 6, '#9ACD8A'],
      [3, 8, 6, 1, '#E6D7AE'],
      [3, 4, 2, 3, 'eye'],
      [7, 5, 2, 2, 'eye'],
      [3, 3, 6, 1, '#E6D7AE'],
      [5, 9, 2, 2, '#2F6FD6'],
      [1, 10, 10, 2, '#FFC83D'],
      [5, 10, 2, 1, '#2F6FD6'],
    ],
    bar: { fill: '#E2B23A', hi: '#FFD86B' },
    call: 'pharaohCall',
    defeat: 'pharaohDefeat',
    fx: {
      roar: 'cheer', summon: 'ring', shield: 'sand', defeat: 'shards', eyes: 'still',
      // The sandstorm: both arms and the staff thrown up through the strike's wind-up.
      strike: 'shoot',
      // Phase 2: its eyes glow.
      phaseParts: ['glowEyes'],
      shards: ['#E2C68A', '#BC9C5E', '#E6D7AE', '#FFC83D', '#2F6FD6'],
      slamRise: 1.5,
      // The sandstorm's plants: a whirl of dark brown dust inside a cream outline (the shared grey is lost on the sand).
      strikeWarnings: { blind: { fill: '#3A2410', frame: '#FFF1C9', opacity: 0.85, dither: true, blow: '#E2C68A' } },
      summonLook: 'mummies',
    },
  },
  cactusKing: {
    // The model is at half resolution, like the Oak's (see cactusKing.ts).
    scale: 4,
    // A green cactus under a flower crown: pink petals round a yellow heart, a pale face, pink cheeks, a grin.
    face: [
      [1, 0, 3, 3, '#FF6FA8'],
      [4, 0, 4, 3, '#D94A86'],
      [8, 0, 3, 3, '#FF6FA8'],
      [5, 1, 2, 2, '#FFD23D'],
      [1, 3, 10, 9, '#4FA84A'],
      [1, 3, 1, 9, '#2F7D3A'],
      [10, 3, 1, 9, '#2F7D3A'],
      [2, 4, 8, 7, '#A6DB78'],
      [2, 7, 2, 1, '#FF6FA8'],
      [8, 7, 2, 1, '#FF6FA8'],
      [3, 5, 2, 2, 'eye'],
      [7, 5, 2, 2, 'eye'],
      [4, 9, 4, 1, '#3B1530'],
      [3, 8, 1, 1, '#3B1530'],
      [8, 8, 1, 1, '#3B1530'],
      [0, 6, 1, 1, '#FFF3C4'],
      [11, 8, 1, 1, '#FFF3C4'],
    ],
    bar: { fill: 'var(--c-leaf)', hi: 'var(--c-leaf-hi)' },
    call: 'cactusCreak',
    defeat: 'cactusDefeat',
    fx: {
      roar: 'ability', summon: 'sparkles', shield: 'bark', defeat: 'shards', eyes: 'follow',
      // The rockfall: both arms thrown up, shaking, through the strike's wind-up.
      strike: 'cheer',
      // Its spine armour: green and cream chips, not walnut bark.
      plateChips: ['#4FA84A', '#2F7D3A', '#FFF3C4', '#A6DB78'],
      // Its flower crown drops: green and pink chips.
      shards: ['#4FA84A', '#2F7D3A', '#A6DB78', '#FF6FA8', '#FFD23D'],
      // The rockfall: boulders hang over the warned tiles and drop, in shadow on the sand.
      strikeBlow: 'boulder',
      // Its barrage throws needles (thin green spikes), not acorns.
      barrage: 'needle',
      strikeWarnings: { none: { fill: '#2B1A10', frame: '#FF3B3B', opacity: 0.7, blow: '#F2A04A' } },
    },
  },
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
      summonLook: 'pups',
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
      // a plain lane look like one more sheet of ice; the navy is dark on ice and on snow alike, and so is
      // the outline, a darker navy (white went faint on the snow lane). The blow lands in bright ice.
      strikeWarnings: { stun: { fill: '#0A2A70', frame: '#06163F', opacity: 0.85, blow: '#39C6FF' } },
      barrage: 'frozenMelon',
    },
  },
  // Worlds-4 plan Task 2: the Tundra's last boss.
  yeti: {
    // The model is a unit's voxels, bulkier than the Titan and the Pharaoh.
    scale: 3,
    // A white shaggy head: two cream horns, a heavy brow, a blue face with a dark nose and two fangs.
    face: [
      [1, 0, 2, 4, '#EADFC0'],
      [9, 0, 2, 4, '#EADFC0'],
      [0, 3, 12, 9, '#F2F8FC'],
      [0, 3, 1, 9, '#B7CEDE'],
      [11, 3, 1, 9, '#B7CEDE'],
      [1, 3, 10, 2, '#B7CEDE'],
      [2, 5, 8, 6, '#5CB4E8'],
      [2, 9, 8, 2, '#2F82BD'],
      [3, 5, 2, 3, 'eye'],
      [7, 6, 2, 2, 'eye'],
      [5, 8, 2, 2, '#1B4F7C'],
      [3, 10, 6, 1, '#101C2A'],
      [4, 9, 1, 1, '#F4EBDD'],
      [7, 9, 1, 1, '#F4EBDD'],
    ],
    bar: { fill: '#8FDCFF', hi: '#D4F4FF' },
    call: 'yetiRoar',
    defeat: 'yetiDefeat',
    fx: {
      roar: 'cheer', summon: 'ring', shield: 'snow', defeat: 'shards', eyes: 'still',
      // The avalanche: both arms and the club thrown up, shaking, through the strike's wind-up.
      strike: 'shoot',
      // From its first shield mark: icy breath in front of its mouth.
      phaseParts: ['frostBreath'],
      shards: ['#F2F8FC', '#B7CEDE', '#8FDCFF', '#D4F4FF', '#EADFC0'],
      slamRise: 1.5,
      // The avalanche's lanes: the Frost Melon's navy blinking inside a dark navy outline (any icy blue is lost on the
      // Tundra's snow and ice), and the blow lands in white snow.
      strikeWarnings: { stun: { fill: '#0A2A70', frame: '#06163F', opacity: 0.85, blow: '#FFFFFF' } },
    },
  },
} satisfies Record<Exclude<BossKey, 'glowcap'>, BossLook>;

export const BOSS_LOOK: Record<BossKey, BossLook> = {
  ...LOOKS,
  // STUB (worlds-4 plan Task 1): the Glowcap borrows the Frost Melon's look until its own commit.
  glowcap: LOOKS.frostMelon,
};
