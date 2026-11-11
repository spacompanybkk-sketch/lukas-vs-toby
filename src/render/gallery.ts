import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import type { FrameBox } from './CameraRig';
import { worldToClient } from './coords';
import { MATTE_PLASTIC } from './look';
import { getModelDef, modelKeys } from './models/registry';
import { PALETTE } from './palette';
import { Renderer, type Quality } from './Renderer';
import { VOXEL, disposeModels, modelStats } from './voxel/build';
import { LEVEL_SCALE, MAX_LEVEL } from './voxel/palette';
import { ModelInstance } from './voxel/rig';
import type { ClipName } from './voxel/types';
import { BoxBatch } from './world/boxes';
import { Lawn } from './world/Lawn';
import { Sky } from './world/Sky';

// The model gallery: every registered model at every level, under the lawn's own lights,
// for judging characters by eye and for the screenshot tool.
//
//   ?scene=gallery                 every model, five levels to a row, at about lawn size
//   &page=<n>                      the overview holds ten models; this shows the next ten
//   &model=<key>                   one model's row, larger
//   &models=<key,key,…>            only these models, laid out as the overview
//   &level=<1-5>                   only that level
//   &clip=<name>&t=<seconds>       every model frozen at that time of that clip
//   &clip=<name>                   every model playing that clip (one-shots repeat)
//   &t=<seconds>                   idle, frozen
//   &pitch=<deg>&yaw=<deg>         camera angle (default 52 and 0, the lawn's)
//   &stage=lawn                    stand them on the real lawn instead of pads
//   &crowd=<n>                     n units on the lawn, to see what a full battle costs
//   &flash=<0-1>                   white flash amount
//   &labels=0                      no labels
//   &portrait=1                    no pads, labels or clouds, framed on the unit's envelope: a card portrait
//   &quality=low|medium|high

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const CLIPS: readonly ClipName[] = ['idle', 'walk', 'shoot', 'melee', 'hit', 'spawn', 'die', 'cheer'];

/**
 * Tiles between neighbouring levels; the depth a row is framed with; the step from one row to
 * the next; and the gap between the two models that share a row. The step and the gap leave
 * room for the labels, so that a name or a level never touches a neighbouring pad.
 */
const CELL = 1.25;
const ROW = 1.7;
const ROW_STEP = 1.9;
const GROUP_GAP = 1.6;
const GROUPS_PER_ROW = 2;
/** The layout is centred on the middle of the lawn, where the sun's shadow map reaches. */
const CENTRE_X = 5;
const CENTRE_Z = 2.5;
/** The overview never frames less than this, so a lone model still shows at about lawn size. */
const OVERVIEW_WIDTH = 2 * MAX_LEVEL * CELL + GROUP_GAP;
const OVERVIEW_DEPTH = 3 * ROW;
/**
 * Models in one overview. Five rows of two are as many as stand inside the box the sun's
 * shadow map covers; more go on further pages.
 */
export const PAGE_SIZE = 10;
/** The size a level-1 unit fits (art bible section 1), in voxels, unless a model names its own. */
const UNIT_ENVELOPE: [number, number, number] = [12, 16, 10];
/** Room above the ground for the tallest model, jumping. */
const HEADROOM = 1.7;
/** Seconds between repeats of a one-shot clip that is being watched. */
const REPLAY_PAUSE = 0.7;
/** Frames drawn before the scene reports ready, so shadows, reflections and post buffers are filled. */
const WARM_UP_FRAMES = 6;

export interface GalleryCell {
  key: string;
  level: number;
  x: number;
  z: number;
}

