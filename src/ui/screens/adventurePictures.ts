import type { LevelKind } from '../../adventure/types';
import type { PixelArt } from '../hud/PixelIcon';
import { SWORDS, art } from './boardPictures';
import { outlined, overlay } from './pictures';

/**
 * Pictures of the Play menu, the map and the level card, as pixel grids (see PixelIcon), in the
 * board's palette. Drawn as fills; `outlined` adds the one-pixel ink edge.
 */

/** Adventure: a winding path of stepping stones up to a red flag. */
export const PATH_FLAG = art(outlined([
  '................',
  '..........Brrr..',
  '..........Brrrr.',
  '..........Brrr..',
  '..........B.....',
  '........eeBe....',
  '.......eEEEEe...',
  '................',
  '...ee...........',
  '..eEEe..........',
  '.......ee.......',
  '......eEEe......',
  '..........ee....',
  '.........eEEe...',
  '..ee............',
  '.eEEe...........',
]));

/**
 * Free Play: three boxy zombie heads in a row, each bigger than the last, under a fat arrow - "they
 * keep coming, more and bigger". Wider than the 16 × 16 pictures (the heads need the room).
 */
export const ENDLESS = art(outlined([
  '.......................',
  '........yy.............',
  '........yyy............',
  '.llllllllyyy...........',
  '.yyyyyyyyyyyy..........',
  '.YYYYYYYYYYY...........',
  '........YYY............',
  '........YY....gggggggg.',
  '..............gggggggg.',
  '.......gggggg.gwwggwwg.',
  '.ggggg.gggggg.gwPggwPg.',
  '.gPgPg.gPggPg.gggggggg.',
  '.ggggg.gggggg.ggeeeegg.',
  '.geGeg.geGGeg.ggPPPPgg.',
  '.GGGGG.GGGGGG.GGGGGGGG.',
  '.......................',
]));

/** Survive: a wooden shield. */
export const SHIELD = art(outlined([
  '................',
  '..bbbbbbbbbbbb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '..byyyyyyyyyyb..',
  '..byyyyyyyyyyb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '...bhhhyyhhhb...',
  '...bhhhyyhhhb...',
  '....bhhyyhhb....',
  '.....bhyyhb.....',
  '......byyb......',
  '.......bb.......',
  '................',
]));

/** Breakthrough: a stone hammer on a wooden handle. */
export const HAMMER = art(outlined([
  '................',
  '..sssssssss.....',
  '..smmmmmmms.....',
  '..smmmmmmmsS....',
  '..sssssssssS....',
  '...SSSbSSSS.....',
  '......bb........',
  '.......bb.......',
  '........bb......',
  '.........bb.....',
  '..........bb....',
  '...........bb...',
  '............bb..',
  '.............B..',
  '................',
  '................',
]));

/** The clock that comes with Survive and Breakthrough (and the clock stars of Breakthrough). */
export const CLOCK = art(outlined([
  '................',
  '.....wwwwww.....',
  '...wwwwwowwww...',
  '..wwwwwwowwwww..',
  '..wwwwwwowwwww..',
  '.wwwwwwwowwwwww.',
  '.wwwwwwwowwwwww.',
  '.wwwwwwwoooooww.',
  '.wwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwww.',
  '..wwwwwwwwwwww..',
  '..wwwwwwwwwwww..',
  '...wwwwwwwwww...',
  '.....wwwwww.....',
  '................',
  '................',
]));

/** Conveyor: a belt on two wheels with three boxes riding on it. */
export const BELT = art(outlined([
  '................',
  '................',
  '................',
  '..gg..yy..nn....',
  '..gG..yY..nN....',
  '..GG..YY..NN....',
  '.SSSSSSSSSSSSSS.',
  'SmmmmmmmmmmmmmmS',
  'SmsmmmsmmmsmmmmS',
  'SmmmmmmmmmmmmmmS',
  '.SSSSSSSSSSSSSS.',
  '..SS..SS..SS....',
  '..SS..SS..SS....',
  '................',
  '................',
  '................',
]));

/** Boss: a skull with a golden crown. */
export const SKULL_CROWN = art(outlined([
  '..y....y....y...',
  '..yy..yyy..yy...',
  '..yyyyyryyyyy...',
  '..YYYYYYYYYYY...',
  '...eeeeeeeee....',
  '..eeeeeeeeeee...',
  '..eooeeeeeooe...',
  '..eooeeeeeooe...',
  '..eeeeeoeeeee...',
  '...eeeoooeee....',
  '...eeeeeeeee....',
  '....eoeoeoe.....',
  '....eeeeeee.....',
  '................',
  '................',
  '................',
]));

/** A base: a small boxy tower (the level card's "keep your base" stars). */
export const TOWER = art(outlined([
  '................',
  '..s.s.s..s.s.s..',
  '..sssss..sssss..',
  '..smmms..smmms..',
  '..smmmssssmmms..',
  '..smmmmmmmmmms..',
  '..smmmmmmmmmms..',
  '..smmmmBBmmmms..',
  '..smmmBBBBmmms..',
  '..smmmBBBBmmms..',
  '..smmmBBBBmmms..',
  '..ssssssssssss..',
  '................',
  '................',
  '................',
  '................',
]));

/** The first star: just win. A small red flag on a pole. */
export const FLAG = art(outlined([
  '................',
  '....Brrrrrr.....',
  '....Brrrrrrr....',
  '....Brrrrrrrr...',
  '....Brrrrrrr....',
  '....Brrrrrr.....',
  '....B...........',
  '....B...........',
  '....B...........',
  '....B...........',
  '....B...........',
  '...BBB..........',
  '..BBBBB.........',
  '................',
  '................',
  '................',
]));

