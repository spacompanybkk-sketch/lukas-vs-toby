import { UNIT_INFO, factionOf, isCard } from '../data/units';
import type { UnitKey } from '../sim/types';
import { BALANCE } from '../data/balance';
import { COIN } from './screens/pictures';
import { ALMANAC_UNITS, rawStats } from './screens/almanacStats';
import { BOOT, HEART, ROLE_ART, SWORD } from './screens/almanacPictures';
import type { PixelArt } from './hud/PixelIcon';

/** One short thing a unit does: a word (1-2 words, Title Case) and the picture that goes with it. */
export interface Trait { word: string; icon: PixelArt }

/** The role (spec 6.6, as the Almanac shows it) as a word a child knows. */
const ROLE_WORD: Readonly<Record<string, string>> = Object.freeze({
  'Basic shooter': 'Shooter', Income: 'Sun', Wall: 'Wall', Trap: 'Trap', Control: 'Stunner', 'Area damage': 'Splash',
  Fortress: 'Fortress', Support: 'Helper', Removal: 'Bomb', Bruiser: 'Smasher', Basic: 'Biter', Rush: 'Rusher',
  Tank: 'Tank', Sniper: 'Sniper', Snowball: 'Grower', Disabler: 'Lasso', Siege: 'Spear', 'Area denial': 'Poison',
  Raised: 'Minion',
});

interface Candidate { word: string; icon: PixelArt; /** 0..1 how far from the middle of its side (1 = the very top or bottom) */ strength: number }

/** Where `v` stands among `all` (0 = lowest, 1 = highest; a tie counts half). */
const standing = (v: number, all: readonly number[]): number =>
  all.length < 2 ? 0.5 : (all.filter((x) => x < v).length + 0.5 * all.filter((x) => x === v).length - 0.5) / (all.length - 1);

/**
 * A unit's two or three traits for the unlock screen. The first is its role. The rest are the
 * stand-outs against the other units of its own side (at level 1, no upgrade): for health, speed
 * (zombies only; plants have roots), damage per second, shot range and price, a unit in the top
 * third of its side by that number earns the high word (Tough, Fast, Hits Hard, Long Range,
 * Pricey) and one in the bottom third the low word (Low HP, Slow, Cheap). Of those, the two furthest from
 * the middle are kept (ties: health, speed, damage, range, price). If nothing qualifies, a
 * cost word (else a health word) by which half of the side it sits in fills in, so a unit
 * always shows two or three traits.
 */
export function unitTraits(key: UnitKey): Trait[] {
  const side = factionOf(key);
  const mates = ALMANAC_UNITS[side];
  const me = rawStats(key);
  const role = isCard(key) ? UNIT_INFO[key].role : 'Raised';
  const traits: Trait[] = [{ word: ROLE_WORD[role] ?? role, icon: (ROLE_ART[role] ?? ROLE_ART.Basic) as PixelArt }];

  const cands: Candidate[] = [];
  const consider = (value: number | null, all: (number | null)[], high: [string, PixelArt], low: [string, PixelArt] | null): void => {
    if (value === null) return;
    const pool = all.filter((x): x is number => x !== null);
    const p = standing(value, pool);
    if (p >= 2 / 3) cands.push({ word: high[0], icon: high[1], strength: p - 0.5 });
    else if (low !== null && p <= 1 / 3) cands.push({ word: low[0], icon: low[1], strength: 0.5 - p });
  };
  const over = <T,>(f: (k: UnitKey) => T): T[] => mates.map(f);
  const price = (k: UnitKey): number | null => (isCard(k) ? UNIT_INFO[k].price : null);
  const range = (k: UnitKey): number | null => BALANCE.units[k]?.shot?.range ?? null;
  const pos = (n: number): number | null => (n > 0 ? n : null);

  consider(me.hp, over((k) => rawStats(k).hp), ['Tough', HEART], ['Low HP', HEART]);
  if (side === 'zombies') consider(pos(me.speed), over((k) => pos(rawStats(k).speed)), ['Fast', BOOT], ['Slow', BOOT]);
  consider(pos(me.dps), over((k) => pos(rawStats(k).dps)), ['Hits Hard', SWORD], null);
  consider(range(key), over(range), ['Long Range', ROLE_ART.Sniper as PixelArt], null);
  consider(price(key), over(price), ['Pricey', COIN], ['Cheap', COIN]);

  // Stable sort keeps the tie order above.
  cands.sort((a, b) => b.strength - a.strength);
  for (const c of cands.slice(0, 2)) traits.push({ word: c.word, icon: c.icon });

  if (traits.length < 3) {
    // Not enough stand-outs: a cost word, else health, by which half of the side it sits in.
    const used = new Set(traits.map((t) => t.word));
    const cost = price(key);
    const fillers: Trait[] = [];
    if (cost !== null) {
      const costs = over(price).filter((x): x is number => x !== null);
      fillers.push(standing(cost, costs) >= 0.5 ? { word: 'Pricey', icon: COIN } : { word: 'Cheap', icon: COIN });
    }
    const hps = over((k) => rawStats(k).hp);
    fillers.push(standing(me.hp, hps) >= 0.5 ? { word: 'Tough', icon: HEART } : { word: 'Low HP', icon: HEART });
    for (const f of fillers) if (traits.length < 2 && !used.has(f.word)) traits.push(f);
  }
  return traits;
}
