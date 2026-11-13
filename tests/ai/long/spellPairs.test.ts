import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: spellPairs (seeds 1..N)', () => {
  bandTests(/^spell-(pairs|deal)$/);
});
