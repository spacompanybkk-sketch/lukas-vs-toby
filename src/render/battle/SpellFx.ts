import { Group, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three';
import type { Effects } from '../fx/Effects';
import type { Particles } from '../fx/Particles';
import { MATTE_PLASTIC } from '../look';
import {
  GRAVESTONE_HEIGHT,
  PROP_COLORS,
  makeBolt,
  makeFogBlock,
  makeGravestone,
  makeMeteor,
  makeRock,
  makeToken,
  makeVine,
  rockStage,
  spinToken,
  type RockStage,
} from '../models/props';
import { spellArea as simSpellArea } from '../../sim/spells';
import type { SpellSize } from '../../sim/types';
import { PALETTE } from '../palette';
import type { Faction, SpellKey } from '../types';
import { BoxBatch, hash2 } from '../world/boxes';
import { TileMark } from '../world/TileMark';
import type { Feel } from './types';

// The ten spells as the lawn shows them (plan Task 5, spec section 21), each its own boxy
// effect over its area, drawn from `spellCast` alone:
//
//   thunderbolt   a yellow stepped bolt on each tile, sparks, and a scorch left behind
//   vines         vines spring up over the tiles and stand for the 4 s of the tie
//   sunShower     sun tokens fall over the plants' half of the lawn
//   healingRain   glowing green rain blocks fall on the 3 × 3, and plus signs rise
//   rockWall      a rock heaves up out of the tile; it cracks as it is chewed and crumbles
//   meteor        a tumbling voxel meteor streaks in from the zombies' side and blows up
//   fog           a bank of grey blocks rolls over the tiles for the 5 s of the blindness
//   brainFeast    brains fall over the zombies' half of the lawn
//   frenzy        a red shockwave and red speed sparks over the 3 × 3 (the zombies in it
//                 get the `haste` status mark from StatusMarks)
//   graveRise     three gravestones burst up out of the tile and shatter, for the minions
//
// The rock is drawn here, not as a unit model: the wiring routes the rock unit's damage to
// `setRock` and its death to `crumbleRock`. While a spell is aimed, `showArea` highlights
// the tiles it would cover. Every object comes from a pool built up front.

/** Whose each spell is. */
export const SPELL_SIDE: Record<SpellKey, Faction> = {
  thunderbolt: 'plants',
  vines: 'plants',
  sunShower: 'plants',
  healingRain: 'plants',
  rockWall: 'plants',
  meteor: 'zombies',
  fog: 'zombies',
  brainFeast: 'zombies',
  frenzy: 'zombies',
  graveRise: 'zombies',
};

/**
 * How long each spell's show lasts, in seconds. The vines and the fog stand for as long as
 * the tie and the blindness they bring (spec section 21: 4 s and 5 s); the rock stays until
 * it is crumbled.
 */
export const SPELL_SECONDS: Record<SpellKey, number> = {
  thunderbolt: 1.6,
  vines: 4,
  sunShower: 1.6,
  healingRain: 1.6,
  rockWall: 0.5,
  meteor: 1.6,
  fog: 5,
  brainFeast: 1.6,
  frenzy: 1,
  graveRise: 1.1,
};

export interface Tile {
  lane: number;
  col: number;
}

const COLS = 10;
const LANES = 5;

/**
 * The tiles a spell covers when tapped at (`lane`, `col`) with the cast's area `size` (from
 * `spellCast`, or the balance table while aiming): the simulation's own rule (`spellArea` in
 * `src/sim/spells.ts`), so what is drawn is what is hit. Size 0 (Sun Shower, Brain Feast) covers
 * none, 1 the tapped tile (Rock Wall, Grave Rise), 2 a 2 x 2, 3 a 3 x 3. The tapped tile is first
 * brought onto the lawn.
 */
export function spellArea(spell: SpellKey, lane: number, col: number, size: number): Tile[] {
  const l = Math.min(LANES - 1, Math.max(0, Math.floor(lane)));
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(col)));
  const area = Math.min(3, Math.max(0, Math.floor(size))) as SpellSize;
  return simSpellArea(SPELL_SIDE[spell], area, l, c);
}

