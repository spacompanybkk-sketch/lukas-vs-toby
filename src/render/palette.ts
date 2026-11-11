// Every colour the game draws with, by name. The first groups are the tables of art bible
// section 3 (and section 7 for the outline), word for word; the groups after the lights are
// the extra colours the models, lawn, sky and renderer need, each a relative of one above.

const colours = {
  // Plants
  leaf: '#58C13B',
  leafDark: '#3E9A2E',
  leafLight: '#8BE05A',
  stem: '#2F7D32',
  pea: '#7ED957',
  petal: '#FFC928',
  petalDark: '#F59F0B',
  sunflowerFace: '#8A5A2B',
  walnut: '#A8703A',
  walnutDark: '#7B4A22',
  walnutLight: '#C98F55',
  terracotta: '#C8643C',

  // Zombies
  skin: '#9ACD8A',
  skinDark: '#6FA364',
  clothPurple: '#7B4BD6',
  clothDark: '#4B2A8F',
  bone: '#EDE6D3',
  boneShadow: '#C9BFA5',
  brainPink: '#FF8FB1',
  iron: '#9AA4B1',
  rust: '#B5533C',
  speedRed: '#E2553F',

  // World
  grassLight: '#7FD14B',
  grassDark: '#6BBE3F',
  soil: '#8B5A2B',
  soilDark: '#6B4423',
  islandRock: '#7A6A5A',
  graveLight: '#5B4B7A',
  graveDark: '#4A3C66',
  skyTop: '#5EC8FF',
  skyHorizon: '#CFF3FF',
  cloud: '#FFFFFF',

  // Level materials
  levelIron: '#AEB7C2',
  levelCrystal: '#7DE8FF',
  levelGold: '#FFC83D',

  // Effects
  hitSpark: '#FFF4B0',
  fire: '#FF7A1A',
  fireLight: '#FFD23F',
  poison: '#9BE23B',
  heal: '#7CFFB2',
  stunStars: '#FFE45C',
  sun: '#FFD54A',
  brains: '#FF8FB1',

  // Interface
  outline: '#2A1B0E',

  // Lights (art bible section 4)
  sunLight: '#FFF1D6',
  fillSky: '#BFE8FF',
  fillGround: '#6BBE3F',
  bounceLight: '#DCEBFF',

  // Extra model colours. The level materials' shadow tones, for trim that wants two and
  // for added parts; and the black of an eye and the white of its glint, which the art
  // bible names without a number.
  levelIronDark: '#6E7A8C',
  levelCrystalDeep: '#3FC6F2',
  levelGoldDark: '#F0A21E',
  // A paler pea, for a lip that has to stand out from a pea-green head.
  peaLight: '#B5EF8A',
  // A paler petal, for the Sunflower's petal tips: the trim that turns to metal and crystal.
  petalLight: '#FFDC5A',
  eye: '#1A1A22',
  eyeGlint: '#FFFFFF',

  // Extra zombie colours: each a flat tone and a darker companion, inside the zombies'
  // family of sickly skin, purples, bone and iron.
  // Old trousers and hair: a slate purple between cloth dark and the graveyard.
  trouser: '#4E4870',
  trouserDark: '#363052',
  // The inside of a mouth, a brain's grooves, and teeth (warmer than bone, so they read as teeth).
  mouthDark: '#3B1530',
  brainDark: '#E2668F',
  tooth: '#FFF7E3',
  // Plain plastic armour, before level 3 turns it to real metal.
  armour: '#8E95A3',
  armourDark: '#676E7C',
  // A skeleton's eye sockets, and the red dots that glow in them.
  socket: '#2C2238',
  eyeRed: '#FF4436',
  // The Very Fast Walker's red-flushed skin.
  skinFlush: '#B8C47E',
  skinFlushDark: '#8C9E5C',
  // The Desert Zombie: sand, and the bandages it is wrapped in.
  sand: '#E2C68A',
  sandDark: '#BC9C5E',
  bandage: '#EEE4C6',
  bandageDark: '#C9B88F',
  // The Cowboy's hat, vest and belt.
  hatBrown: '#8E5B32',
  hatBrownDark: '#633D1E',
  // The Necromancer's robe, and its paler trim (the trim that turns to metal and crystal).
  robePurple: '#5B3799',
  robePurpleDark: '#3C226B',
  robeTrim: '#B08CF2',
  // The Trident Zombie's sea-soaked skin, and seaweed.
  seaBlue: '#7898AC',
  seaBlueDark: '#56758A',
  seaweed: '#3F8A5A',
  seaweedDark: '#2C6642',
  // Brain Rot: its sallow skin, and the toxic green of its brain and goo.
  sickSkin: '#B9C77C',
  sickSkinDark: '#8E9D57',
  toxicGreen: '#8CD445',
  toxicGreenDark: '#5C9A2A',

  // Extra world colours: ground that is neither tile nor prop, and what stands on it.
  rimGrass: '#5DB53C',
  rimGrave: '#473B65',
  graveSoil: '#51405A',
  graveRock: '#625A70',
  stone: '#8E89A6',
  stoneDark: '#6C6787',
  deadBark: '#5A4960',
  deadBarkLight: '#73607A',
  crystal: '#C9A6FF',
  crystalGlow: '#A070FF',
  // Sky and clouds, as they should appear on screen.
  skyHaze: '#9AD8FA',
  skyDeep: '#4DB9F6',
  skyBackdrop: '#8FD8FF',
  cloudSide: '#BBDCF5',
  cloudUnder: '#A6D2F4',
  cloudFar: '#8FD6FF',
  // Placement highlights. The zombies' purple is pushed brighter than their cloth so it
  // holds up as a thin wash over green grass. The warning red is deeper than speed red and
  // has almost no green in it, which is what keeps it red through the filmic curve.
  lanePurple: '#A35CFF',
  denyRed: '#BF2525',
  // Shadowed corners go towards this dusky blue rather than black.
  occlusion: '#1E2B4A',
} as const;

export type PaletteName = keyof typeof colours;

/**
 * Colour by name, as `#RRGGBB`. The names above are typed, so `PALETTE.leaf` is a string;
 * looking up an arbitrary string gives `string | undefined`.
 */
export const PALETTE: Record<PaletteName, string> & Record<string, string> = colours;
