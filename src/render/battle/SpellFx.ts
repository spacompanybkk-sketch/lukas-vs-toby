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
 * The tiles a spell covers when tapped at (`lane`, `col`) with area `size` (plan Task 4b):
 * a 2 × 2 is the tapped tile, the next column towards the enemy and the next lane down,
 * moved back onto the lawn at an edge so it is always four tiles; a 3 × 3 is centred on the
 * tapped tile and clipped. Rock Wall and Grave Rise take the tapped tile alone; Sun Shower
 * and Brain Feast are not aimed and cover none. For drawing only: the simulation decides.
 */
export function spellArea(spell: SpellKey, lane: number, col: number, size: number): Tile[] {
  if (spell === 'sunShower' || spell === 'brainFeast') return [];
  const l = Math.min(LANES - 1, Math.max(0, Math.floor(lane)));
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(col)));
  if (spell === 'rockWall' || spell === 'graveRise' || size < 2) return [{ lane: l, col: c }];
  const out: Tile[] = [];
  if (size === 2) {
    const towards = SPELL_SIDE[spell] === 'plants' ? 1 : -1;
    const c2 = c + towards >= 0 && c + towards < COLS ? c + towards : c - towards;
    const l2 = l + 1 < LANES ? l + 1 : l - 1;
    for (const ll of [l, l2]) for (const cc of [c, c2]) out.push({ lane: ll, col: cc });
    return out;
  }
  for (let ll = l - 1; ll <= l + 1; ll++) {
    for (let cc = c - 1; cc <= c + 1; cc++) if (ll >= 0 && ll < LANES && cc >= 0 && cc < COLS) out.push({ lane: ll, col: cc });
  }
  return out;
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

/** Objects of one kind, built up front and lent out. */
class Pool {
  private readonly free: Object3D[] = [];
  constructor(group: Group, count: number, make: () => Object3D) {
    for (let i = 0; i < count; i++) {
      const o = make();
      o.visible = false;
      group.add(o);
      this.free.push(o);
    }
  }
  take(): Object3D | null {
    return this.free.pop() ?? null;
  }
  give(o: Object3D | null): void {
    if (!o) return;
    o.visible = false;
    o.scale.set(1, 1, 1);
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
  private readonly marks: TileMark[] = [];
  private readonly rockStages: BufferGeometry[];
  private readonly rocksByTile = new Map<number, { mesh: Mesh; stage: RockStage; job: Job | null }>();

  private readonly bolts: Pool;
  private readonly scorches: Pool;
  private readonly vines: Pool;
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
    this.bolts = new Pool(g, 8, () => makeBolt('plants'));
    this.scorches = new Pool(g, 16, () => {
      const m = new Mesh(this.scorchShape, this.scorchMaterial);
      m.name = 'scorch';
      m.receiveShadow = true;
      return m;
    });
    this.vines = new Pool(g, 48, makeVine);
    this.suns = new Pool(g, 12, () => makeToken('sun'));
    this.brains = new Pool(g, 12, () => makeToken('brain'));
    this.rockPool = new Pool(g, 10, () => {
      const m = makeRock(0) as Mesh;
      m.name = 'spell-rock';
      return m;
    });
    this.meteors = new Pool(g, 3, makeMeteor);
    this.fog = new Pool(g, 60, makeFogBlock);
    this.graves = new Pool(g, 9, makeGravestone);
    for (let i = 0; i < 9; i++) {
      const mark = new TileMark('spell-area', 1, 1);
      this.marks.push(mark);
      g.add(mark.mesh);
    }
  }

