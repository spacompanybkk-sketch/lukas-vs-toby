import './theme.css';
import './phone.css';

/** One pixel picture: a character per pixel (o ink, w white, s screen, g grass, b body, d dark body, . empty). */
const COLOURS: Record<string, string> = {
  o: '#2a1b0e', w: '#ffffff', s: '#5ec8ff', g: '#7fd14b', b: '#c3cad3', d: '#6b7480',
};

const TABLET = [
  '..oooooooooooooooo..',
  '.obbbbbbbbbbbbbbbbo.',
  'obbooooooooooooobbbo',
  'obbosssssssssssobbwo',
  'obbosssssssswssobbbo',
  'obbosssssssssssobbbo',
  'obbogggggggggggobbbo',
  'obbooooooooooooobbdo',
  '.obbbbbbbbbbbbbbbdo.',
  '..oooooooooooooooo..',
];

const MONITOR = [
  'oooooooooooooooooooo',
  'obbbbbbbbbbbbbbbbbbo',
  'obooooooooooooooooob',
  'obosssssssssssssssob',
  'obosssssssswssssssob',
  'obosssssssssssssssob',
  'obogggggggggggggggob',
  'obooooooooooooooooob',
  'obbbbbbbbbbbbbbbbbdo',
  'oooooooooooooooooooo',
  '.......oddddo.......',
  '.......oddddo.......',
  '....oooodddddooo....',
  '...obbbbbbbbbbbbo...',
  '...oddddddddddddo...',
  '....oooooooooooo....',
];

function Pixels({ grid, className }: { grid: string[]; className: string }) {
  const rects: preact.JSX.Element[] = [];
  grid.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const fill = COLOURS[c];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={fill} />);
    });
  });
  return (
    <svg class={className} viewBox={`0 0 ${(grid[0] ?? '').length} ${grid.length}`} shape-rendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

/** The only thing a phone shows: the game is for iPads and computers (a phone version comes later). */
export function PhoneNotice() {
  return (
    <div data-screen="phone" class="layer phone">
      <div class="phone__panel panel px pal-cream">
        <div class="phone__pics">
          <Pixels grid={TABLET} className="phone__pic" />
          <Pixels grid={MONITOR} className="phone__pic" />
        </div>
        <p class="phone__text inked">THIS GAME IS FOR iPAD AND COMPUTERS</p>
      </div>
    </div>
  );
}
