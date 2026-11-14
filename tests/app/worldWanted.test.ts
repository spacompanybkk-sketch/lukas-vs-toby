import { describe, expect, it } from 'vitest';
import { WorldWanted, type Dressable } from '../../src/app/Stage';
import { SAMPLE_LAWNS } from '../../src/render/world/TwistTiles';
import { NO_TWIST } from '../../src/sim/lawn';

/** Parts that count how often the lawn is asked to change, and how often it really does. */
function parts(): Dressable & { asked: number; rebuilt: number } {
  let shown = 'backyard';
  let shownLawn = NO_TWIST;
  const p = {
    asked: 0,
    rebuilt: 0,
    lawn: {
      setWorld(world: typeof shown, lawn = NO_TWIST) {
        p.asked++;
        if (world === shown && JSON.stringify(lawn) === JSON.stringify(shownLawn)) return false;
        shown = world;
        shownLawn = lawn;
        p.rebuilt++;
        return true;
      },
    },
    sky: { setLook() {} },
    renderer: { setLook() {} },
  };
  return p as unknown as Dressable & { asked: number; rebuilt: number };
}

describe('WorldWanted', () => {
  it('does nothing frame after frame while the wanted world stays the same', () => {
    const w = new WorldWanted();
    const p = parts();
    for (let i = 0; i < 100; i++) w.apply(p);
    expect(p.asked).toBe(0);
    w.want('tundra', SAMPLE_LAWNS.tundra);
    for (let i = 0; i < 100; i++) w.apply(p);
    expect(p.asked).toBe(1);
    expect(p.rebuilt).toBe(1);
    // The same world and the same config object again: not even a look at the lawn.
    w.want('tundra', SAMPLE_LAWNS.tundra);
    w.apply(p);
    expect(p.asked).toBe(1);
  });

  it('compares a new config object by value once, through the lawn', () => {
    const w = new WorldWanted();
    const p = parts();
    w.want('meadow', SAMPLE_LAWNS.meadow);
    w.apply(p);
    w.want('meadow', { ...SAMPLE_LAWNS.meadow });
    for (let i = 0; i < 10; i++) w.apply(p);
    expect(p.asked).toBe(2);
    expect(p.rebuilt).toBe(1);
  });

  it('a hand-over to the Backyard and back to the same level costs no rebuild when applied once between', () => {
    const w = new WorldWanted();
    const p = parts();
    w.want('citadel', NO_TWIST);
    w.apply(p);
    w.want('backyard', NO_TWIST);
    w.want('citadel', NO_TWIST);
    w.apply(p);
    expect(p.rebuilt).toBe(1);
  });

  it('applies on demand when forced (tools)', () => {
    const w = new WorldWanted();
    const p = parts();
    w.apply(p, true);
    expect(p.asked).toBe(1);
    expect(p.rebuilt).toBe(0);
  });
});
