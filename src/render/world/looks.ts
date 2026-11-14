import type { BufferGeometry } from 'three';
import type { WorldKey } from '../../data/worlds';
import { WORLDS } from '../../data/worlds';
import { PALETTE } from '../palette';
import { MARKS_BACKYARD, type MarksLook } from './PlaceMarks';
import type { BoxBatch } from './boxes';
import { bush, buildProps, flower, gravestone, bone } from './props';
import {
  buildCitadelProps,
  buildDesertProps,
  buildMeadowProps,
  buildTundraProps,
  citadelIslet,
  desertIslet,
  meadowIslet,
  tundraIslet,
} from './worldProps';

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
  /**
   * Bloom on the glowing parts: strength and spread. The Meadow keeps both low so its moon and
   * fireflies read as hard pixels with a tight glow rather than soft round halos.
   */
  bloom: { intensity: number; radius: number };
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
  /** The place marks' colours on this ground. */
  marks: MarksLook;
}

/** The bloom every world but the Meadow has (the Backyard's, as it always was). */
const BLOOM = { intensity: 0.9, radius: 0.7 };

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
  grade: { saturation: 0.1, contrast: 0.04, brightness: 0, vignette: 0.34, bloom: BLOOM },
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
  marks: MARKS_BACKYARD,
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
  grade: { saturation: 0.12, contrast: 0.05, brightness: -0.01, vignette: 0.42, bloom: { intensity: 0.55, radius: 0.32 } },
  backdrop: '#33468E',
  glow: { color: '#7FE6FF', intensity: 3.2 },
  props: buildMeadowProps,
  islet: meadowIslet,
  weather: WORLDS.meadow.weather,
  marks: MARKS_BACKYARD,
};

/** The Desert: warm sand under a hot sky, orange mesas, cacti, blown dust. */
const DESERT: Look = {
  key: 'desert',
  ground: {
    grassLight: '#D8A862',
    grassDark: '#C79552',
    graveLight: '#946A7E',
    graveDark: '#7E586C',
    rimGrass: '#CC9C5A',
    rimGrave: '#82606F',
    lip: '#B88444',
    soil: '#C98A4C',
    soilDark: '#A86C38',
    graveSoil: '#6E4F5E',
    islandRock: '#C27040',
    graveRock: '#7C5A68',
  },
  tufts: { base: '#B4AC5C', dark: '#8E8844', light: '#D6CE86' },
  sky: {
    top: '#6EC0EE',
    horizon: '#FFE4B6',
    haze: '#F4CC96',
    deep: '#5CB0E8',
    cloud: '#FFF8EC',
    cloudSide: '#F2DCC0',
    cloudUnder: '#E8C8A4',
    cloudFar: '#F0D2A8',
    stars: 0,
    moon: false,
  },
  lights: {
    sun: '#FFE6BE',
    sunIntensity: 1.3,
    fillSky: '#FFE2BE',
    fillGround: '#C79552',
    fillIntensity: 0.75,
    bounce: '#FFEAD2',
    bounceIntensity: 0.95,
  },
  grade: { saturation: 0.12, contrast: 0.08, brightness: -0.02, vignette: 0.38, bloom: BLOOM },
  backdrop: '#F4CC96',
  glow: { color: '#FFB23F', intensity: 3 },
  props: buildDesertProps,
  islet: desertIslet,
  weather: WORLDS.desert.weather,
  marks: MARKS_BACKYARD,
};

/** The Tundra: snow in white and pale blue under a cold sky, pines, ice shards, snowfall. */
const TUNDRA: Look = {
  key: 'tundra',
  ground: {
    grassLight: '#D4E2EE',
    grassDark: '#BFD2E2',
    graveLight: '#7A78A8',
    graveDark: '#686594',
    rimGrass: '#DCE8F2',
    rimGrave: '#73709E',
    lip: '#B4CADC',
    soil: '#8A96B0',
    soilDark: '#6E7A96',
    graveSoil: '#5C5880',
    islandRock: '#7E8AA6',
    graveRock: '#605C86',
  },
  tufts: { base: '#9EBCBE', dark: '#789A9E', light: '#D8ECEE' },
  sky: {
    top: '#86C4EC',
    horizon: '#EAF6FF',
    haze: '#BEE0F6',
    deep: '#74B6E6',
    cloud: '#FFFFFF',
    cloudSide: '#D2E4F4',
    cloudUnder: '#BCD6EE',
    cloudFar: '#A6CCEC',
    stars: 0,
    moon: false,
  },
  lights: {
    sun: '#F4F8FF',
    sunIntensity: 1.15,
    fillSky: '#D2E8FF',
    fillGround: '#BFD2E2',
    fillIntensity: 0.75,
    bounce: '#DCEBFF',
    bounceIntensity: 0.9,
  },
  grade: { saturation: 0.14, contrast: 0.07, brightness: -0.02, vignette: 0.36, bloom: BLOOM },
  backdrop: '#BEE0F6',
  glow: { color: '#8FE4FF', intensity: 2.6 },
  props: buildTundraProps,
  islet: tundraIslet,
  weather: WORLDS.tundra.weather,
  // White brackets vanish on the snow: dark navy ones, inked white so they still show on the ice.
  marks: { line: '#14305C', lineGain: 1, ink: '#F4FAFF', gamma: 1.2 },
};

/** The Citadel, Toby's home: dark stone under a smouldering sky, lava glow and embers. */
const CITADEL: Look = {
  key: 'citadel',
  ground: {
    grassLight: '#7A7488',
    grassDark: '#6A6478',
    graveLight: '#55446E',
    graveDark: '#48395E',
    rimGrass: '#5E586C',
    rimGrave: '#43365A',
    lip: '#4C465A',
    soil: '#3E3646',
    soilDark: '#302A38',
    graveSoil: '#33293F',
    islandRock: '#4C4456',
    graveRock: '#3C3248',
  },
  tufts: { base: '#7C7660', dark: '#5E5A4C', light: '#9A9276' },
  sky: {
    top: '#4A2448',
    horizon: '#D8643E',
    haze: '#8E3A48',
    deep: '#341A3C',
    cloud: '#9A7682',
    cloudSide: '#78566A',
    cloudUnder: '#5C3C52',
    cloudFar: '#6A3448',
    stars: 0,
    moon: false,
  },
  lights: {
    sun: '#FFD8BC',
    sunIntensity: 1.4,
    fillSky: '#B896D0',
    fillGround: '#FF8A4A',
    fillIntensity: 0.85,
    bounce: '#FFC0A0',
    bounceIntensity: 0.95,
  },
  grade: { saturation: 0.12, contrast: 0.07, brightness: -0.01, vignette: 0.44, bloom: BLOOM },
  backdrop: '#8E3A48',
  glow: { color: '#FF5A12', intensity: 2.2 },
  props: buildCitadelProps,
  islet: citadelIslet,
  weather: WORLDS.citadel.weather,
  marks: MARKS_BACKYARD,
};

/** Every world's look. */
export const LOOKS: Record<WorldKey, Look> = {
  backyard: BACKYARD,
  meadow: MEADOW,
  desert: DESERT,
  tundra: TUNDRA,
  citadel: CITADEL,
};
