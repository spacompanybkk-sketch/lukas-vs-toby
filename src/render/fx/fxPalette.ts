// Colours the bases and effects need that the art bible's tables do not name. Each is a
// relative of a palette colour: a darker stone for the crypt, a burnt leaf for a hurt tree,
// greys for smoke. Kept here, apart from `palette.ts`, so that file stays the art bible's.

export const FX = {
  // Smoke and dust: cool greys that sit with the sky rather than with soot.
  smoke: '#8D8A9C',
  smokeDark: '#6A667A',
  smokeLight: '#B7B3C4',
  puff: '#ECE8F4',
  // A cut in bark or stone: nearly black, warm on the tree, cold on the crypt.
  crackWood: '#3A2210',
  crackStone: '#1C1628',
  // Leaves on a hurt tree go olive, then brown.
  leafTired: '#9DAA3A',
  leafDry: '#A9873A',
  leafDead: '#86622E',
  // The tree's plank floor and the lookout's rail.
  plank: '#B98048',
  plankDark: '#8E5A2C',
  // A warm lamp in the tree's window.
  lamp: '#FFC65A',
  lampDeep: '#FF9A2E',
  // The flag.
  flag: '#4FD84A',
  flagDark: '#2FA83A',
  // The crypt: stone a step darker than the gravestones, so it reads as Toby's.
  cryptStone: '#5E5677',
  cryptStoneDark: '#463F5E',
  cryptStoneLight: '#7A7194',
  cryptRoof: '#3B3352',
  cryptRoofLight: '#51486C',
  cryptIron: '#3A3448',
  // The doorway's light and the crystals' colours.
  // Kept deep and saturated: they glow, and glowing colours come out paler on screen.
  doorway: '#A55CFF',
  doorwayMid: '#7E3CE6',
  doorwayDeep: '#4E2299',
  spire: '#A879FF',
  spireDeep: '#7133E8',
  spireDim: '#4E3C78',
  // Explosions: white-hot centre, then fire and embers.
  core: '#FFF6D0',
  ember: '#FF5A1A',
} as const;
