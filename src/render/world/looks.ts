import type { BufferGeometry } from 'three';
import type { WorldKey } from '../../data/worlds';
import { WORLDS } from '../../data/worlds';
import { PALETTE } from '../palette';
import type { BoxBatch } from './boxes';
import { bush, buildProps, flower, gravestone, bone } from './props';
import { buildMeadowProps, meadowIslet } from './worldProps';

// The look of each Adventure world (art bible: a bright toy diorama; Michal: boxy, hard-edged,
// pixelated). A look is data the island, grass, props, sky, lights and grade are built from;
// the Backyard's values are the palette's own, so the Backyard draws exactly as it always has.

/** The ground of the island: the lawn's two strips, the rim round them, soil and rock. */
export interface Ground {
  /** The plants' columns (0–7), a checker of two tones. */
  grassLight: string;
  grassDark: string;
  /** The zombies' strip (columns 8–9), a checker of two tones. */
  graveLight: string;
  graveDark: string;
  /** The ground round the lawn at each end. */
  rimGrass: string;
  rimGrave: string;
  /** The turf lip along the island's edge on the plants' end. */
  lip: string;
  soil: string;
  soilDark: string;
  graveSoil: string;
  islandRock: string;
  graveRock: string;
}

/** The tufts on the lawn and rim: `base` most, a little paler, `dark` darker, `light` now and then. */
export interface Tufts {
  base: string;
  dark: string;
  light: string;
}

/** Sky colours as they should appear on screen (see `Sky`). */
export interface SkyLook {
  top: string;
  horizon: string;
  haze: string;
  deep: string;
  cloud: string;
  cloudSide: string;
  cloudUnder: string;
  cloudFar: string;
  /** Pixel stars over the dome, 0 none to 1 many. */
  stars: number;
  /** A voxel moon in the sky behind the island. */
  moon: boolean;
}

/** The three lights of art bible section 4, per world. */
export interface Lights {
  sun: string;
  sunIntensity: number;
  fillSky: string;
  fillGround: string;
  fillIntensity: number;
  bounce: string;
  bounceIntensity: number;
}

/** The colour grade after the filmic curve. */
export interface Grade {
  saturation: number;
  contrast: number;
  brightness: number;
  vignette: number;
}

export interface Look {
  key: WorldKey;
  ground: Ground;
  tufts: Tufts;
  sky: SkyLook;
  lights: Lights;
  grade: Grade;
  /** Shown only by scenes that add no sky of their own. */
  backdrop: string;
  /** Emissive colour and strength of the props' glowing parts (the Backyard's crystals). */
  glow: { color: string; intensity: number };
  /** Everything standing on the island: matte `solid`, emissive `glow`. */
  props: () => { solid: BufferGeometry; glow: BufferGeometry };
  /** What stands on a small islet adrift beside the island (`grave`: one off the zombies' end). */
  islet: (batch: BoxBatch, grave: boolean, random: () => number) => void;
  weather: (typeof WORLDS)[WorldKey]['weather'];
}

const BACKYARD: Look = {
  key: 'backyard',
  ground: {
    grassLight: PALETTE.grassLight,
    grassDark: PALETTE.grassDark,
    graveLight: PALETTE.graveLight,
    graveDark: PALETTE.graveDark,
    rimGrass: PALETTE.rimGrass,
    rimGrave: PALETTE.rimGrave,
    lip: PALETTE.leafDark,
    soil: PALETTE.soil,
    soilDark: PALETTE.soilDark,
    graveSoil: PALETTE.graveSoil,
    islandRock: PALETTE.islandRock,
    graveRock: PALETTE.graveRock,
  },
  tufts: { base: PALETTE.leaf, dark: PALETTE.grassDark, light: PALETTE.leafLight },
  sky: {
    top: PALETTE.skyTop,
    horizon: PALETTE.skyHorizon,
    haze: PALETTE.skyHaze,
    deep: PALETTE.skyDeep,
    cloud: PALETTE.cloud,
    cloudSide: PALETTE.cloudSide,
    cloudUnder: PALETTE.cloudUnder,
    cloudFar: PALETTE.cloudFar,
    stars: 0,
    moon: false,
  },
  lights: {
    sun: PALETTE.sunLight,
    sunIntensity: 1.5,
    fillSky: PALETTE.fillSky,
    fillGround: PALETTE.fillGround,
    fillIntensity: 0.85,
    bounce: PALETTE.bounceLight,
    bounceIntensity: 1,
  },
  grade: { saturation: 0.1, contrast: 0.04, brightness: 0, vignette: 0.34 },
  backdrop: PALETTE.skyBackdrop,
  glow: { color: PALETTE.crystalGlow, intensity: 5 },
  props: buildProps,
  islet(batch, grave, random) {
    if (grave) {
      gravestone(batch, -0.1, 0, 0.42, 0.2, 0.1);
      bone(batch, 0.4, 0.35, 0.8, 1.3);
    } else {
      bush(batch, -0.15, -0.1, 0.9, random);
      flower(batch, 0.45, 0.3, PALETTE.petal, 1.6);
      flower(batch, 0.25, 0.42, PALETTE.bone, 1.4);
    }
  },
  weather: WORLDS.backyard.weather,
};

/** The Meadow at night: blue-green grass under a moon, stars, fireflies and glowing mushrooms. */
const MEADOW: Look = {
  key: 'meadow',
  ground: {
    grassLight: '#4C8A7E',
    grassDark: '#3E786E',
    graveLight: '#4A3F78',
    graveDark: '#3D3366',
    rimGrass: '#3A6E68',
    rimGrave: '#382E5E',
    lip: '#2E5E58',
    soil: '#5A4A68',
    soilDark: '#463954',
    graveSoil: '#3A2F52',
    islandRock: '#56607E',
    graveRock: '#4A456A',
  },
  tufts: { base: '#4C9480', dark: '#2F6A62', light: '#7EC4AA' },
  sky: {
    top: '#22357A',
    horizon: '#6A7FC4',
    haze: '#3C519C',
    deep: '#1B2A66',
    cloud: '#6E80BC',
    cloudSide: '#55679F',
    cloudUnder: '#46578E',
    cloudFar: '#34478A',
    stars: 0.6,
    moon: true,
  },
  lights: {
    sun: '#D6E0FF',
    sunIntensity: 1.35,
    fillSky: '#8EA6FF',
    fillGround: '#3F8676',
    fillIntensity: 0.9,
    bounce: '#B4C4FF',
    bounceIntensity: 0.95,
  },
  grade: { saturation: 0.12, contrast: 0.05, brightness: -0.01, vignette: 0.42 },
  backdrop: '#33468E',
  glow: { color: '#7FE6FF', intensity: 3.2 },
  props: buildMeadowProps,
  islet: meadowIslet,
  weather: WORLDS.meadow.weather,
};

/** Every world's look. */
export const LOOKS: Record<WorldKey, Look> = {
  backyard: BACKYARD,
  meadow: MEADOW,
  desert: { ...BACKYARD, key: 'desert', weather: WORLDS.desert.weather },
  tundra: { ...BACKYARD, key: 'tundra', weather: WORLDS.tundra.weather },
  citadel: { ...BACKYARD, key: 'citadel', weather: WORLDS.citadel.weather },
};
