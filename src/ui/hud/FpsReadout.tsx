import { useEffect, useState } from 'preact/hooks';
import './hud.css';

/** What the corner readout shows: frames per second, the render scale and draw calls per frame. */
export interface FpsStats { fps: number; scale: number; drawCalls: number }

/** How often the readout refreshes, in milliseconds. */
const REFRESH_MS = 500;

/**
 * A small boxy panel in the bottom-left corner for checking a real iPad: fps, render scale and
 * draw calls, refreshed twice a second. Shown only with `?fps`; it never takes a tap.
 */
export function FpsReadout({ source }: { source: () => FpsStats }) {
  const [stats, setStats] = useState<FpsStats>(source);
  useEffect(() => {
    const timer = setInterval(() => setStats({ ...source() }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [source]);
  return (
    <div data-hud="fps" class="hud-fps px pal-slate" aria-hidden="true">
      <span class="hud-fps__row"><b>{Math.round(stats.fps)}</b> fps</span>
      <span class="hud-fps__row"><b>{stats.scale.toFixed(2)}</b> scale</span>
      <span class="hud-fps__row"><b>{stats.drawCalls}</b> calls</span>
    </div>
  );
}