export interface SpellFxOptions {
  /** Screen feedback a spell asks for (the bolt's and the meteor's shake). */
  onFeel?: (feel: Feel) => void;
}

/** One running show. `step` moves it on and says whether it has finished; `stop` puts it away now. */
interface Job {
  step(dt: number): boolean;
  stop(): void;
}

/** The largest area a spell covers: a 3 × 3. Pools are sized from it. */
const MAX_AREA = 9;
const VINES_PER_TILE = 6;
const FOG_PER_TILE = 7;
/** Each pool holds enough for this many casts of its spell at once, at the largest area. */
const CASTS = 2;

/** Objects of one kind, built up front and lent out. */
class Pool {
  private readonly free: Object3D[] = [];
  private warned = false;
  constructor(
    group: Group,
    count: number,
    make: () => Object3D,
    private readonly name: string,
  ) {
    for (let i = 0; i < count; i++) {
      const o = make();
      o.visible = false;
      // The size it was made at, to go back to when it is returned.
      o.userData.restScale = o.scale.x;
      group.add(o);
      this.free.push(o);
    }
  }
  /** An object, or null with a warning (once) when every one is out: never a silent gap. */
  take(): Object3D | null {
    const o = this.free.pop();
    if (o) return o;
    if (!this.warned) {
      this.warned = true;
      console.warn(`SpellFx: the ${this.name} pool ran out; a spell is showing less than it should.`);
    }
    return null;
  }
  give(o: Object3D | null): void {
    if (!o) return;
    o.visible = false;
    o.scale.setScalar((o.userData.restScale as number | undefined) ?? 1);
    o.rotation.set(0, 0, 0);
    this.free.push(o);
  }
}

const hex = (c: string): number => parseInt(c.slice(1), 16);
const C = {
  bolt: [hex(PALETTE.stunStars), hex('#FFFBE6'), hex(PALETTE.hitSpark)],
  leaf: [hex(PALETTE.leaf), hex(PALETTE.leafDark), hex(PALETTE.leafLight)],
  heal: hex(PALETTE.heal),
  rock: [hex(PROP_COLORS.rock), hex(PROP_COLORS.rockDark), hex(PROP_COLORS.rockLight), hex(PROP_COLORS.moss)],
  stone: [hex(PALETTE.stone), hex(PALETTE.stoneDark), hex(PALETTE.stone)],
  red: [hex(PALETTE.speedRed), hex('#FF9A7A'), hex(PALETTE.speedRed)],
  fire: hex(PALETTE.fire),
};

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c1 + 1) * u ** 3 + c1 * u ** 2;
};

/** A stepped scorch mark, one tile across, lying on the lawn. */
function scorchGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const cell = 1 / 10;
  for (let i = -5; i < 5; i++) {
    for (let k = -5; k < 5; k++) {
      const d = Math.hypot(i + 0.5, k + 0.5) / 5 + (hash2(i, k, 12) - 0.5) * 0.3;
      if (d > 0.95) continue;
      b.box(i * cell, 0, k * cell, cell, 0.008, cell, d < 0.45 ? '#1F1A17' : d < 0.75 ? '#3A2F25' : '#5A4A2E');
    }
  }
  return b.build();
}

/** A tangle of leaves lying over a tile: what is left on the ground where the vines grew. */
function vineMatGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const cell = 1 / 9;
  for (let i = -4; i < 5; i++) {
    for (let k = -4; k < 5; k++) {
      const r = hash2(i, k, 41);
      if (Math.hypot(i, k) > 4.6 || r < 0.25) continue;
      b.box(i * cell - cell / 2, 0, k * cell - cell / 2, cell, r > 0.8 ? 0.03 : 0.015, cell, PALETTE.leafDark, r > 0.8 ? PALETTE.leaf : PALETTE.stem);
    }
  }
  return b.build();
}

/** Tokens in a Sun Shower or a Brain Feast, and gravestones in a Grave Rise. */
const SHOWER_DROPS = 8;
const GRAVES = 3;

const at = new Vector3();
const velocity = new Vector3();

export class SpellFx {
  readonly group = new Group();

