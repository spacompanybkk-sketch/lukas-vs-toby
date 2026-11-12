import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: spells (seeds 1..N)', () => {
  bandTests(/^spell-one$/);
});