  /** Spell shows running now (a standing rock is not one). */
  get active(): number {
    return this.jobs.length;
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
    this.marks.forEach((mark, i) => {
      const tile = tiles?.[i];
      if (tile) mark.show(tile.col + 0.5, tile.lane + 0.5, state, side);
      else mark.hide();
    });
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
    for (const mark of this.marks) mark.pulse(p);
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

  /** Frees what this class made; the props' shapes belong to `props.ts`. Take `group` out first. */
  dispose(): void {
    this.clear();
    this.scorchShape.dispose();
    this.scorchMaterial.dispose();
    for (const mark of this.marks) mark.dispose();
    this.group.clear();
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
        return this.shower(this.suns, 0.4, 7.6, PALETTE.sun, '+150');
      case 'healingRain':
        return this.rain(tiles);
      case 'rockWall':
        return this.rockWall(tiles[0] as Tile);
      case 'meteor':
        return this.meteor(tiles);
      case 'fog':
        return this.fogBank(tiles);
      case 'brainFeast':
        return this.shower(this.brains, 4.4, 9.6, PALETTE.brains, '+200');
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
    const done = parts.map(() => false);
    return {
      step: (dt) => {
        parts.forEach((p, i) => {
          if (!done[i] && p.step(dt)) {
            done[i] = true;
            p.stop();
          }
        });
        return done.every(Boolean);
      },
      stop: () => parts.forEach((p, i) => !done[i] && p.stop()),
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
          this.effects.ring(at, hex(PALETTE.stunStars), 0.55);
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
    const placed: { o: Object3D; delay: number; sway: number }[] = [];
    tiles.forEach((tile, t) => {
      for (let i = 0; i < 5; i++) {
        const o = this.vines.take();
        if (!o) continue;
        const dx = (hash2(tile.col * 5 + i, tile.lane, 1) - 0.5) * 0.75;
        const dz = (hash2(tile.lane * 7 + i, tile.col, 2) - 0.5) * 0.7;
        o.visible = true;
        o.position.set(tile.col + 0.5 + dx, 0, tile.lane + 0.5 + dz);
        o.rotation.y = hash2(i, t, 3) * Math.PI * 2;
        placed.push({ o, delay: t * 0.05 + i * 0.04, sway: hash2(i, t, 4) * 6 });
      }
      this.effects.burst(at.set(tile.col + 0.5, 0.1, tile.lane + 0.5), C.leaf, 8, 2);
      this.effects.dirt(at);
    });
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        for (const { o, delay, sway } of placed) {
          const grow = easeOutBack((time - delay) / 0.35);
          const wither = Math.min(1, Math.max(0, (seconds - time) / 0.3));
          const s = Math.max(0.001, Math.min(grow, wither));
          // Taller than they are wide: they spring up, then sway a little.
          o.scale.set(1.3 * s, 1.5 * s, 1.3 * s);
          o.rotation.z = Math.sin(time * 2.4 + sway) * 0.1;
        }
        return time >= seconds;
      },
      stop: () => placed.forEach(({ o }) => this.vines.give(o)),
    };
  }

  /** Tokens falling across columns `x0` to `x1` of every lane: the two income spells. */
  private shower(pool: Pool, x0: number, x1: number, color: string, text: string): Job {
    const drops: { o: Object3D | null; x: number; z: number; delay: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const x = x0 + ((i * 0.618) % 1) * (x1 - x0);
      const z = 0.5 + ((i * 3) % 5);
      drops.push({ o: null, x, z, delay: i * 0.1 });
    }
    this.effects.floatText(at.set((x0 + x1) / 2, 1.4, 2.5), text, color);
    const FALL = 0.55;
    let time = 0;
    return {
      step: (dt) => {
        time += dt;
        for (const d of drops) {
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
      stop: () => drops.forEach((d) => pool.give(d.o)),
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
          for (const tile of tiles) this.effects.healPlus(at.set(tile.col + 0.5, 0.5, tile.lane + 0.5));
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
    const FALL = 0.6;
    const from = new Vector3(cx + 4.5, 6.5, cz - 2.5);
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
            landed = this.all(tiles.map((tile) => this.scorch(tile, SPELL_SECONDS.meteor - FALL)));
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
      for (let i = 0; i < 7; i++) {
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
        for (const b of blocks) {
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
      stop: () => blocks.forEach(({ o }) => this.fog.give(o)),
    };
  }

  private frenzy(tiles: Tile[]): Job {
    const cx = tiles.reduce((s, t) => s + t.col + 0.5, 0) / Math.max(1, tiles.length);
    const cz = tiles.reduce((s, t) => s + t.lane + 0.5, 0) / Math.max(1, tiles.length);
    this.effects.ring(at.set(cx, 0, cz), hex(PALETTE.speedRed), 1.6);
    let time = 0;
    let owed = 0;
    let n = 0;
    let second = false;
    return {
      step: (dt) => {
        time += dt;
        if (!second && time >= 0.25) {
          second = true;
          this.effects.ring(at.set(cx, 0, cz), hex(PALETTE.speedRed), 1.2);
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
        for (const s of stones) {
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
      stop: () => stones.forEach((s) => this.graves.give(s.o)),
    };
  }
}

function tileKey(lane: number, col: number): number {
  return Math.floor(lane) * 100 + Math.floor(col);
}
