import { Component } from 'preact';
import { PowerCharge, PressGate, chargeStep, shakeClass } from './HeroButton';
import { PixelIcon } from './PixelIcon';
import type { PixelArt } from './PixelIcon';
import './hud.css';

export interface SpellButtonVM {
  /** The spell's key (spec 21): thunderbolt, vines, sunShower, healingRain, rockWall, meteor, fog, brainFeast, frenzy, graveRise. */
  key: string;
  ready: boolean;
  /** How far it has recharged, 0..1. */
  fraction: number;
}

export interface SpellButtonsProps {
  spells: SpellButtonVM[];
  /** The key of the spell picked and waiting for a tile, if any. */
  selected: string | null;
  /** Every tap, with the spell's key; the controller decides what it means. */
  onPress(key: string): void;
  /** The spell whose last press was refused, and 1 or 2 alternating (0: none shakes). */
  shake?: { key: string; n: number };
}

/** Each spell's name (spec 21), used as its button's accessible name; the picture says it to a child. */
export const SPELL_NAMES: Record<string, string> = {
  thunderbolt: 'Thunderbolt', vines: 'Vines', sunShower: 'Sun Shower', healingRain: 'Healing Rain', rockWall: 'Rock Wall',
  meteor: 'Meteor', fog: 'Fog', brainFeast: 'Brain Feast', frenzy: 'Frenzy', graveRise: 'Grave Rise',
};

// Colours from docs/art-bible.md section 3 (the same as theme.css).
const INK = '#2A1B0E';
const C = {
  ink: INK, white: '#FFFFFF',
  sun: '#FFD54A', sunLo: '#F59F0B', sunHi: '#FFF4B0',
  leaf: '#58C13B', leafLo: '#2F7D32', leafHi: '#8BE05A',
  stone: '#9AA4B1', stoneLo: '#6B7480', stoneHi: '#C3CAD3',
  red: '#E2553F', redLo: '#A83A28', redHi: '#F17D66',
  brain: '#FF8FB1', brainLo: '#D9607F', brainHi: '#FFC4D6',
  bone: '#EDE6D3', boneLo: '#C9BFA5',
  skin: '#9ACD8A', skinLo: '#6FA364', purpleLo: '#4B2A8F',
  soil: '#8B5A2B', soilLo: '#6B4423',
};

/** One pixel grid per spell, drawn in code (see PixelIcon). 12 x 12, '.' is clear. */
export const SPELL_ICONS: Record<string, PixelArt> = {
  thunderbolt: {
    rows: [
      '......ooooo.',
      '.....oyyyyo.',
      '....oyyyyo..',
      '...oyLyyo...',
      '..oyyyyoooo.',
      '.oyyyyyyyYo.',
      '.ooooyyyYo..',
      '....oyyYo...',
      '...oyyYo....',
      '..oyYoo.....',
      '..oYo.......',
      '..oo........',
    ],
    palette: { o: C.ink, y: C.sun, Y: C.sunLo, L: C.sunHi },
  },
  vines: {
    rows: [
      '............',
      '.ooo....ooo.',
      'olggo..oggGo',
      'olgggooggGGo',
      '.oggGGoGGGo.',
      '..ooGGGGoo..',
      '....oGGo....',
      '...oGGo.....',
      '...oGGo..oo.',
      '....oGGooGo.',
      '.....oGGGo..',
      '......ooo...',
    ],
    palette: { o: C.ink, g: C.leaf, G: C.leafLo, l: C.leafHi },
  },
  sunShower: {
    rows: [
      '.....oo.....',
      '..o.oyyo.o..',
      '...oyLyyo...',
      '.ooyLyyyyoo.',
      '.oyyyyyyyYo.',
      '..oyyyyyYo..',
      '...oooooo...',
      '............',
      '.oo..oo..oo.',
      'oyYooyYooyYo',
      'oYYooYYooYYo',
      '.oo..oo..oo.',
    ],
    palette: { o: C.ink, y: C.sun, Y: C.sunLo, L: C.sunHi },
  },
  healingRain: {
    rows: [
      '...oooo.....',
      '..ohwwhoooo.',
      '.ohwwhhhhhho',
      'ohhhhhhhhhho',
      'ohhhhhhhhSSo',
      '.oooooooooo.',
      '...o....o...',
      '..ogo..ogo..',
      '.oglgooglgo.',
      '..ogo..ogo..',
      '...o....o...',
      '............',
    ],
    palette: { o: C.ink, w: C.white, h: C.stoneHi, S: C.stone, g: C.leaf, l: C.leafHi },
  },
  rockWall: {
    rows: [
      'oooooooooooo',
      'ohhhhsohhhso',
      'osssSSosssSo',
      'oooooooooooo',
      'ohhsohhhhhso',
      'osSSosssssSo',
      'oooooooooooo',
      'ohhhhsohhhso',
      'osssSSosssSo',
      'oooooooooooo',
      'obbBbbbBbbbo',
      'oooooooooooo',
    ],
    palette: { o: C.ink, h: C.stoneHi, s: C.stone, S: C.stoneLo, b: C.soil, B: C.soilLo },
  },
  meteor: {
    rows: [
      '........oooo',
      '.......oyyYo',
      '......oyyYYo',
      '....ooyyYYo.',
      '..ooBBoYYo..',
      '.oBbbBBoo...',
      'oBbrbbBBo...',
      'oBbbbrbBo...',
      'oBrbbbbBo...',
      '.oBBBBBo....',
      '..ooooo.....',
      '............',
    ],
    palette: { o: C.ink, y: C.sun, Y: C.sunLo, b: C.soil, B: C.soilLo, r: C.red },
  },
  fog: {
    rows: [
      '...........r',
      '...oooooo.rR',
      '.oowwwwwwrR.',
      'owwwwoowrRwo',
      'owwwoUUrRwwo',
      'owwwoUrRwwwo',
      'owwwwrRwwwwo',
      '.oowrRwwwoo.',
      '..ooooooooo.',
      '.ommmmommmmo',
      'ommmmmmmmmmo',
      'oooooooooooo',
    ],
    palette: { o: C.ink, w: C.white, U: C.purpleLo, r: C.red, R: C.redLo, m: C.stone },
  },
  brainFeast: {
    rows: [
      '...oooooooooo...',
      '..oopppPqqqqoo..',
      '.ooppPqPqqPqqoo.',
      'ooppPqqPPqqPqqoo',
      'oppPqqqPqqqqPqqo',
      'oppqqPPPqPPqqqqo',
      'oqPqqqqPPqqqqPqo',
      'oqqPPqqPqqqPPqqo',
      'oqqqqqPPqPqqqqqo',
      'ooqqqPqPPqPqqqoo',
      '.ooqPqqPqqqPqoo.',
      '..oooooooooooo..',
      '................',
      '.ooo..ooo..ooo..',
      '.oqo..oqo..oqo..',
      '.ooo..ooo..ooo..',
    ],
    palette: { o: C.ink, p: C.brainHi, q: C.brain, P: C.brainLo },
  },
  frenzy: {
    rows: [
      '............',
      '.ooooooo....',
      'ogggggggo...',
      'ogggggggorrr',
      'oRRgggRRo...',
      'oRRgggRRorrr',
      'ogggggggo...',
      'ogoooooGorrr',
      'ogkokokGo...',
      'oGGGGGGGo...',
      '.ooooooo....',
      '............',
    ],
    palette: { o: C.ink, g: C.skin, G: C.skinLo, R: C.red, r: C.red, k: C.bone },
  },
  graveRise: {
    rows: [
      '..oooo......',
      '.oshhso.....',
      'osshhsso....',
      'osssosso.oo.',
      'ossoooso.oko',
      'osssosso.oko',
      'osssosso.oko',
      'osssSsSooKko',
      'oSsSSSSooKko',
      'oooooooooooo',
      'bbBbbbBbbbBb',
      'BBBBBBBBBBBB',
    ],
    palette: { o: C.ink, h: C.stoneHi, s: C.stone, S: C.stoneLo, k: C.bone, K: C.boneLo, b: C.soil, B: C.soilLo },
  },
};

