import { useEffect, useState } from 'preact/hooks';
import { session } from '../../app/session';
import { go } from '../../app/store';
import { ALL_CARDS, UNIT_INFO, factionOf } from '../../data/units';
import { MAX_UPGRADE, upgradeCost } from '../../progress/upgrades';
import type { CardKey, Faction } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PlayerPicture } from './PlayerPicture';
import { COIN, PLUS } from './pictures';
import './players.css';
import './progress.css';

const SIDES: readonly { side: Faction; icon: string; label: string }[] = [
  { side: 'plants', icon: 'sun', label: 'Plants' },
  { side: 'zombies', icon: 'brain', label: 'Zombies' },
];

const PIPS = Array.from({ length: MAX_UPGRADE }, (_, i) => i + 1);

/** Two alternating animation classes, so each new tap restarts the animation. */
const beat = (n: number, name: string): string => (n === 0 ? '' : ` is-${name}-${n % 2 === 1 ? 'a' : 'b'}`);

/** What the last tap on a card did, counted, so its hop or shake plays again on every tap. */
interface Fx { hops: number; denies: number; fresh: number }
const NO_FX: Fx = Object.freeze({ hops: 0, denies: 0, fresh: 0 });

/**
 * One unit: its portrait (it hops when bought), ten pips (filled up to its level, the newest one
 * pops), the next step's price with a coin, and a big "+". Too few coins: the price is red and
 * the "+" grey; a tap shakes the card with the deny sound. At level 10 the card is framed in gold
 * and has nothing to buy.
 */
function UnitCard({ unit, level, coins, fx, portraits, onBuy }: {
  unit: CardKey; level: number; coins: number; fx: Fx; portraits: Record<string, string>; onBuy(): void;
}) {
  const max = level >= MAX_UPGRADE;
  const price = max ? 0 : upgradeCost(level + 1);
  const poor = !max && coins < price;
  const name = UNIT_INFO[unit].name;
  return (
    <div
      data-card={unit} data-level={level} data-max={max ? '' : undefined}
      class={`market__card px pal-side side-${factionOf(unit)}${max ? ' is-max' : ''}${poor ? ' is-poor' : ''}${beat(fx.denies, 'deny')}`}
    >
      <PlayerPicture picture={unit} portraits={portraits} class={`market__pic${beat(fx.hops, 'hop')}`} />
      <div class="market__pips" role="img" aria-label={`Level ${level} of ${MAX_UPGRADE}`}>
        {PIPS.map((n) => (
          <span
            key={n} data-pip={n}
            class={`market__pip${n <= level ? ' is-on' : ''}${n === fx.fresh && n <= level ? ' is-new' : ''}`}
          />
        ))}
      </div>
      {max ? (
        <span class="market__done" aria-label="Top level">
          <span class="market__done-coin"><PixelIcon art={COIN} /></span>
        </span>
      ) : (
        <div class="market__buy-row">
          <span class="market__price" data-price={price} aria-label={`${price} coins`}>
            <PixelIcon art={COIN} class="market__price-coin" />
            <span class="inked">{price}</span>
          </span>
          <button
            type="button" data-buy={unit} aria-label={`Upgrade ${name}`}
            class={`btn market__plus ${poor ? 'pal-stone' : 'pal-leaf'}`} onClick={onBuy}
          >
            <PixelIcon art={PLUS} class="market__plus-icon" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Marketplace: the logged-in player's coins at the top, two picture tabs (plants, zombies),
 * and the ten units of the side, each with ten upgrade steps. Every step adds what its side's `Balance.upgradeStep` says (damage, and health where that step is above 0) in
 * Adventure, Quick Battle and Free Play (never Versus). Buying goes through `session.buy`, so it
 * is kept on the device and synced. Nothing needs reading: pictures, pips, colours and sounds.
 */
export function Marketplace({ portraits = {} }: { portraits?: Record<string, string> }) {
  const me = session.player.value;
  const [side, setSide] = useState<Faction>(() => (me === null ? 'plants' : factionOf(me.picture)));
  const [fx, setFx] = useState<Partial<Record<CardKey, Fx>>>({});
  const loggedOut = me === null;
  // Logged out: back to the pictures, after render (as Home does).
  useEffect(() => {
    if (loggedOut) go({ name: 'players' });
  }, [loggedOut]);
  if (me === null) return null;

  const fxOf = (unit: CardKey): Fx => fx[unit] ?? NO_FX;
  const buy = (unit: CardKey): void => {
    const r = session.buy(unit);
    // The function form: two fast taps (on one card or two) each build on the latest effects.
    const bump = (change: (was: Fx) => Fx): void => setFx((all) => ({ ...all, [unit]: change(all[unit] ?? NO_FX) }));
    if (r === 'ok') {
      uiSound('merge');
      const level = session.player.peek()?.upgrades[unit] ?? 0; // after the buy
      bump((was) => ({ ...was, hops: was.hops + 1, fresh: level }));
    } else {
      uiSound('deny');
      bump((was) => ({ ...was, denies: was.denies + 1 }));
    }
  };
  const pick = (s: Faction): void => {
    uiSound('click');
    setSide(s);
  };

  return (
    <div data-screen="marketplace" data-side={side} class="layer layer--menu market">
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => { uiSound('click'); go({ name: 'home' }); }}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <div class="market__top">
        <div class="market__tabs" role="tablist">
          {SIDES.map((s) => (
            <button
              key={s.side} type="button" role="tab" data-tab={s.side} aria-label={s.label} aria-selected={s.side === side}
              class={`btn market__tab ${s.side === side ? 'pal-cream is-on' : 'pal-wood'}`} onClick={() => pick(s.side)}
            >
              <span class={`ico ico--${s.icon} market__tab-icon`} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <span class="market__coins px pal-wood" data-coins={me.coins} aria-label={`${me.coins} coins`}>
        <PixelIcon art={COIN} class="market__coin" />
        <span class="inked" key={me.coins}>{me.coins}</span>
      </span>
      <div class="market__grid" key={side}>
        {ALL_CARDS[side].map((unit) => (
          <UnitCard
            key={unit} unit={unit} level={me.upgrades[unit] ?? 0} coins={me.coins} fx={fxOf(unit)}
            portraits={portraits} onBuy={() => buy(unit)}
          />
        ))}
      </div>
    </div>
  );
}
