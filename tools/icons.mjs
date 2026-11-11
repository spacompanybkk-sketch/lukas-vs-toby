// Redraws the procedural pixel icons in src/ui/icons.css: `node tools/icons.mjs`.
//
// Each icon below is a 16 x 16 pixel picture made from simple shapes (a fill colour per pixel
// centre); an ink outline is then added round it automatically, one pixel wide, wherever an empty
// pixel touches a filled one. The result replaces the icon's ASCII grid comment and its
// crispEdges SVG data URL in icons.css. Icons not listed here are left as they are.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src/ui/icons.css');
const N = 16;

/** One character per colour, as in the file's header. */
const COLORS = {
  o: '#2A1B0E', w: '#FFFFFF', y: '#FFD54A', Y: '#F59F0B', l: '#FFF4B0', L: '#FFC4D6', p: '#FF8FB1', P: '#D9607F',
  b: '#A8703A', B: '#7B4A22', i: '#9AA4B1', h: '#C3CAD3', I: '#6B7480', r: '#E2553F', g: '#58C13B', G: '#3E9A2E',
};

const inTri = (px, py, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = s(px, py, ax, ay, bx, by);
  const d2 = s(px, py, bx, by, cx, cy);
  const d3 = s(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const deg = (a) => (a * Math.PI) / 180;

/** The speaker box and cone shared by the sound icons. */
const speakerBody = (x, y) => (x >= 1 && x <= 4.6 && y >= 5.6 && y <= 10.4)
  || (x >= 4.6 && x <= 8.4 && Math.abs(y - 8) <= 2.4 + (x - 4.6) * 1.35);

/** Fill functions: (x, y) of a pixel centre → colour character or null. */
const ICONS = {
  play: (x, y) => (inTri(x, y, [4, 1.6], [4, 14.4], [14.6, 8]) ? (x < 6 && y < 9 ? 'w' : 'w') : null),

  restart: (x, y) => {
    // A thick ring open at the top right, ending in a big arrowhead that points on round it.
    const cx = 7.6;
    const cy = 8.8;
    const dx = x - cx;
    const dy = cy - y;
    const r = Math.hypot(dx, dy);
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a < 0) a += 360;
    const ring = r >= 3.6 && r <= 6.1 && !(a > 12 && a < 88);
    const head = inTri(x, y, [12.2, 1.2], [15.4, 7.4], [9.0, 7.4]);
    return ring || head ? 'w' : null;
  },

  speaker: (x, y) => {
    if (speakerBody(x, y)) return 'w';
    const r = Math.hypot(x - 8, y - 8);
    const facing = x > 9.6 && Math.abs(y - 8) < (x - 8) * 1.3;
    return facing && ((r > 3.0 && r < 4.3) || (r > 5.6 && r < 6.9)) ? 'w' : null;
  },

  mute: (x, y) => {
    if (speakerBody(x, y)) return 'w';
    // A big red cross where the sound waves would be.
    const d1 = Math.abs((x - 9.8) - (y - 5.2));
    const d2 = Math.abs((x - 9.8) - (10.8 - y));
    if (x >= 9.8 && x <= 15.4 && y >= 5.2 && y <= 10.8 && (d1 < 0.8 || d2 < 0.8)) return 'r';
    return null;
  },

  gear: (x, y) => {
    const dx = x - 8;
    const dy = y - 8;
    const r = Math.hypot(dx, dy);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI + 360;
    const tooth = Math.abs(((a + 22.5) % 45) - 22.5) < 11;
    if (r < 2.3) return null;
    if (r <= 5.0 || (tooth && r <= 7.2)) return r < 3.4 ? 'h' : 'w';
    return null;
  },

  shovel: (x, y) => {
    // Along the handle (u, from the blade's tip at the bottom left) and across it (v).
    const u = ((x - 2.2) + (13.8 - y)) / Math.SQRT2;
    const v = ((x - 2.2) - (13.8 - y)) / Math.SQRT2;
    const av = Math.abs(v);
    if (u >= 0 && u <= 6.4 && av <= Math.min(3.1, 0.75 + u * 1.15)) return v < -0.9 ? 'h' : u < 1.6 ? 'I' : 'i';
    if (u > 6.4 && u <= 7.4 && av <= 1.2) return 'I';
    if (u > 7.4 && u <= 13.4 && av <= 0.85) return 'b';
    if (u > 13.4 && u <= 15.8 && av <= 2.2) return av < 0.9 && u > 14.2 && u < 15.1 ? null : 'B';
    return null;
  },

  brain: (x, y) => {
    const dx = (x - 8) / 7.2;
    const dy = (y - 8.4) / 5.9;
    const e = dx * dx + dy * dy;
    if (e > 1) return null;
    if (Math.abs(x - 7.5) < 0.1 && y > 3) return 'P'; // the split between the halves
    // Wavy grooves across each half.
    const wave = (y + 1.4 * Math.sin((x < 8 ? x : 16 - x) * 1.25)) % 3.4;
    if (e < 0.72 && Math.abs(wave - 1.7) < 0.5) return 'P';
    return e > 0.55 && y < 8 && x < 8 ? 'L' : 'p';
  },
};

function draw(fill) {
  const grid = Array.from({ length: N }, () => Array(N).fill('.'));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y][x] = fill(x + 0.5, y + 0.5) ?? '.';
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (grid[y][x] !== '.') continue;
      let near = false;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const c = grid[y + j]?.[x + i];
        if (c !== undefined && c !== '.') near = true;
      }
      if (near) out[y][x] = 'o';
    }
  }
  return out.map((row) => row.join(''));
}

function encode(rows) {
  const byColour = new Map();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let run = 1;
      while (row[x + run] === c) run++;
      if (c !== '.') {
        const list = byColour.get(c) ?? [];
        list.push(`M${x} ${y}h${run}v1h-${run}z`);
        byColour.set(c, list);
      }
      x += run;
    }
  });
  const order = ['o', ...[...byColour.keys()].filter((c) => c !== 'o')];
  const paths = order.filter((c) => byColour.has(c)).map((c) => `<path fill='${COLORS[c]}' d='${byColour.get(c).join('')}'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${N} ${N}' shape-rendering='crispEdges'>${paths}</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;
}

let css = await readFile(FILE, 'utf8');
for (const [name, fill] of Object.entries(ICONS)) {
  const rows = draw(fill);
  const block = new RegExp(`/\\*\\n[.\\w\\n]*?\\*/\\n\\.ico--${name} \\{ background-image: url\\("[^"]*"\\); \\}`);
  if (!block.test(css)) throw new Error(`icons.css has no block for ${name}`);
  css = css.replace(block, `/*\n${rows.join('\n')}\n*/\n.ico--${name} { background-image: ${encode(rows)}; }`);
  console.log(`${name}\n${rows.join('\n')}\n`);
}
await writeFile(FILE, css);
