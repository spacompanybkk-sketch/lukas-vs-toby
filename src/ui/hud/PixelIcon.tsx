/**
 * A pixel picture drawn from a square ASCII grid: one character per pixel, '.' transparent, any
 * other character a colour from the palette. Rendered as an SVG with crisp edges, one path per
 * colour and one rectangle per horizontal run, so it stays hard-edged at any size.
 */
export interface PixelArt {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

/** The SVG path data for each colour: runs of the same character in a row become one rectangle. */
export function pixelPaths(art: PixelArt): { ch: string; color: string; d: string }[] {
  const byChar = new Map<string, string[]>();
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row.charAt(x);
      let end = x + 1;
      while (end < row.length && row.charAt(end) === ch) end++;
      if (ch !== '.' && art.palette[ch] !== undefined) {
        const list = byChar.get(ch) ?? [];
        list.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
        byChar.set(ch, list);
      }
      x = end;
    }
  });
  return [...byChar].map(([ch, parts]) => ({ ch, color: art.palette[ch] as string, d: parts.join('') }));
}

/** Path data worked out once per picture (the pictures are module constants). */
const drawn = new WeakMap<PixelArt, { w: number; h: number; paths: ReturnType<typeof pixelPaths> }>();

function drawingOf(art: PixelArt): { w: number; h: number; paths: ReturnType<typeof pixelPaths> } {
  let d = drawn.get(art);
  if (d === undefined) {
    d = { w: Math.max(1, ...art.rows.map((r) => r.length)), h: Math.max(1, art.rows.length), paths: pixelPaths(art) };
    drawn.set(art, d);
  }
  return d;
}

export function PixelIcon({ art, class: cls = '' }: { art: PixelArt; class?: string }) {
  const { w, h, paths } = drawingOf(art);
  return (
    <svg
      class={`pixel-icon ${cls}`.trim()} viewBox={`0 0 ${w} ${h}`} shape-rendering="crispEdges"
      aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"
    >
      {paths.map((p) => <path key={p.ch} fill={p.color} d={p.d} />)}
    </svg>
  );
}
