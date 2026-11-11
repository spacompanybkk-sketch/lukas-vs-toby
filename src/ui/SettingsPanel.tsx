import { QUALITIES } from '../app/settings';
import type { Quality, Settings } from '../app/settings';
import './screens/screens.css';

export interface SettingsPanelProps {
  settings: Settings;
  /** Called with the whole new settings object on every change; the caller applies and saves it. */
  onChange(s: Settings): void;
  /** Shows a back button when given. */
  onClose?(): void;
}

const QUALITY_LABEL: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** Music and effects sliders, mute, quality. Every row starts with a picture. */
export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const set = (patch: Partial<Settings>): void => onChange({ ...settings, ...patch });
  return (
    <div data-screen="settings" class="layer layer--dim" role="dialog" aria-label="Settings">
      <div class="settings panel px pal-cream stack">
        <div class="settings__head">
          {onClose !== undefined && (
            <button type="button" data-action="close-settings" class="btn btn--square pal-wood" aria-label="Back" onClick={onClose}>
              <span class="ico ico--back" aria-hidden="true" />
            </button>
          )}
          <span class="settings__title ico ico--gear" aria-hidden="true" />
        </div>
        <Slider icon="note" label="Music" value={settings.music} dim={settings.muted} onInput={(v) => set({ music: v })} />
        <Slider icon="speaker" label="Effects" value={settings.sfx} dim={settings.muted} onInput={(v) => set({ sfx: v })} />
        <div class="settings__row">
          <button
            type="button" data-action="mute" class={`btn pal-${settings.muted ? 'red' : 'stone'} settings__mute`}
            aria-pressed={settings.muted} aria-label="Mute" onClick={() => set({ muted: !settings.muted })}
          >
            <span class={`ico ico--${settings.muted ? 'mute' : 'speaker'}`} aria-hidden="true" />
          </button>
          <div class="settings__quality" role="group" aria-label="Quality">
            {QUALITIES.map((q, i) => (
              <button
                key={q} type="button" data-quality={q}
                class={`btn pal-${settings.quality === q ? 'leaf' : 'stone'} settings__q`}
                aria-pressed={settings.quality === q} onClick={() => set({ quality: q })}
              >
                <span class="pips" aria-hidden="true">
                  {QUALITIES.map((_, j) => <span key={j} class={`pip${j <= i ? ' is-on' : ''}`} />)}
                </span>
                <span class="btn__label">{QUALITY_LABEL[q]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SliderProps { icon: string; label: string; value: number; dim: boolean; onInput(v: number): void }

function Slider({ icon, label, value, dim, onInput }: SliderProps) {
  const pct = Math.round(value * 100);
  return (
    <label class={`settings__row settings__slider${dim ? ' is-dim' : ''}`}>
      <span class={`settings__icon px pal-wood`} aria-hidden="true"><span class={`ico ico--${icon}`} /></span>
      <input
        type="range" min={0} max={100} step={5} value={pct} aria-label={label}
        style={{ '--pct': `${pct}%` }}
        onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value) / 100)}
      />
    </label>
  );
}
