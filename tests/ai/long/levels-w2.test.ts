import { worldBandTests } from './levelBands';

// World 2's bands, both sides, on one seed block (LVT_BLOCKS=3: three; see levelBands.ts): the
// step-2 plan's gate (rulings 5-6, `worldTwoGate`), the idle-player check, and a printed record of
// every level. A todo until p2.ts / z2.ts hold levels.
worldBandTests(2);