/** A boxy skull, six pixels square: bone white, dark eyes (`P`; red `r` for the hardest), a jaw. */
const SKULL = (eye: string): string[] => ['.eeee.', 'eeeeee', 'eXeeXe', 'eXeeXe', 'eeeeee', '.eEeE.'].map((r) => r.replace(/X/g, eye));

/** Skulls placed on a 16 × 16 picture at their top-left corners (x, y), outlined. */
const SKULLS = (eye: string, at: readonly (readonly [number, number])[]): string[] => {
  const rows = Array.from({ length: 16 }, () => [...'................']);
  for (const [x, y] of at) {
    SKULL(eye).forEach((r, dy) => [...r].forEach((ch, dx) => { if (ch !== '.') rows[y + dy]![x + dx] = ch; }));
  }
  return outlined(rows.map((r) => r.join('')));
};

/**
 * The three Adventure difficulties as more and more skulls - one, two, a pile of three with red
 * eyes - so a child who cannot read sees "a little, more, a lot" (not moods, as faces were).
 */
export const DIFF_EASY = art(SKULLS('P', [[5, 5]]));
export const DIFF_NORMAL = art(SKULLS('P', [[1, 5], [9, 5]]));
export const DIFF_HARD = art(SKULLS('r', [[5, 1], [1, 9], [9, 9]]));

/** A "?" block (a surprise to win), golden, with rivets. */
export const QUESTION = art(outlined([
  '................',
  '.YYYYYYYYYYYYYY.',
  '.YlyyyyyyyyyylY.',
  '.YyyyyoooooyyyY.',
  '.YyyyooyyyooyyY.',
  '.YyyyooyyyooyyY.',
  '.YyyyyyyyooyyyY.',
  '.YyyyyyyooyyyyY.',
  '.YyyyyyooyyyyyY.',
  '.YyyyyyooyyyyyY.',
  '.YyyyyyyyyyyyyY.',
  '.YyyyyyooyyyyyY.',
  '.YlyyyyooyyyylY.',
  '.YYYYYYYYYYYYYY.',
  '................',
  '................',
]));

/** A gift's bow: two red loops and a knot. */
export const BOW = art(outlined([
  '................',
  '................',
  '................',
  '................',
  '..rrr......rrr..',
  '.rRRrr....rrRRr.',
  '.rR..rr..rr..Rr.',
  '.rR...rrrr...Rr.',
  '.rRR..rRRr..RRr.',
  '..rrrrrRRrrrrr..',
  '......rRRr......',
  '.....rr..rr.....',
  '....rr....rr....',
  '................',
  '................',
  '................',
]));

/**
 * The lawn twists, drawn small on the level card (only when the level has one): a fog cloud over
 * mist, a boulder, an ice crystal, a drop of lava.
 */
export const TWIST_FOG = art(overlay(outlined([
  '................',
  '.....ssss.......',
  '....swwwws.ss...',
  '..sswwwwwwswws..',
  '.swwwwwwwwwwwws.',
  '.swwwwwwwwwwwws.',
  '.smmmmmmmmmmmms.',
  '..ssssssssssss..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
]), [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.mmmmmmmm..mmmm.',
  '................',
  '...mmmmm.mmmmmm.',
  '................',
  '.mmmm..mmmmmm...',
  '................',
]));

export const TWIST_ROCK = art(outlined([
  '................',
  '................',
  '................',
  '......mmmm......',
  '....mmssssmm....',
  '...msswwsssmm...',
  '..msswwssssssm..',
  '..mssssssssmsm..',
  '.mssssssssmmssm.',
  '.msssmsssssssSm.',
  '.mmssssssssSSSm.',
  '.SmmssssSSSSSSS.',
  '..SSSSSSSSSSSS..',
  '................',
  '................',
  '................',
]));

export const TWIST_ICE = art(outlined([
  '................',
  '.......w........',
  '......wck.......',
  '.....wcckK......',
  '....wccckKK.....',
  '...wcccckKKK....',
  '..wccccckKKKK...',
  '..cccccckKKKK...',
  '..kkkkkkKKKKK...',
  '...kkkkkKKKK....',
  '....kkkkKKK.....',
  '.....kkkKK......',
  '......kkK.......',
  '.......K........',
  '................',
  '................',
]));

export const TWIST_LAVA = art(outlined([
  '................',
  '.......y........',
  '.......y........',
  '......yyY.......',
  '......yyY.......',
  '.....yyyYY......',
  '....yyyyYYY.....',
  '....ylyyYYr.....',
  '...yllyyYYrr....',
  '...ylyyyYrrr....',
  '...yyyyYYrrR....',
  '...YyyyYrrrR....',
  '....YYrrrrR.....',
  '.....rrrRR......',
  '................',
  '................',
]));

/** A level kind's picture: one, or a main one with a smaller one on its corner. */
export const KIND_ART: Readonly<Record<LevelKind, readonly PixelArt[]>> = Object.freeze({
  battle: [SWORDS],
  survive: [SHIELD, CLOCK],
  breakthrough: [HAMMER, CLOCK],
  conveyor: [BELT],
  boss: [SKULL_CROWN],
});

/** Every picture here, for the tests. */
export const ADVENTURE_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({
  PATH_FLAG, SHIELD, HAMMER, CLOCK, BELT, SKULL_CROWN, TOWER, FLAG, QUESTION, BOW, DIFF_EASY, DIFF_NORMAL, DIFF_HARD,
  TWIST_FOG, TWIST_ROCK, TWIST_ICE, TWIST_LAVA,
});
