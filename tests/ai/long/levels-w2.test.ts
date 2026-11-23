import { worldBandTests } from './levelBands';

// World 2's bands, both sides, on one seed block (LVT_BLOCKS=3: three; see levelBands.ts): the
// step-2 plan's gate (rulings 5-6, `levelGate`), the idle-player check, and a printed record of
// every level: the Moonlit Meadow (p2.ts) and the Frozen Tundra (z2.ts).
worldBandTests(2);
