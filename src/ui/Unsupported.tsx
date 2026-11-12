import './screens/screens.css';

export interface UnsupportedProps {
  reason: 'webgl2' | 'context-lost';
  /** Defaults to reloading the page. */
  onReload?(): void;
}

/** A plain stop screen: the device cannot draw the game, or the graphics were lost. */
export function Unsupported({ reason, onReload = () => location.reload() }: UnsupportedProps) {
  return (
    <div data-screen="unsupported" class="layer layer--dim">
      <div class="unsupported panel px pal-slate stack" role="alert">
        <span class="unsupported__mark inked" aria-hidden="true">!</span>
        {reason === 'webgl2'
          ? <p class="unsupported__text">This game needs a newer browser. Try Safari on an iPad, or Safari or Chrome on a computer.</p>
          : (
            <>
              <p class="unsupported__text">Graphics stopped. Reload to continue.</p>
              <button type="button" data-action="reload" class="btn btn--big pal-leaf" onClick={onReload}>
                <span class="ico ico--restart" aria-hidden="true" /><span class="btn__label inked">Reload</span>
              </button>
            </>
          )}
      </div>
    </div>
  );
}