/** For a key with no picture of its own: a plain stone block. */
const UNKNOWN_ICON: PixelArt = {
  rows: ['oooo', 'ohso', 'osSo', 'oooo'],
  palette: { o: C.ink, h: C.stoneHi, s: C.stone, S: C.stoneLo },
};

/**
 * One square per dealt spell: its pixel picture, no words. While a spell recharges its veil drops
 * away in steps; when ready the same boxy gold frame as the hero button pulses round it.
 */
export function SpellButtons({ spells, selected, onPress, shake }: SpellButtonsProps) {
  return (
    <div class="power-spells" data-hud="spells" role="group" aria-label="Spells">
      {spells.map((s) => (
        <SpellButton
          key={s.key} spellKey={s.key} ready={s.ready} step={s.ready ? 1 : chargeStep(s.fraction)}
          selected={selected === s.key} onPress={onPress} shake={shake !== undefined && shake.key === s.key ? shake.n : 0}
        />
      ))}
    </div>
  );
}

interface SpellButtonProps { spellKey: string; ready: boolean; step: number; selected: boolean; shake: number; onPress(key: string): void }

/** One spell; re-renders only when its look changes (a whole charge step, ready, selected). */
class SpellButton extends Component<SpellButtonProps> {
  override shouldComponentUpdate(n: SpellButtonProps): boolean {
    const p = this.props;
    return !(p.spellKey === n.spellKey && p.ready === n.ready && p.step === n.step && p.selected === n.selected && p.shake === n.shake);
  }

  private readonly gate = new PressGate();
  private readonly press = (): void => this.props.onPress(this.props.spellKey);
  private readonly down = (e: PointerEvent): void => this.gate.down(e, this.props.selected, this.press);
  private readonly click = (): void => this.gate.click(this.press);

  override render() {
    const { spellKey: key, ready, step, selected } = this.props;
    const cls = ['power', 'power--spell', 'px', `power--spell-${key}`, ready ? 'is-ready' : 'is-charging'];
    if (selected) cls.push('is-selected');
    return (
      <button
        type="button" data-spell={key} class={cls.join(' ') + shakeClass(this.props.shake)}
        aria-label={SPELL_NAMES[key] ?? key} aria-pressed={selected} aria-disabled={ready ? undefined : 'true'}
        onPointerDown={this.down} onClick={this.click}
      >
        <span class="power__art">
          <PixelIcon art={SPELL_ICONS[key] ?? UNKNOWN_ICON} class="power__icon" />
        </span>
        <PowerCharge ready={ready} step={step} />
      </button>
    );
  }
}
