import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: core (seeds 1..N)', () => {
  bandTests(/^(MvM|length|HvE|adults|energy)$/);
});
