import './hud.css';

export interface PauseMenuProps {
  onResume(): void;
  onRestart(): void;
  onSettings(): void;
  onQuit(): void;
}

/** Dimmed overlay with four big picture buttons; Resume is the biggest. */
export function PauseMenu({ onResume, onRestart, onSettings, onQuit }: PauseMenuProps) {
  return (
    <div data-screen="pause" class="layer layer--dim" role="dialog" aria-label="Paused">
      <div class="pause panel px pal-wood stack">
        <span class="pause__badge ico ico--pause" aria-hidden="true" />
        <button type="button" data-action="resume" class="btn btn--big pal-leaf pause__resume" onClick={onResume}>
          <span class="ico ico--play" aria-hidden="true" /><span class="btn__label inked">Resume</span>
        </button>
        <div class="pause__grid">
          <button type="button" data-action="restart" class="btn pal-cream" onClick={onRestart}>
            <span class="ico ico--restart" aria-hidden="true" /><span class="btn__label">Restart</span>
          </button>
          <button type="button" data-action="settings" class="btn pal-cream" onClick={onSettings}>
            <span class="ico ico--gear" aria-hidden="true" /><span class="btn__label">Settings</span>
          </button>
          <button type="button" data-action="quit" class="btn pal-red" onClick={onQuit}>
            <span class="ico ico--home" aria-hidden="true" /><span class="btn__label inked">Quit</span>
          </button>
        </div>
      </div>
    </div>
  );
}
