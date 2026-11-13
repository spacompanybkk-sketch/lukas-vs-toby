import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: spam, plants cards (seeds 1..N)', () => {
  bandTests(/^spam$/, / (peashooter|sunflower|walnutBomb|potatoMine|kernelPult|mangoPult|avocadoBunker|torchwood|cherryBomber|pumpkinSquash)$/);
});
