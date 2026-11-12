import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: spam (seeds 1..N)', () => {
  bandTests(/^spam$/);
});
