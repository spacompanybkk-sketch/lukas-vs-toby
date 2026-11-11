import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import type { FrameBox } from './CameraRig';
import { worldToClient } from './coords';
import { MATTE_PLASTIC } from './look';
import { getModelDef, modelKeys } from './models/registry';
import { PALETTE } from './palette';
import { Renderer, type Quality } from './Renderer';
import { disposeModels, modelStats } from './voxel/build';
import { MAX_LEVEL } from './voxel/palette';
import { ModelInstance } from './voxel/rig';
import type { ClipName } from './voxel/types';
import { BoxBatch } from './world/boxes';
import { Lawn } from './world/Lawn';
import { Sky } from './world/Sky';

// The model gallery: every registered model at every level, under the lawn's own lights,
// for judging characters by eye and for the screenshot tool.
//
//   ?scene=gallery                 every model, five levels to a row, at about lawn size
//   &model=<key>                   one model's row, larger
//   &level=<1-5>                   only that level
//   &clip=<name>&t=<seconds>       every model frozen at that time of that clip
//   &clip=<name>                   every model playing that clip (one-shots repeat)
//   &t=<seconds>                   idle, frozen
//   &pitch=<deg>&yaw=<deg>         camera angle (default 52 and 0, the lawn's)
//   &stage=lawn                    stand them on the real lawn instead of pads
//   &crowd=<n>                     n units on the lawn, to see what a full battle costs
//   &flash=<0-1>                   white flash amount
//   &labels=0                      no labels
//   &portrait=1                    no pads or labels, framed tightly: a card portrait
//   &quality=low|medium|high

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const CLIPS: readonly ClipName[] = ['idle', 'walk', 'shoot', 'melee', 'hit', 'spawn', 'die', 'cheer'];

/** Tiles between neighbouring levels, between rows, and between the two models that share a row. */
const CELL = 1.25;
const ROW = 1.7;
const GROUP_GAP = 0.6;
const GROUPS_PER_ROW = 2;
/** The layout is centred on the middle of the lawn, where the sun's shadow map reaches. */
const CENTRE_X = 5;
const CENTRE_Z = 2.5;
/** The overview never frames less than this, so a lone model still shows at about lawn size. */
const OVERVIEW_WIDTH = 2 * MAX_LEVEL * CELL + GROUP_GAP;
const OVERVIEW_DEPTH = 3 * ROW;
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

/** Where each model stands: one row per model (two rows side by side), levels left to right. */
export function galleryLayout(keys: readonly string[], levels: readonly number[]): { cells: GalleryCell[]; box: FrameBox } {
  const groups = Math.min(GROUPS_PER_ROW, Math.max(1, keys.length));
  const rows = Math.ceil(keys.length / groups);
  const groupWidth = levels.length * CELL;
  const width = groups * groupWidth + (groups - 1) * GROUP_GAP;
  const cells: GalleryCell[] = [];
  keys.forEach((key, index) => {
    const left = CENTRE_X - width / 2 + (index % groups) * (groupWidth + GROUP_GAP);
    const z = CENTRE_Z + (Math.floor(index / groups) - (rows - 1) / 2) * ROW;
    levels.forEach((level, i) => cells.push({ key, level, x: left + (i + 0.5) * CELL, z }));
  });
  const depth = Math.max(1, rows) * ROW;
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
  const keys = only ? [getModelDef(only).key] : modelKeys();
  const level = number(params, 'level');
  const levels = level !== null && level >= 1 && level <= MAX_LEVEL ? [Math.floor(level)] : [1, 2, 3, 4, 5];
  const crowd = Math.max(0, Math.floor(number(params, 'crowd') ?? 0));
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

  // What they are doing.
  let clip: ClipName | null = null;
  let frozenAt: number | null = null;
  let replayIn = 0;
  const pose = (name: string | null, seconds: number | null): void => {
    clip = name !== null && (CLIPS as readonly string[]).includes(name) ? (name as ClipName) : null;
    frozenAt = seconds;
    replayIn = 0;
    for (const instance of instances) {
      instance.play(clip ?? 'idle');
      if (frozenAt !== null) instance.seek(frozenAt);
    }
  };
  pose(params.get('clip'), number(params, 't'));

  if (portrait) {
    // Hug the models themselves, as a card portrait would.
    const bounds = new Box3();
    for (const instance of instances) {
      instance.root.updateMatrixWorld(true);
      bounds.expandByObject(instance.root, true);
    }
    renderer.rig.frameSubject(
      { x: [bounds.min.x, bounds.max.x], y: [bounds.min.y, bounds.max.y], z: [bounds.min.z, bounds.max.z] },
      { ...view, side: 0.05, top: 0.05, bottom: 0.05 },
    );
  }

  // Labels, in the UI layer.
  const ui = document.getElementById('ui');
  const labels = document.createElement('div');
  labels.dataset.gallery = 'labels';
  const tags = params.get('labels') === '0' || portrait || crowd > 0 || !ui ? [] : cells.map((cell) => {
    const tag = document.createElement('div');
    tag.style.cssText = LABEL_STYLE;
    tag.textContent = `${cell.key} · L${cell.level}`;
    labels.appendChild(tag);
    return tag;
  });
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
    tags.forEach((tag, i) => {
      const cell = cells[i] as GalleryCell;
      const at = worldToClient(anchor.set(cell.x, onLawn ? 0 : -0.2, cell.z + 0.56), camera, { width, height });
      tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y) + 4}px) translate(-50%, 0)`;
    });
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
        // A one-shot that is being watched starts again after a pause.
        const playing = clip ? getModelDef((cells[0] as GalleryCell).key).clips[clip] : undefined;
        if (playing && !playing.loop) {
          replayIn -= gameDt;
          if (replayIn <= 0) {
            replayIn = playing.duration + REPLAY_PAUSE;
            for (const instance of instances) instance.play(clip as ClipName);
          }
        }
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
