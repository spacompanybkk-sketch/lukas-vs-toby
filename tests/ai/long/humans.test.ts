import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: humans (seeds 1..N)', () => {
  bandTests(/^(child|newest|slow|attentive)$/);
});
