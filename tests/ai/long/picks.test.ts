import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: picks (seeds 1..N)', () => {
  bandTests(/^picks$/);
});
