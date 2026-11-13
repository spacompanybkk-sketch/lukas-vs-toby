import { useEffect, useState } from 'preact/hooks';
import { session } from '../../app/session';
import { actionSound } from '../../audio/bindings';
import { go } from '../../app/store';
import { UNIT_INFO, factionOf, isCard } from '../../data/units';
import { renderPortraits } from '../../render/portraits';
import { getModelDef } from '../../render/models/registry';
import type { Faction, UnitKey } from '../../sim/types';
import { SILHOUETTES } from '../hud/CardTray';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { BOOT, HEART, ROLE_ART, ROOT, SWORD } from './almanacPictures';
import { ALMANAC_UNITS, statBars } from './almanacStats';
import { DIGITS } from './pictures';
import './players.css';
import './progress.css';

/** What the Almanac needs from the 3D turntable (the game passes `AlmanacStage` on the shared stage). */
export interface AlmanacHost {
  open(key: UnitKey, level: number): void;
  show(key: UnitKey, level: number): void;
  /** Plays the attack or ability clip once; null when the model has none. */
  play(): string | null;
  close(): void;
}

/** The card portraits are drawn at this size (as in the game). */
const PORTRAIT_SIZE = 120;

const nameOf = (key: UnitKey): string => (isCard(key) ? UNIT_INFO[key].name : 'Bone Minion');
const roleOf = (key: UnitKey): string => (isCard(key) ? UNIT_INFO[key].role : 'Raised');
const levelsOf = (key: UnitKey): number[] => (getModelDef(key).singleLevel ? [1] : [1, 2, 3, 4, 5]);

/** A unit's picture: its card portrait, or until it is drawn, the boxy silhouette of its side. */
function UnitPicture({ unit, src, class: cls = '' }: { unit: UnitKey; src: string | undefined; class?: string }) {
  const side = factionOf(unit);
  return (
    <span class={`pic side-${side} ${cls}`.trim()} data-picture={unit}>
      {src !== undefined
        ? <img class="pic__img" src={src} alt="" draggable={false} />
        : <PixelIcon art={SILHOUETTES[side]} class="pic__silhouette" />}
    </span>
  );
}

/** The Bone Minion is no card, so the game does not draw its portrait: the Almanac asks for it. */
function useExtraPortraits(): Record<string, string> {
  const [extra, setExtra] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void renderPortraits(['boneMinion'], PORTRAIT_SIZE, (key, url) => {
      if (alive) setExtra((e) => ({ ...e, [key]: url }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return extra;
}

function Bar({ kind, icon, share, plain, instead }: {
  kind: string; icon: PixelArt; share: number | null; plain: number | null; instead: PixelArt;
}) {
  // The part an upgrade adds is drawn in gold after the plain part.
  const gain = share !== null && plain !== null && share - plain > 0.0005 ? share - plain : 0;
  return (
    <div class="almanac__stat" data-stat={kind}>
      <span class="almanac__stat-icon"><PixelIcon art={icon} /></span>
      {share === null ? (
        <span class="almanac__instead" data-instead={kind}><PixelIcon art={instead} /></span>
      ) : (
        <span class="almanac__track px pal-stone">
          <span
            class={`almanac__fill almanac__fill--${kind}`} data-bar={kind} data-share={share.toFixed(3)}
            style={{ width: `${(share - gain) * 100}%` }}
          />
          {gain > 0 && (
            <span class="almanac__fill almanac__fill--up" data-bar-up={kind} style={{ width: `${gain * 100}%` }} />
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The Almanac: every unit (all twenty, and the Bone Minion) as a picture; the chosen one turns
 * on a boxy pedestal on the lawn behind the panel, at the level its pips pick. Three bars
 * (health, damage per second, speed) against the biggest on its side, its role as a picture, and
 * a play button for its attack or ability. The name is there for Lukas; nothing needs reading.
 * Until phase 4b adds unlocks, every unit is shown.
 */
export function Almanac({ portraits = {}, host }: { portraits?: Record<string, string>; host?: AlmanacHost }) {
  const [unit, setUnit] = useState<UnitKey>('peashooter');
  const [level, setLevel] = useState(1);
  const extra = useExtraPortraits();
  const pics = { ...portraits, ...extra };

  useEffect(() => {
    host?.open(unit, level);
    return () => host?.close();
  }, [host]);
  useEffect(() => {
    host?.show(unit, level);
  }, [host, unit, level]);

  const choose = (key: UnitKey): void => {
    uiSound('click');
    setUnit(key);
    setLevel((l) => Math.min(l, levelsOf(key).length));
  };
  const side = factionOf(unit);
  const me = session.player.value;
  const upgrade = me !== null && isCard(unit) ? (me.upgrades[unit] ?? 0) : 0;
  const bars = statBars(unit, level, upgrade);
  const role = (ROLE_ART[roleOf(unit)] ?? ROLE_ART.Basic) as PixelArt;
  const levels = levelsOf(unit);

  return (
    <div data-screen="almanac" class="layer almanac" data-shown={unit} data-shown-level={level}>
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => { uiSound('click'); go({ name: session.player.peek() !== null ? 'home' : 'title' }); }}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <div class={`almanac__info px pal-side side-${side}`} data-info={unit}>
        <div class="almanac__head">
          <span class="almanac__role px pal-cream" data-role={roleOf(unit)} aria-label={roleOf(unit)}><PixelIcon art={role} /></span>
          <span class="almanac__name inked">{nameOf(unit)}</span>
        </div>
        <Bar kind="hp" icon={HEART} share={bars.hp} plain={bars.hpPlain} instead={role} />
        <Bar kind="dps" icon={SWORD} share={bars.dps} plain={bars.dpsPlain} instead={role} />
        <Bar kind="speed" icon={BOOT} share={bars.speed} plain={bars.speed} instead={ROOT} />
        <div class="almanac__pips" role="group" aria-label="Level">
          {levels.map((n) => (
            <button
              key={n} type="button" data-level={n} aria-label={`Level ${n}`} aria-pressed={n === level}
              class={`btn almanac__pip ${n <= level ? 'pal-leaf' : 'pal-stone'}${n === level ? ' is-on' : ''}`}
              onClick={() => { uiSound('click'); setLevel(n); }}
            >
              <PixelIcon art={DIGITS[String(n)] as PixelArt} class="almanac__pip-digit" />
            </button>
          ))}
        </div>
        <button
          type="button" data-action="act" aria-label="Play its move" class="btn btn--big pal-leaf almanac__act"
          onClick={() => {
            // The move's own sound (its shot, bite or ability, as in battle), or a click with none.
            const clip = host?.play() ?? null;
            uiSound(actionSound(unit, clip) ?? 'click');
          }}
        >
          <span class="ico ico--play" aria-hidden="true" />
        </button>
      </div>
      <div class="almanac__grid">
        {(['plants', 'zombies'] as Faction[]).map((f) => (
          <div key={f} class="almanac__row" data-row={f}>
            {ALMANAC_UNITS[f].map((key) => (
              <button
                key={key} type="button" data-unit={key} aria-label={nameOf(key)} aria-pressed={key === unit}
                class={`almanac__tile px pal-side side-${f}${key === unit ? ' is-on' : ''}`} onClick={() => choose(key)}
              >
                <UnitPicture unit={key} src={pics[key]} class="almanac__pic" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