/** The models on page `page` (from 1) of the overview, and how many pages there are. */
export function galleryPage(keys: readonly string[], page: number): { keys: string[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
  const shown = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { keys: keys.slice((shown - 1) * PAGE_SIZE, shown * PAGE_SIZE), page: shown, pages };
}

/**
 * Where each model stands: one row per model (two rows side by side), levels left to right.
 * Give it one page of models at most, or the rows run out of the sun's shadow.
 */
export function galleryLayout(keys: readonly string[], levels: readonly number[]): { cells: GalleryCell[]; box: FrameBox } {
  const groups = Math.min(GROUPS_PER_ROW, Math.max(1, keys.length));
  const rows = Math.ceil(keys.length / groups);
  const groupWidth = levels.length * CELL;
  const width = groups * groupWidth + (groups - 1) * GROUP_GAP;
  const cells: GalleryCell[] = [];
  keys.forEach((key, index) => {
    const left = CENTRE_X - width / 2 + (index % groups) * (groupWidth + GROUP_GAP);
    const z = CENTRE_Z + (Math.floor(index / groups) - (rows - 1) / 2) * ROW_STEP;
    levels.forEach((level, i) => cells.push({ key, level, x: left + (i + 0.5) * CELL, z }));
  });
  const depth = ROW + Math.max(0, rows - 1) * ROW_STEP;
  return {
    cells,
    box: {
      x: [CENTRE_X - width / 2, CENTRE_X + width / 2],
      y: [0, HEADROOM],
      z: [CENTRE_Z - depth / 2 + 0.2, CENTRE_Z + depth / 2 - 0.2],
    },
  };
}

/**
 * Where models stand on the real lawn: a lane per model with its levels along the columns,
 * or, for a crowd of `crowd` units, the lawn filled tile by tile and then a second and third
 * unit on each tile, a little to one side.
 */
function lawnLayout(keys: readonly string[], levels: readonly number[], crowd: number): GalleryCell[] {
  if (crowd > 0) {
    return Array.from({ length: crowd }, (_, i) => {
      const layer = Math.floor(i / 50) % 3;
      return {
        key: keys[i % keys.length] as string,
        level: levels[i % levels.length] as number,
        x: (i % 10) + 0.4 + 0.2 * layer,
        z: (Math.floor(i / 10) % 5) + 0.6 - 0.15 * layer,
      };
    });
  }
  return keys.flatMap((key, index) => levels.map((level, i) => ({ key, level, x: i + 1.5, z: ((2 + index) % 5) + 0.5 })));
}

/** The box that holds every cell, with room around each model. */
function boxAround(cells: readonly GalleryCell[]): FrameBox {
  const xs = cells.map((cell) => cell.x);
  const zs = cells.map((cell) => cell.z);
  return { x: [Math.min(...xs) - 0.7, Math.max(...xs) + 0.7], y: [0, HEADROOM], z: [Math.min(...zs) - 0.6, Math.max(...zs) + 0.6] };
}

/**
 * The box a card portrait frames: each unit's envelope at its level's size, not what the
 * model happens to reach. A higher level then fills more of its card, because what it has
 * gained stands out past the envelope.
 */
function envelopeAround(cells: readonly GalleryCell[]): FrameBox {
  const box = { x: [Infinity, -Infinity], y: [0, 0], z: [Infinity, -Infinity] } as { x: [number, number]; y: [number, number]; z: [number, number] };
  for (const cell of cells) {
    const [wide, tall, deep] = getModelDef(cell.key).envelope ?? UNIT_ENVELOPE;
    const size = VOXEL * (LEVEL_SCALE[cell.level] as number);
    box.x = [Math.min(box.x[0], cell.x - (wide / 2) * size), Math.max(box.x[1], cell.x + (wide / 2) * size)];
    box.y = [0, Math.max(box.y[1], tall * size)];
    box.z = [Math.min(box.z[0], cell.z - (deep / 2) * size), Math.max(box.z[1], cell.z + (deep / 2) * size)];
  }
  return box;
}

/** A grass-topped block of soil under each model. */
function buildPads(cells: readonly GalleryCell[]): Mesh {
  const batch = new BoxBatch();
  cells.forEach((cell, i) => {
    const top = i % 2 === 0 ? PALETTE.grassLight : PALETTE.grassDark;
    batch.boxOn(cell.x, -0.2, cell.z, 1.02, 0.14, 1.02, PALETTE.soilDark, PALETTE.soil);
    batch.boxOn(cell.x, -0.06, cell.z, 1.1, 0.06, 1.1, PALETTE.rimGrass, top);
  });
  const mesh = new Mesh(batch.build(), new MeshStandardMaterial(MATTE_PLASTIC));
  mesh.name = 'pads';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const LABEL_STYLE = [
  'position:absolute',
  'left:0',
  'top:0',
  'padding:1px 9px 2px',
  'border:2px solid #2A1B0E',
  'border-radius:10px',
  'background:#FFF3D6',
  'color:#2A1B0E',
  'font:400 13px/1.3 var(--font-display)',
  'white-space:nowrap',
  'will-change:transform',
].join(';');

function number(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Mounts the gallery on `canvas`. Returns a function that stops it and frees everything it made. */
export function mount(canvas: HTMLCanvasElement, params: URLSearchParams): () => void {
  const only = params.get('model');
  const crowd = Math.max(0, Math.floor(number(params, 'crowd') ?? 0));
  const listed = params.get('models')?.split(',').filter((key) => key !== '').map((key) => getModelDef(key).key);
  const paged = galleryPage(listed ?? modelKeys(), number(params, 'page') ?? 1);
  // One model, or a crowd drawn from all of them, or one page of the overview.
  const keys = only ? [getModelDef(only).key] : crowd > 0 ? modelKeys() : paged.keys;
  const level = number(params, 'level');
  const levels = level !== null && level >= 1 && level <= MAX_LEVEL ? [Math.floor(level)] : [1, 2, 3, 4, 5];
  const onLawn = params.get('stage') === 'lawn' || crowd > 0;
  const portrait = params.get('portrait') === '1';
  const pitch = number(params, 'pitch');
  const yaw = number(params, 'yaw');
  /** The camera angle asked for (the lawn's own where nothing was), with room left for the labels. */
  const view = { pitchDeg: pitch ?? undefined, yawDeg: yaw ?? undefined, side: 0.04, top: 0.06, bottom: 0.12 };

  const asked = params.get('quality') as Quality | null;
  const renderer = new Renderer(canvas, asked && QUALITIES.includes(asked) ? asked : 'high');
  const sky = new Sky();
  renderer.scene.add(sky.group);
  // A card has plain sky behind the unit.
  if (portrait) for (const child of sky.group.children) if (child.name === 'cloud') child.visible = false;

  // Where everything stands.
  let cells: GalleryCell[];
  let lawn: Lawn | null = null;
  let pads: Mesh | null = null;
  if (onLawn) {
    cells = lawnLayout(keys, levels, crowd);
    lawn = new Lawn();
    renderer.scene.add(lawn.group);
    // Left alone, the camera is the game's own. An angle of its own closes in on the models.
    if (pitch !== null || yaw !== null) renderer.rig.frameSubject(boxAround(cells), view);
  } else {
    const layout = galleryLayout(keys, levels);
    cells = layout.cells;
    if (!portrait) {
      pads = buildPads(cells);
      renderer.scene.add(pads);
    }
    let box = layout.box;
    if (!only && level === null) {
      // The overview: wide enough that models show at about the size they have on the lawn.
      const halfWidth = Math.max(box.x[1] - box.x[0], OVERVIEW_WIDTH) / 2;
      const halfDepth = Math.max(box.z[1] - box.z[0], OVERVIEW_DEPTH) / 2;
      box = { x: [CENTRE_X - halfWidth, CENTRE_X + halfWidth], y: box.y, z: [CENTRE_Z - halfDepth, CENTRE_Z + halfDepth] };
    }
    renderer.rig.frameSubject(box, view);
  }

  const instances = cells.map((cell) => {
    const instance = new ModelInstance(getModelDef(cell.key), cell.level);
    instance.root.position.set(cell.x, 0, cell.z);
    renderer.scene.add(instance.root);
    return instance;
  });
  const flash = number(params, 'flash');
  if (flash !== null) for (const instance of instances) instance.setFlash(flash);
  /** Replaces the unit in cell `i` with a new one, standing where it stood. */
  const rebuild = (i: number): ModelInstance => {
    const old = instances[i] as ModelInstance;
    const fresh = new ModelInstance(old.def, old.level);
    fresh.root.position.copy(old.root.position);
    renderer.scene.add(fresh.root);
    if (flash !== null) fresh.setFlash(flash);
    old.dispose();
    instances[i] = fresh;
    return fresh;
  };

  // What they are doing.
  let clip: ClipName | null = null;
  let frozenAt: number | null = null;
  /** For each model, seconds until its one-shot is played again. */
  const replayIn = instances.map(() => 0);
  const pose = (name: string | null, seconds: number | null): void => {
    clip = name !== null && (CLIPS as readonly string[]).includes(name) ? (name as ClipName) : null;
    frozenAt = seconds;
    replayIn.fill(0);
    for (const instance of instances) {
      instance.play(clip ?? 'idle');
      if (frozenAt !== null) instance.seek(frozenAt);
    }
  };
  pose(params.get('clip'), number(params, 't'));

  // A card frames the unit's envelope, with room above for what higher levels wear.
  if (portrait) renderer.rig.frameSubject(envelopeAround(cells), { ...view, side: 0.08, top: 0.16, bottom: 0.05 });

  // Labels, in the UI layer: the level under each model, and each model's name once, at the
  // left of its row. Short, so that neighbours a tile apart do not overlap.
  const ui = document.getElementById('ui');
  const labels = document.createElement('div');
  labels.dataset.gallery = 'labels';
  const tags: { tag: HTMLElement; x: number; z: number; shift: string }[] = [];
  const label = (text: string, kind: string, x: number, z: number, shift: string): void => {
    const tag = document.createElement('div');
    tag.style.cssText = LABEL_STYLE;
    tag.dataset.label = kind;
    tag.textContent = text;
    labels.appendChild(tag);
    tags.push({ tag, x, z, shift });
  };
  if (params.get('labels') !== '0' && !portrait && crowd === 0 && ui) {
    const named = new Set<string>();
    for (const cell of cells) {
      label(`L${cell.level}`, 'level', cell.x, cell.z + 0.56, '-50%, 0');
      if (named.has(cell.key)) continue;
      named.add(cell.key);
      label(cell.key, 'name', cell.x - 0.62, cell.z, '-100%, -50%');
    }
    if (!only && paged.pages > 1) label(`page ${paged.page} of ${paged.pages}`, 'page', CENTRE_X, CENTRE_Z + OVERVIEW_DEPTH / 2 + 1.2, '-50%, 0');
  }
  ui?.appendChild(labels);
  const anchor = new Vector3();
  let labelledFor = '';
  const placeLabels = (): void => {
    const camera = renderer.camera;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    // Only when the picture has changed: the camera here moves on a resize and not otherwise.
    const state = `${width}x${height}:${camera.position.x},${camera.position.y},${camera.position.z}`;
    if (state === labelledFor) return;
    labelledFor = state;
    for (const { tag, x, z, shift } of tags) {
      const at = worldToClient(anchor.set(x, onLawn ? 0 : -0.2, z), camera, { width, height });
      tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y) + 4}px) translate(${shift})`;
    }
  };

  const lvt = installDebug();
  lvt.renderer = renderer;
  if (lawn) lvt.lawn = lawn;
  const debug = {
    instances,
    /** Plays `clip` on every model (null for idle), frozen at `seconds` unless that is null. */
    pose,
    /** What each model on show costs to draw. */
    stats: cells.map((cell) => ({ key: cell.key, level: cell.level, ...modelStats(getModelDef(cell.key), cell.level) })),
  };
  lvt.gallery = debug;

  let time = 0;
  let frames = 0;
  const loop = new GameLoop({
    step() {},
    frame(_alpha, realDt, gameDt) {
      const frozen = frozenAt !== null;
      if (!frozen) {
        time += gameDt;
        // A one-shot that is being watched starts again after a pause, each model on its
        // own clip's time.
        instances.forEach((instance, i) => {
          const own = clip ? instance.def.clips[clip] : undefined;
          if (!own || own.loop) return;
          replayIn[i] = (replayIn[i] as number) - gameDt;
          if ((replayIn[i] as number) > 0) return;
          replayIn[i] = own.duration + REPLAY_PAUSE;
          // A unit that has died plays nothing more, so to watch it die again it is built afresh.
          const fresh = clip === 'die' && instance.clip === 'die' ? rebuild(i) : instance;
          fresh.play(clip as ClipName);
        });
      }
      for (const instance of instances) instance.update(frozen ? 0 : gameDt);
      lawn?.update(time);
      sky.update(time);
      renderer.render(frozen ? 0 : realDt);
      placeLabels();
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });

  const onResize = (): void => renderer.resize();
  window.addEventListener('resize', onResize);
  loop.start();

  return () => {
    loop.stop();
    window.removeEventListener('resize', onResize);
    labels.remove();
    for (const instance of instances) instance.dispose();
    renderer.scene.remove(sky.group);
    sky.dispose();
    if (lawn) {
      renderer.scene.remove(lawn.group);
      lawn.dispose();
    }
    if (pads) {
      renderer.scene.remove(pads);
      pads.geometry.dispose();
      (pads.material as MeshStandardMaterial).dispose();
    }
    disposeModels();
    renderer.dispose();
    if (lvt.renderer === renderer) delete lvt.renderer;
    if (lawn && lvt.lawn === lawn) delete lvt.lawn;
    if (lvt.gallery === debug) delete lvt.gallery;
  };
}