  private readonly effects: Effects;
  private readonly particles: Particles;
  private readonly onFeel: (feel: Feel) => void;
  private readonly jobs: Job[] = [];
  private readonly scorchShape = scorchGeometry();
  private readonly scorchMaterial = new MeshStandardMaterial(MATTE_PLASTIC);
  private readonly vineMatShape = vineMatGeometry();
  private readonly vineMatMaterial = new MeshStandardMaterial(MATTE_PLASTIC);
  private readonly marks: TileMark[] = [];
  private readonly rockStages: BufferGeometry[];
  private readonly rocksByTile = new Map<number, { mesh: Mesh; stage: RockStage; job: Job | null }>();

  private readonly bolts: Pool;
  private readonly scorches: Pool;
  private readonly vines: Pool;
  private readonly vineMats: Pool;
  private readonly suns: Pool;
  private readonly brains: Pool;
  private readonly rockPool: Pool;
  private readonly meteors: Pool;
  private readonly fog: Pool;
  private readonly graves: Pool;

  constructor(effects: Effects, particles: Particles, options: SpellFxOptions = {}) {
    this.effects = effects;
    this.particles = particles;
    this.onFeel = options.onFeel ?? (() => {});
    this.group.name = 'spell-fx';
    const g = this.group;
    this.rockStages = ([0, 1, 2] as const).map((s) => (makeRock(s) as Mesh).geometry);
    this.bolts = new Pool(g, MAX_AREA * CASTS, () => makeBolt('plants'), 'bolt');
    // Scorches: the Thunderbolt's and the meteor's at once.
    this.scorches = new Pool(g, MAX_AREA * CASTS * 2, () => {
      const m = new Mesh(this.scorchShape, this.scorchMaterial);
      m.name = 'scorch';
      m.receiveShadow = true;
      return m;
    }, 'scorch');
    this.vines = new Pool(g, MAX_AREA * VINES_PER_TILE * CASTS, makeVine, 'vine');
    this.vineMats = new Pool(g, MAX_AREA * CASTS, () => {
      const m = new Mesh(this.vineMatShape, this.vineMatMaterial);
      m.name = 'vine-mat';
      m.receiveShadow = true;
      return m;
    }, 'vine mat');
    this.suns = new Pool(g, SHOWER_DROPS * CASTS, () => makeToken('sun'), 'sun');
    this.brains = new Pool(g, SHOWER_DROPS * CASTS, () => makeToken('brain'), 'brain');
    // One rock per plant tile.
    this.rockPool = new Pool(g, 40, () => {
      const m = makeRock(0) as Mesh;
      m.name = 'spell-rock';
      return m;
    }, 'rock');
    this.meteors = new Pool(g, CASTS, () => {
      const m = makeMeteor();
      m.scale.setScalar(1.3);
      return m;
    }, 'meteor');
    this.fog = new Pool(g, MAX_AREA * FOG_PER_TILE * CASTS, makeFogBlock, 'fog');
    this.graves = new Pool(g, GRAVES * CASTS, makeGravestone, 'gravestone');
    for (let i = 0; i < 9; i++) {
      const mark = new TileMark('spell-area', 1, 1, { vivid: true });
      this.marks.push(mark);
      g.add(mark.mesh);
    }
  }

  /** Spell shows running now (a standing rock is not one). */
  get active(): number {
    return this.jobs.length;
  }

  /** Whether a rock stands on (`lane`, `col`). */
  hasRock(lane: number, col: number): boolean {
    return this.rocksByTile.has(tileKey(lane, col));
  }

  /** Rocks standing on the lawn. */
  get rocks(): number {
    return this.rocksByTile.size;
  }

  /** Plays `spell` cast at (`lane`, `col`) over an area of `size` (from `spellCast`). */
  cast(spell: SpellKey, lane: number, col: number, size: number): void {
    const tiles = spellArea(spell, lane, col, size);
    const job = this.start(spell, tiles);
    if (job) this.jobs.push(job);
  }

  /**
   * Highlights `tiles` (from `spellArea`) while a spell is aimed, in `side`'s colour, or red
   * stripes for `bad`; `null` clears the highlight.
   */
  showArea(tiles: readonly Tile[] | null, side: Faction = 'plants', state: 'ok' | 'bad' = 'ok'): void {
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i] as TileMark;
      const tile = tiles?.[i];
      if (tile) mark.show(tile.col + 0.5, tile.lane + 0.5, state, side);
      else mark.hide();
    }
  }

  /** The rock on (`lane`, `col`) has `fraction` of its health left: it cracks as it drops. */
  setRock(lane: number, col: number, fraction: number): void {
    const rock = this.rocksByTile.get(tileKey(lane, col));
    if (!rock) return;
    const stage = rockStage(fraction);
    if (stage === rock.stage) return;
    rock.stage = stage;
    rock.mesh.geometry = this.rockStages[stage] as BufferGeometry;
    // A few chips fly off as it cracks.
    this.effects.burst(at.set(col + 0.5, 0.45, lane + 0.5), C.rock, 6 + 4 * stage, 1.8);
  }

  /** The rock on (`lane`, `col`) is gone (eaten, or its time is up): it crumbles to debris. */
  crumbleRock(lane: number, col: number): void {
    const k = tileKey(lane, col);
    const rock = this.rocksByTile.get(k);
    if (!rock) return;
    this.rocksByTile.delete(k);
    if (rock.job) this.removeJob(rock.job);
    this.effects.debris(at.set(col + 0.5, 0.25, lane + 0.5), C.rock, 3);
    rock.mesh.geometry = this.rockStages[0] as BufferGeometry;
    this.rockPool.give(rock.mesh);
  }

  /** Moves every show on by `dtSeconds` of game time. */
  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i] as Job;
      if (job.step(dt)) {
        job.stop();
        this.jobs.splice(i, 1);
      }
    }
    // The aimed area breathes, as the placement highlight does.
    this.pulse += dt;
    const p = 0.5 + 0.5 * Math.sin(this.pulse * 5.5);
    for (let i = 0; i < this.marks.length; i++) (this.marks[i] as TileMark).pulse(p);
  }

  /** Ends every show, takes every rock away and clears the highlight (a scene being reset). */
  clear(): void {
    for (const job of this.jobs) job.stop();
    this.jobs.length = 0;
    for (const [k, rock] of this.rocksByTile) {
      this.rocksByTile.delete(k);
      rock.mesh.geometry = this.rockStages[0] as BufferGeometry;
      this.rockPool.give(rock.mesh);
    }
    this.showArea(null);
  }

  /**
   * Stops every show, takes `group` out of the scene, and frees what this class made: the
   * scorch and vine-mat shapes and materials and the area highlights. The props' shapes
   * and materials belong to `props.ts`.
   */
  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    this.group.clear();
    this.scorchShape.dispose();
    this.vineMatShape.dispose();
    this.scorchMaterial.dispose();
    this.vineMatMaterial.dispose();
    for (const mark of this.marks) mark.dispose();
  }

  private pulse = 0;

  private removeJob(job: Job): void {
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    job.stop();
  }

  private start(spell: SpellKey, tiles: Tile[]): Job | null {
    switch (spell) {
      case 'thunderbolt':
        return this.thunderbolt(tiles);
      case 'vines':
        return this.growVines(tiles);
      case 'sunShower':
        return this.shower(this.suns, 0.4, 7.6, PALETTE.sun);
      case 'healingRain':
        return this.rain(tiles);
      case 'rockWall':
        return this.rockWall(tiles[0] as Tile);
      case 'meteor':
        return this.meteor(tiles);
      case 'fog':
        return this.fogBank(tiles);
      case 'brainFeast':
        return this.shower(this.brains, 4.4, 9.6, PALETTE.brains);
      case 'frenzy':
        return this.frenzy(tiles);
      case 'graveRise':
        return this.graveRise(tiles[0] as Tile);
    }
  }

  /** A scorch on a tile that lasts `seconds`, shrinking away over the last half second. */
  private scorch(tile: Tile, seconds: number): Job {
    const mark = this.scorches.take();
    if (mark) {
      mark.visible = true;
      mark.position.set(tile.col + 0.5, 0.004, tile.lane + 0.5);
      mark.rotation.y = ((tile.lane * 3 + tile.col) % 4) * (Math.PI / 2);
    }
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        if (mark) mark.scale.setScalar(Math.max(0.01, Math.min(1, (seconds - time) / 0.5)));
        return time >= seconds;
      },
      stop: () => this.scorches.give(mark),
    };
  }

  /** Several jobs as one, finished when all are. */
  private all(parts: Job[]): Job {
    const done: boolean[] = [];
    for (let i = 0; i < parts.length; i++) done.push(false);
    return {
      step: (dt) => {
        let finished = true;
        for (let i = 0; i < parts.length; i++) {
          if (done[i]) continue;
          const p = parts[i] as Job;
          if (p.step(dt)) {
            done[i] = true;
            p.stop();
          } else finished = false;
        }
        return finished;
      },
      stop: () => {
        for (let i = 0; i < parts.length; i++) if (!done[i]) (parts[i] as Job).stop();
      },
    };
  }

  /** Runs `job` after `delay` seconds. */
  private later(delay: number, make: () => Job): Job {
    let time = 0;
    let job: Job | null = null;
    return {
      step: (dt) => {
        time += dt;
        if (!job && time >= delay) job = make();
        return job ? job.step(time >= delay && time - dt < delay ? time - delay : dt) : false;
      },
      stop: () => job?.stop(),
    };
  }

  private thunderbolt(tiles: Tile[]): Job {
    return this.all(
      tiles.map((tile, i) =>
        this.later(i * 0.07, () => {
          const bolt = this.bolts.take();
          const x = tile.col + 0.5;
          const z = tile.lane + 0.5;
          if (bolt) {
            bolt.visible = true;
            bolt.position.set(x, 0, z);
            bolt.rotation.y = (tile.col + tile.lane) * 1.3;
          }
          at.set(x, 0.1, z);
          this.effects.spark(at);
          this.effects.ring(at, hex(PALETTE.stunStars), 0.7, true);
          this.effects.burst(at, C.bolt, 10, 3);
          this.onFeel({ shake: i === 0 ? 0.45 : 0.2 });
          const scorch = this.scorch(tile, SPELL_SECONDS.thunderbolt - i * 0.07);
          let time = 0;
          const strike: Job = {
            step: (dt) => {
              time += dt;
              if (bolt) {
                // A double flicker, then gone.
                bolt.visible = time < 0.22 && !(time > 0.08 && time < 0.12);
              }
              return time >= 0.22;
            },
            stop: () => this.bolts.give(bolt),
          };
          return this.all([strike, scorch]);
        }),
      ),
    );
  }

  private growVines(tiles: Tile[]): Job {
    const seconds = SPELL_SECONDS.vines;
    const placed: { o: Object3D; delay: number; sway: number; lean: number }[] = [];
    const mats: Object3D[] = [];
    tiles.forEach((tile, t) => {
      const cx = tile.col + 0.5;
      const cz = tile.lane + 0.5;
      const mat = this.vineMats.take();
      if (mat) {
        mat.visible = true;
        mat.position.set(cx, 0.003, cz);
        mat.rotation.y = (t % 4) * (Math.PI / 2);
        mats.push(mat);
      }
      // A ring of vines round the middle of the tile, each hooked over towards it, so
      // whatever stands there is caught in the middle of them.
      for (let i = 0; i < VINES_PER_TILE; i++) {
        const o = this.vines.take();
        if (!o) continue;
        const a = (i / 6) * Math.PI * 2 + hash2(t, tile.col, 1) * 1.2;
        const r = 0.3 + hash2(i, t, 2) * 0.08;
        const dx = Math.cos(a) * r;
        const dz = Math.sin(a) * r;
        o.visible = true;
        o.position.set(cx + dx, 0, cz + dz);
        o.rotation.set(0, Math.atan2(dz, -dx), 0);
        placed.push({ o, delay: t * 0.05 + i * 0.035, sway: hash2(i, t, 4) * 6, lean: -0.2 - hash2(i, t, 5) * 0.2 });
      }
      this.effects.burst(at.set(cx, 0.1, cz), C.leaf, 8, 2);
      this.effects.dirt(at);
    });
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        const wither = Math.min(1, Math.max(0, (seconds - time) / 0.3));
        for (let i = 0; i < placed.length; i++) {
          const v = placed[i] as (typeof placed)[number];
          const s = Math.max(0.001, Math.min(easeOutBack((time - v.delay) / 0.35), wither));
          // They spring up, then sway a little as they squeeze.
          v.o.scale.set(1.4 * s, 1.7 * s, 1.4 * s);
          v.o.rotation.z = v.lean + Math.sin(time * 2.4 + v.sway) * 0.08;
        }
        for (let i = 0; i < mats.length; i++) (mats[i] as Object3D).scale.setScalar(Math.max(0.001, Math.min(1, time / 0.25, wither)));
        return time >= seconds;
      },
      stop: () => {
        for (let i = 0; i < placed.length; i++) this.vines.give((placed[i] as (typeof placed)[number]).o);
        for (let i = 0; i < mats.length; i++) this.vineMats.give(mats[i] as Object3D);
      },
    };
  }

  /**
   * Tokens falling across columns `x0` to `x1` of every lane: the two income spells. The "+N"
   * comes from the battle view, with the amount the simulation really paid.
   */
  private shower(pool: Pool, x0: number, x1: number, color: string): Job {
    const drops: { o: Object3D | null; x: number; z: number; delay: number }[] = [];
    for (let i = 0; i < SHOWER_DROPS; i++) {
      const x = x0 + ((i * 0.618) % 1) * (x1 - x0);
      const z = 0.5 + ((i * 3) % 5);
      drops.push({ o: null, x, z, delay: i * 0.1 });
    }
    const FALL = 0.55;
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        for (let i = 0; i < drops.length; i++) {
          const d = drops[i] as (typeof drops)[number];
          const t = (time - d.delay) / FALL;
          if (t < 0) continue;
          if (!d.o && t < 1.5) {
            d.o = pool.take();
            if (d.o) d.o.visible = true;
          }
          if (!d.o) continue;
          if (t < 1) {
            d.o.position.set(d.x, 0.35 + 3.4 * (1 - t * t), d.z);
            d.o.scale.setScalar(1);
          } else if (t < 1.5) {
            if (d.o.scale.x === 1) this.effects.sparkles(at.set(d.x, 0.3, d.z), hex(color));
            d.o.position.set(d.x, 0.35 + (t - 1) * 0.6, d.z);
            d.o.scale.setScalar(Math.max(0.001, 1 - (t - 1) * 2) * 0.999);
          } else {
            pool.give(d.o);
            d.o = null;
            d.delay = Infinity;
          }
          if (d.o) spinToken(d.o, time + d.x);
        }
        return time >= SPELL_SECONDS.sunShower;
      },
      stop: () => {
        for (let i = 0; i < drops.length; i++) pool.give((drops[i] as (typeof drops)[number]).o);
      },
    };
  }

  private rain(tiles: Tile[]): Job {
    let time = 0;
    let owed = 0;
    let n = 0;
    let healed = false;
    return {
      step: (dt) => {
        time += dt;
        if (time < 1.2 && tiles.length) {
          owed += dt * 90;
          while (owed >= 1) {
            owed -= 1;
            const tile = tiles[n++ % tiles.length] as Tile;
            const x = tile.col + 0.1 + hash2(n, 1, 8) * 0.8;
            const z = tile.lane + 0.1 + hash2(n, 2, 8) * 0.8;
            velocity.set(0, -5.5, 0);
            this.particles.emit({ position: at.set(x, 2.6, z), velocity, color: C.heal, size: 0.06, life: 0.45, emissive: true, spin: 0 });
          }
        }
        if (!healed && time >= 0.35) {
          healed = true;
          for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i] as Tile;
            this.effects.healPlus(at.set(tile.col + 0.5, 0.5, tile.lane + 0.5));
          }
        }
        return time >= SPELL_SECONDS.healingRain;
      },
      stop: () => {},
    };
  }

  private rockWall(tile: Tile): Job | null {
    const k = tileKey(tile.lane, tile.col);
    if (this.rocksByTile.has(k)) return null;
    const mesh = this.rockPool.take() as Mesh | null;
    if (!mesh) return null;
    mesh.visible = true;
    mesh.geometry = this.rockStages[0] as BufferGeometry;
    mesh.position.set(tile.col + 0.5, 0, tile.lane + 0.5);
    mesh.rotation.y = ((tile.col * 7 + tile.lane) % 4) * 0.3 - 0.45;
    this.effects.dirt(at.set(tile.col + 0.5, 0, tile.lane + 0.5));
    this.effects.burst(at, C.rock, 8, 2.2);
    this.onFeel({ shake: 0.2 });
    const rock = { mesh, stage: 0 as RockStage, job: null as Job | null };
    let time = 0;
    const job: Job = {
      step: (dt) => {
        time += dt;
        // It heaves up out of the ground and settles with a little overshoot.
        const t = time / 0.35;
        mesh.scale.set(1, Math.max(0.001, easeOutBack(t)), 1);
        mesh.position.y = -0.3 * (1 - Math.min(1, t));
        if (time >= SPELL_SECONDS.rockWall) {
          mesh.scale.set(1, 1, 1);
          mesh.position.y = 0;
          return true;
        }
        return false;
      },
      stop: () => {
        rock.job = null;
      },
    };
    rock.job = job;
    this.rocksByTile.set(k, rock);
    return job;
  }

  private meteor(tiles: Tile[]): Job {
    const cx = tiles.reduce((s, t) => s + t.col + 0.5, 0) / Math.max(1, tiles.length);
    const cz = tiles.reduce((s, t) => s + t.lane + 0.5, 0) / Math.max(1, tiles.length);
    const meteor = this.meteors.take();
    if (meteor) meteor.visible = true;
    const FALL = 0.7;
    // In from high over the zombies' side, low enough to stay in the picture all the way.
    const from = new Vector3(cx + 3.6, 4, cz - 1.4);
    let time = 0;
    let landed: Job | null = null;
    return {
      step: (dt) => {
        time += dt;
        if (!landed) {
          const t = Math.min(1, time / FALL);
          const u = t * t;
          if (meteor) {
            meteor.position.set(from.x + (cx - from.x) * u, from.y + (0.3 - from.y) * u, from.z + (cz - from.z) * u);
            meteor.rotation.set(time * 7, time * 4, time * 5);
            meteor.updateMatrixWorld(true);
            this.effects.trail(meteor, C.fire);
            this.effects.trail(meteor, hex(PALETTE.fireLight));
          }
          if (t >= 1) {
            this.meteors.give(meteor);
            this.effects.explosion(at.set(cx, 0, cz), 1.3);
            this.onFeel({ shake: 0.9, hitStop: 0.06 });
            const scorches: Job[] = [];
            for (let i = 0; i < tiles.length; i++) scorches.push(this.scorch(tiles[i] as Tile, SPELL_SECONDS.meteor - FALL));
            landed = this.all(scorches);
          }
          return false;
        }
        return landed.step(dt);
      },
      stop: () => {
        landed?.stop();
        if (meteor?.visible) this.meteors.give(meteor);
      },
    };
  }

  private fogBank(tiles: Tile[]): Job {
    const seconds = SPELL_SECONDS.fog;
    const blocks: { o: Object3D; x: number; y: number; z: number; delay: number; drift: number }[] = [];
    tiles.forEach((tile, t) => {
      for (let i = 0; i < FOG_PER_TILE; i++) {
        const o = this.fog.take();
        if (!o) continue;
        // Blocks heaped in two layers over the tile, the lower ones bigger, offset per tile.
        const x = tile.col + 0.2 + hash2(i, t * 3 + tile.col, 21) * 0.6;
        const z = tile.lane + 0.2 + hash2(t + tile.lane, i, 22) * 0.6;
        const y = i < 4 ? 0.3 + hash2(i, t, 23) * 0.2 : 0.65 + hash2(i, t, 24) * 0.25;
        o.visible = true;
        blocks.push({ o, x, y, z, delay: t * 0.06 + i * 0.03, drift: hash2(i, t, 25) * 6 });
      }
      this.effects.puff(at.set(tile.col + 0.5, 0.4, tile.lane + 0.5));
    });
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i] as (typeof blocks)[number];
          const grow = easeOutBack((time - b.delay) / 0.4);
          const fade = Math.min(1, Math.max(0, (seconds - time - b.delay * 0.5) / 0.4));
          const s = Math.max(0.001, Math.min(grow, fade)) * (b.y < 0.6 ? 1.15 : 0.9);
          b.o.scale.setScalar(s);
          // Rolling slowly to and fro, in whole voxel steps.
          const roll = Math.round(Math.sin(time * 0.9 + b.drift) * 2) / 32;
          b.o.position.set(b.x + roll, b.y + Math.round(Math.sin(time * 1.3 + b.drift) * 1) / 32, b.z);
        }
        return time >= seconds;
      },
      stop: () => {
        for (let i = 0; i < blocks.length; i++) this.fog.give((blocks[i] as (typeof blocks)[number]).o);
      },
    };
  }

  private frenzy(tiles: Tile[]): Job {
    const cx = tiles.reduce((s, t) => s + t.col + 0.5, 0) / Math.max(1, tiles.length);
    const cz = tiles.reduce((s, t) => s + t.lane + 0.5, 0) / Math.max(1, tiles.length);
    this.effects.ring(at.set(cx, 0, cz), hex(PALETTE.speedRed), 1.6, true);
    let time = 0;
    let owed = 0;
    let n = 0;
    let second = false;
    return {
      step: (dt) => {
        time += dt;
        if (!second && time >= 0.25) {
          second = true;
          this.effects.ring(at.set(cx, 0, cz), hex(PALETTE.speedRed), 1.2, true);
        }
        // Red speed sparks dash across the area towards the plants.
        if (time < 0.7 && tiles.length) {
          owed += dt * 70;
          while (owed >= 1) {
            owed -= 1;
            const tile = tiles[n++ % tiles.length] as Tile;
            velocity.set(-3.5 - hash2(n, 3, 2) * 2, 0.4, 0);
            this.particles.emit({
              position: at.set(tile.col + 0.9, 0.15 + hash2(n, 4, 2) * 0.7, tile.lane + 0.15 + hash2(n, 5, 2) * 0.7),
              velocity,
              color: C.red[n % 3] as number,
              size: 0.06,
              life: 0.3,
              emissive: true,
              spin: 0,
            });
          }
        }
        return time >= SPELL_SECONDS.frenzy;
      },
      stop: () => {},
    };
  }

  private graveRise(tile: Tile): Job {
    const x = tile.col + 0.5;
    const z = tile.lane + 0.5;
    const stones: { o: Object3D | null; dx: number; dz: number; delay: number; burst: boolean }[] = [
      { o: this.graves.take(), dx: -0.28, dz: -0.12, delay: 0, burst: false },
      { o: this.graves.take(), dx: 0.02, dz: 0.14, delay: 0.08, burst: false },
      { o: this.graves.take(), dx: 0.3, dz: -0.06, delay: 0.16, burst: false },
    ];
    for (const s of stones) if (s.o) s.o.visible = true;
    this.effects.dirt(at.set(x, 0, z));
    this.onFeel({ shake: 0.2 });
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        for (let i = 0; i < stones.length; i++) {
          const s = stones[i] as (typeof stones)[number];
          const t = time - s.delay;
          if (!s.o) continue;
          // Up out of the soil, a wobble, then each bursts into stone as its minion claws up.
          const rise = Math.min(1, Math.max(0, t / 0.25));
          s.o.position.set(x + s.dx, -GRAVESTONE_HEIGHT * (1 - easeOutBack(rise)), z + s.dz);
          s.o.rotation.z = Math.sin(t * 30) * 0.06 * Math.min(1, Math.max(0, t - 0.25) * 4);
          if (!s.burst && t >= 0.75) {
            s.burst = true;
            this.effects.debris(at.set(x + s.dx, 0.25, z + s.dz), C.stone, 2);
            this.effects.dirt(at.set(x + s.dx, 0, z + s.dz));
            this.graves.give(s.o);
            s.o = null;
          }
        }
        return time >= SPELL_SECONDS.graveRise;
      },
      stop: () => {
        for (let i = 0; i < stones.length; i++) this.graves.give((stones[i] as (typeof stones)[number]).o);
      },
    };
  }
}

function tileKey(lane: number, col: number): number {
  return Math.floor(lane) * 100 + Math.floor(col);
}
