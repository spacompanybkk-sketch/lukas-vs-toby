// Screenshot tool: `node tools/shots.mjs <scenario...> [--headed]`.
//
// Opens each scenario in Playwright's bundled Chromium (at 1440x900 unless the scenario
// sets its own viewport), waits for `window.__lvt.ready`, and saves
// artifacts/shots/<scenario>.png, or one artifacts/shots/<scenario>-<suffix>.png per frame
// for a scenario that lists `frames`. Exits non-zero on any page error or if the 3D canvas
// came out as one flat colour. `LVT_PORT=<port>` runs the dev server on another port, for a
// second checkout whose server must not clash with this one's.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
// The unit lists live in one place, shared with the registry and the tests (Node strips its types).
import { FIRST_PLANTS, PLANTS as ALL_PLANTS, RAISED, ZOMBIES as FIELDED_ZOMBIES } from '../src/render/models/roster.ts';

/** The three plants of the first level, which the first plant lawn shots stand on the lawn. */
const PLANTS = [...FIRST_PLANTS];

/** The other seven plants, in unlock order. */
const PLANTS2 = ALL_PLANTS.filter((key) => !FIRST_PLANTS.includes(key));

/** Shows or hides a part on every model in the gallery (the mine's `armed`, the bunker's `cracks`). */
async function showPart(page, part, shown) {
  await page.evaluate(([p, s]) => window.__lvt.gallery.instances.forEach((instance) => instance.showPart(p, s)), [part, shown]);
}

/** A model's still frames: each a suffix and a clip frozen at a time, with any parts shown first. */
function moves(key, frames) {
  return {
    name: `gallery-${key}-moves`,
    url: `/?scene=gallery&model=${key}&t=0`,
    frames: frames.map(([suffix, clip, t, part]) => ({
      suffix,
      run: async (page) => {
        if (part) await showPart(page, part, true);
        await pose(page, clip, t);
      },
    })),
  };
}

/** The ten zombies a player can field, in unlock order, and the one that is raised, not fielded. */
const ZOMBIES = [...FIELDED_ZOMBIES];
const RAISED_ZOMBIES = [...RAISED];

/**
 * @type {{
 *   name: string,
 *   url: string,
 *   viewport?: { width: number, height: number },
 *   steps?: (page: import('playwright').Page) => Promise<void>,
 *   frames?: { suffix: string, run: (page: import('playwright').Page) => Promise<void> }[],
 * }[]}
 */
const SCENARIOS = [
  { name: 'boot', url: '/?scene=boot' },
  { name: 'lawn', url: '/?scene=lawn&t=3' },
  { name: 'lawn-wide', url: '/?scene=lawn&t=3', viewport: { width: 2560, height: 1080 } },
  { name: 'lawn-small', url: '/?scene=lawn&t=3', viewport: { width: 1280, height: 720 } },
  {
    name: 'lawn-highlight',
    url: '/?scene=lawn&t=3',
    steps: (page) => highlight(page, [2, 3, 'ok'], [4, 'ok']),
  },
  {
    name: 'lawn-highlight-bad',
    url: '/?scene=lawn&t=3',
    steps: (page) => highlight(page, [1, 6, 'bad'], [0, 'bad']),
  },
  // Every model at about the size it has on the lawn, then the Peashooter's row close up.
  { name: 'gallery', url: '/?scene=gallery&t=0.4' },
  { name: 'gallery-page2', url: '/?scene=gallery&t=0.4&page=2' },
  { name: 'gallery-page3', url: '/?scene=gallery&t=0.4&page=3' },
  { name: 'gallery-peashooter', url: '/?scene=gallery&model=peashooter&t=0.4' },
  {
    // Lean back, release, snap, settle.
    name: 'gallery-peashooter-shoot',
    url: '/?scene=gallery&model=peashooter&clip=shoot&t=0',
    frames: [0.06, 0.12, 0.16, 0.3].map((t) => ({ suffix: t.toFixed(2), run: (page) => pose(page, 'shoot', t) })),
  },
  // On the real lawn, under the game's own camera.
  { name: 'gallery-lawn', url: `/?scene=gallery&stage=lawn&models=${PLANTS.join(',')}&t=0.4` },
  // The same without labels, which otherwise sit over the faces of the nearest lane.
  { name: 'gallery-lawn-clean', url: `/?scene=gallery&stage=lawn&models=${PLANTS.join(',')}&t=0.4&labels=0` },
  // Three-quarter views from the front and from behind.
  { name: 'gallery-peashooter-front', url: '/?scene=gallery&model=peashooter&t=0.4&pitch=20&yaw=38' },
  { name: 'gallery-peashooter-back', url: '/?scene=gallery&model=peashooter&t=0.4&pitch=24&yaw=-142' },
  // Each level as it would sit on a card: 88 x 112 pixels.
  portraits('gallery-portraits', 'peashooter'),
  // The three plants of the first level, side by side at the lawn angle.
  { name: 'gallery-plants', url: '/?scene=gallery&models=peashooter,sunflower,walnutBomb&t=0.4' },
  { name: 'gallery-sunflower', url: '/?scene=gallery&model=sunflower&t=0.4' },
  { name: 'gallery-sunflower-front', url: '/?scene=gallery&model=sunflower&t=0.4&pitch=20&yaw=38' },
  { name: 'gallery-sunflower-back', url: '/?scene=gallery&model=sunflower&t=0.4&pitch=24&yaw=-142' },
  {
    // Paying out: the nod and the flare at their fullest, and on the way back.
    name: 'gallery-sunflower-pulse',
    url: '/?scene=gallery&model=sunflower&clip=shoot&t=0',
    frames: [0.15, 0.3].map((t) => ({ suffix: t.toFixed(2), run: (page) => pose(page, 'shoot', t) })),
  },
  portraits('gallery-portraits-sunflower', 'sunflower'),
  { name: 'gallery-walnutBomb', url: '/?scene=gallery&model=walnutBomb&t=0.4' },
  { name: 'gallery-walnutBomb-front', url: '/?scene=gallery&model=walnutBomb&t=0.4&pitch=20&yaw=38' },
  { name: 'gallery-walnutBomb-back', url: '/?scene=gallery&model=walnutBomb&t=0.4&pitch=24&yaw=-142' },
  {
    // Breathing in, swelling before the blast, and cracked.
    name: 'gallery-walnutBomb-moves',
    url: '/?scene=gallery&model=walnutBomb&t=0',
    frames: [
      { suffix: 'breath-in', run: (page) => pose(page, 'idle', 0.4) },
      { suffix: 'breath-out', run: (page) => pose(page, 'idle', 1.2) },
      { suffix: 'swell', run: (page) => pose(page, 'die', 0.2) },
      {
        suffix: 'cracked',
        run: async (page) => {
          await page.evaluate(() => window.__lvt.gallery.instances.forEach((instance) => instance.showPart('cracks', true)));
          await pose(page, 'idle', 0.4);
        },
      },
    ],
  },
  portraits('gallery-portraits-walnutBomb', 'walnutBomb'),
  // The ten zombies, side by side at the lawn angle, then from the front (they face −X).
  { name: 'gallery-zombies', url: `/?scene=gallery&models=${ZOMBIES.join(',')}&t=0.4` },
  // From the front, five to a picture and one to a row: side by side, the far column's rows
  // ran into the near one's and its names sat on faces.
  { name: 'gallery-zombies-front', url: `/?scene=gallery&models=${ZOMBIES.slice(0, 5).join(',')}&perRow=1&t=0.4&pitch=20&yaw=-38` },
  { name: 'gallery-zombies-front2', url: `/?scene=gallery&models=${ZOMBIES.slice(5).join(',')}&perRow=1&t=0.4&pitch=20&yaw=-38` },
  {
    // Four evenly spaced frames of each zombie's walk, levels 1 and 5, each an eighth of a
    // cycle off the passing pose so that every frame catches the legs and arms swung out.
    name: 'gallery-zombie-walk',
    url: `/?scene=gallery&models=${ZOMBIES.join(',')}&levels=1,5&clip=walk&phase=0.125`,
    frames: [0.125, 0.375, 0.625, 0.875].map((share, i) => ({ suffix: `f${i}`, run: (page) => posePhase(page, 'walk', share) })),
  },
  {
    // Each zombie's attack, frozen at its strike or release.
    name: 'gallery-zombie-attack',
    url: `/?scene=gallery&models=${ZOMBIES.join(',')}&levels=1,5&t=0.4`,
    frames: [
      { suffix: 'melee', run: (page) => posePhase(page, 'melee', 0.42) },
      { suffix: 'shoot', run: (page) => posePhase(page, 'shoot', 0.3) },
      { suffix: 'spawn', run: (page) => posePhase(page, 'spawn', 0.45) },
      { suffix: 'die', run: (page) => posePhase(page, 'die', 1) },
      { suffix: 'cheer', run: (page) => posePhase(page, 'cheer', 0.5) },
    ],
  },
  // The seven later plants at the lawn angle and from the front, and all ten plants at levels
  // 1 and 5 on the left half of the real lawn, the game's camera.
  { name: 'gallery-plants2', url: `/?scene=gallery&models=${PLANTS2.join(',')}&t=0.4` },
  // From the front one to a row, in two pictures (side by side, the far column's names sat on faces).
  { name: 'gallery-plants2-front', url: `/?scene=gallery&models=${PLANTS2.slice(0, 4).join(',')}&perRow=1&t=0.4&pitch=20&yaw=38` },
  { name: 'gallery-plants2-front2', url: `/?scene=gallery&models=${PLANTS2.slice(4).join(',')}&perRow=1&t=0.4&pitch=20&yaw=38` },
  { name: 'gallery-lawn-plants', url: `/?scene=gallery&stage=lawn&models=${[...PLANTS, ...PLANTS2].join(',')}&levels=1,5&labels=0&t=0.4` },
  ...PLANTS2.flatMap((key) => [
    { name: `gallery-${key}`, url: `/?scene=gallery&model=${key}&t=0.4` },
    { name: `gallery-${key}-front`, url: `/?scene=gallery&model=${key}&t=0.4&pitch=20&yaw=38` },
    { name: `gallery-lawn-${key}`, url: `/?scene=gallery&stage=lawn&model=${key}&labels=0&t=0.4` },
    portraits(`gallery-portraits-${key}`, key, [1, 5]),
  ]),
  // The special motions, frozen: the mine armed and going off, the two flings at wind-up and
  // release, the pumpkin's leap at its apex and on impact, the cherries' swell, the torch's
  // fire at two beats, the bunker cracked.
  moves('potatoMine', [
    ['asleep', 'idle', 0.4],
    ['armed', 'idle', 0.4, 'armed'],
    ['trigger-jump', 'shoot', 0.18, 'armed'],
    ['trigger-blast', 'shoot', 0.3, 'armed'],
  ]),
  moves('kernelPult', [
    ['windup', 'shoot', 0.0825],
    ['release', 'shoot', 0.15],
    ['over', 'shoot', 0.2],
  ]),
  moves('mangoPult', [
    ['windup', 'shoot', 0.1375],
    ['release', 'shoot', 0.25],
    ['over', 'shoot', 0.33],
  ]),
  moves('pumpkinSquash', [
    ['crouch', 'melee', 0.1],
    ['apex', 'melee', 0.28],
    ['impact', 'melee', 0.401],
  ]),
  moves('cherryBomber', [
    ['swell-half', 'shoot', 0.5],
    ['swell-full', 'shoot', 1],
  ]),
  moves('torchwood', [
    ['flame-a', 'idle', 0.2],
    ['flame-b', 'idle', 0.75],
  ]),
  moves('avocadoBunker', [['cracked', 'idle', 0.4, 'cracks']]),
  // Level 1 and level 5 of each zombie on the right half of the real lawn, the game's camera.
  { name: 'gallery-lawn-zombies', url: `/?scene=gallery&stage=lawn&models=${ZOMBIES.join(',')}&levels=1,5&from=5&labels=0&t=0.4` },
  ...[...ZOMBIES, ...RAISED_ZOMBIES].flatMap((key) => [
    { name: `gallery-${key}`, url: `/?scene=gallery&model=${key}&t=0.4` },
    { name: `gallery-${key}-front`, url: `/?scene=gallery&model=${key}&t=0.4&pitch=20&yaw=-38` },
    // Its five levels walking in on the real lawn, the game's camera.
    { name: `gallery-lawn-${key}`, url: `/?scene=gallery&stage=lawn&model=${key}&from=4&labels=0&t=0.4` },
    portraits(`gallery-portraits-${key}`, key, [1, 5], -32),
  ]),
  // The two bases: three damage states side by side, then each state in place, a close look
  // at each end, the plants' base swatting, and both falling.
  {
    name: 'bases',
    url: '/?scene=fx&effects=0&t=1',
    frames: [
      { suffix: 'states', run: () => Promise.resolve() },
      { suffix: 'states-low', run: (page) => open(page, '/?scene=fx&effects=0&healths=0.6,0.3,0.1&t=1') },
      ...[1, 0.6, 0.3, 0.1].map((h) => ({
        suffix: `game-${h.toFixed(2)}`,
        run: (page) => open(page, `/?scene=fx&layout=game&effects=0&health=${h}&t=1`),
      })),
      ...['plants', 'zombies'].flatMap((side) =>
        [1, 0.6, 0.3, 0.1].map((h) => ({
          suffix: `${side}-${h.toFixed(2)}`,
          run: (page) => open(page, `/?scene=fx&layout=game&effects=0&health=${h}&focus=${side}&t=1`),
        })),
      ),
      { suffix: 'strike', run: (page) => open(page, '/?scene=fx&layout=game&effects=0&strike=2&focus=plants&t=0.13') },
      ...[0.5, 1.0, 1.6, 2.4, 4.0].map((t) => ({
        suffix: `collapse-${t.toFixed(2)}`,
        run: (page) => open(page, `/?scene=fx&layout=game&effects=0&health=0.1&collapse=both&t=${t}`),
      })),
    ],
  },
  // Every effect on the lawn, between a hurt plants' base and a badly hurt zombies' base;
  // t = 0.15 catches the explosion's flash and ring.
  {
    name: 'fx',
    url: '/?scene=fx&layout=game&plants=0.6&zombies=0.3&t=0.15',
    frames: [0.15, 0.3, 0.6, 1.3].map((t) => ({
      suffix: t.toFixed(2),
      run: (page) => (t === 0.15 ? Promise.resolve() : open(page, `/?scene=fx&layout=game&plants=0.6&zombies=0.3&t=${t}`)),
    })),
  },
  // The same in the side-by-side layout, as `?scene=fx` opens.
  { name: 'fx-states', url: '/?scene=fx&t=0.15' },
  // Phase 2 visuals on the lawn (`?scene=fx-gallery`), each page frozen at a few points of its timeline.
  ...[
    ['fx-projectiles', 'projectiles', [0.5, 1.4]],
    ['fx-statuses', 'statuses', [0.5, 3.4]],
    ['fx-spells-plants', 'spells-plants', [0.12, 0.45, 1.2, 3.2, 4.5]],
    ['fx-spells-zombies', 'spells-zombies', [0.35, 0.62, 0.9, 3]],
    ['fx-heroes', 'heroes', [0.25, 0.5, 0.75]],
    ['fx-props', 'props', [0.5]],
    // Close-ups, to judge the details the lawn shots are too small to show.
    ['fx-statuses-close', 'statuses', [0.5, 1.3], '1,4,-0.2,5.2'],
    ['fx-statuses-close2', 'statuses', [0.5, 1.3], '5,9,-0.2,5.2'],
    ['fx-props-close', 'props', [0.5], '0,5,0.5,5.2'],
  ].map(([name, show, times, focus]) => {
    const url = (t) => `/?scene=fx-gallery&show=${show}&labels=${show === 'props' ? 1 : 0}${focus ? `&focus=${focus}` : ''}&t=${t}`;
    return {
      name,
      url: url(times[0]),
      frames: times.map((t, i) => ({ suffix: `t${t}`, run: (page) => (i === 0 ? Promise.resolve() : open(page, url(t))) })),
    };
  }),
  // A Medium bot against a Medium bot through the battle view, frozen early, mid-match and busy.
  { name: 'battle-early', url: '/?scene=battle-demo&seed=7&t=25' },
  { name: 'battle-mid', url: '/?scene=battle-demo&seed=7&t=80' },
  { name: 'battle-busy', url: '/?scene=battle-demo&seed=7&t=150' },
  // Stacks: five zombies piled against a Walnut Bomb in one lane, three in the next, with
  // plants behind, so the depth nudge, the lift and the bars of a stack can be judged.
  { name: 'battle-stack', url: '/?scene=battle-demo&setup=stack&t=8' },
  {
    // Close up, as played, then with every unit at 60% so all the stack's bars show.
    name: 'battle-stack-close',
    url: '/?scene=battle-demo&setup=stack&t=8',
    steps: async (page) => {
      await page.evaluate(() => window.__lvt.battle.focus(2, 4.6));
      await nextFrames(page, 3);
    },
    frames: [
      { suffix: 'play', run: () => Promise.resolve() },
      {
        suffix: 'bars',
        run: async (page) => {
          await page.evaluate(() => {
            const battle = window.__lvt.battle;
            for (const u of battle.match.state.units) {
              const v = battle.view.unit(u.id);
              if (v) v.hp = v.maxHp * 0.6;
            }
            battle.redraw();
          });
          await nextFrames(page, 3);
        },
      },
    ],
  },
  // Every unit's bar at 40% health, so the bars and level pips of the busy frame can be judged.
  {
    name: 'battle-bars',
    url: '/?scene=battle-demo&seed=7&t=150',
    steps: async (page) => {
      await page.evaluate(() => {
        const battle = window.__lvt.battle;
        for (const u of battle.match.state.units) {
          const v = battle.view.unit(u.id);
          if (v) v.hp = v.maxHp * 0.4;
        }
        battle.redraw();
      });
      await nextFrames(page, 3);
    },
  },
  // Motion, judged from stills: four frames 0.1 s apart from the next Peashooter shot and the
  // next zombie bite after t = 60, the camera closed in on the one acting.
  ...['shot', 'bite'].map((kind) => ({
    name: `battle-motion-${kind}`,
    url: '/?scene=battle-demo&seed=7&t=60',
    frames: [0, 0.1, 0.2, 0.3].map((t, i) => ({
      suffix: `f${i}`,
      run: async (page) => {
        await page.evaluate(
          ([k, first]) => {
            const battle = window.__lvt.battle;
            if (first) {
              const at = battle.until(k);
              if (at) battle.focus(at.lane, at.x);
            } else battle.advance(0.1);
          },
          [kind, i === 0],
        );
        await nextFrames(page, 3);
      },
    })),
  })),
  // The whole roster at work (`?scene=roster-demo`, a scripted match): each scenario frozen at
  // the moments that show its units and abilities, on the full lawn and closed in.
  ...[
    // Every plant on the lawn: the Pumpkin's leap, the mine armed, the Cherry's fuse.
    ['roster-plants', [9.45, 12.1, 24.5]],
    // Every zombie on the lawn: the Cowboy's lasso, the Necromancer's minion, the Archer, Trident and Brain Rot.
    ['roster-zombies', [2.3, 13.4, 14.6]],
    // Statuses: tied Pumpkin, burning Warrior, stunned Desert Zombie; then blind Kernel-pult, poisoned Bunker, stunned Hot Topic.
    ['statuses', [12.6, 18.9]],
    ['statuses-close', [12.6], '4,5.6,1.8'],
    ['statuses-close2', [12.6], '0,5.8,1.8'],
    ['statuses-close3', [18.9], '1,3,1.8'],
    // The Pumpkin's leap and the Cowboy's lasso, close.
    ['roster-leap', [9.2, 9.35, 9.5, 9.8], '4,5,1.8'],
    ['roster-lasso', [11.1, 11.4], '4,6,2.2'],
    // The Potato Mine arming, then going off under the Brain Eater; Hot Topic growing; the Necromancer's raise.
    ['roster-mine', [12.05, 12.95], '3,6.5,1.6'],
    ['roster-grow', [28.2, 28.6], '1,2.5,1.6'],
    ['roster-raise', [13.05, 13.4], '2,8.3,1.6'],
    // Brain Rot's puddle on the Bunker's tile, close.
    ['puddle', [17.6, 19.5], '2,5,2'],
    // The Cherry Bomber goes off in lane 2.
    ['cherry-blast', [24.9, 25.05, 25.2]],
  ].map(([name, times, focus]) => {
    const url = (t) => `/?scene=roster-demo&seed=7${focus ? `&focus=${focus}` : ''}&t=${t}`;
    return {
      name,
      url: url(times[0]),
      frames: times.map((t, i) => ({ suffix: `t${t}`, run: (page) => (i === 0 ? Promise.resolve() : open(page, url(t))) })),
    };
  }),
  // The two bosses as models, and their moves (phase 3 Task 3).
  { name: 'gallery-bosses', url: '/?scene=gallery&models=brainTitan,elderOak&t=0.4' },
  moves('brainTitan', [['windup', 'ability', 1.3], ['strike', 'ability', 1.62], ['roar', 'cheer', 0.3], ['topple', 'die', 0.9]]),
  moves('elderOak', [['fling', 'shoot', 0.3], ['bark', 'idle', 0.4, 'barkL'], ['shake', 'ability', 0.2], ['fall', 'die', 1.0]]),
  // The bosses (`?scene=boss-demo`, phase 3 Task 3): each frozen at its entrance, its tell, its
  // shield and its defeat, on the full lawn with the clock and the boss bar.
  ...[
    ['boss-titan-enter', 'brainTitan', [0.5, 1.0]],
    ['boss-titan-windup', 'brainTitan', [10.8, 11.6]],
    ['boss-titan-shield', 'brainTitan', [15]],
    ['boss-titan-defeat', 'brainTitan', [51.9, 52.6, 53.1]], // falls at 51.7 s (the merged boss numbers)
    ['boss-oak-enter', 'elderOak', [0.5, 1.0]],
    ['boss-oak-barrage', 'elderOak', [10.15, 10.6]],
    ['boss-oak-shield', 'elderOak', [30.8, 31, 32.4]], // armours up at 30.6 s
    ['boss-oak-defeat', 'elderOak', [37.6, 38.3, 39.1]], // falls at 37.3 s
  ].map(([name, boss, times]) => {
    const url = (t) => `/?scene=boss-demo&boss=${boss}&seed=1&t=${t}&cloud=fake`;
    return {
      name,
      url: url(times[0]),
      frames: times.map((t, i) => ({ suffix: `t${t}`, run: (page) => (i === 0 ? Promise.resolve() : open(page, url(t))) })),
    };
  }),
  // ---- The game: menus, HUD, pause and result (Tasks 14 and 15, wired) ----
  { name: 'title', url: '/', steps: (page) => demoAt(page, 45) },
  { name: 'portrait', url: '/', viewport: { width: 768, height: 1024 }, steps: (page) => demoAt(page, 20) },
  {
    name: 'sidepick',
    url: '/',
    steps: async (page) => {
      await demoAt(page, 45);
      await asPlayer(page, 'Mia', 'sunflower');
      await page.click('[data-home="play"]');
      await page.click('[data-play="quick"]');
      await settleUi(page);
    },
  },
  {
    name: 'settings',
    url: '/',
    steps: async (page) => {
      await demoAt(page, 30);
      await page.click('[data-action="settings"]');
      await settleUi(page);
    },
  },
  {
    name: 'sidepick-chosen',
    url: '/',
    steps: async (page) => {
      await demoAt(page, 45);
      await asPlayer(page, 'Mia', 'sunflower');
      await page.click('[data-home="play"]');
      await page.click('[data-play="quick"]');
      await page.click('[data-side="zombies"]');
      await settleUi(page);
    },
  },
  hud('hud-plants', 'plants', 'peashooter', [2, 4]),
  hud('hud-zombies', 'zombies', 'brainEater', [2, 6]),
  { ...hud('hud-ipad', 'plants', 'peashooter', [2, 4]), viewport: { width: 1024, height: 768 } },
  { ...hud('hud-wide', 'plants', 'peashooter', [2, 4]), viewport: { width: 2560, height: 1080 } },
  { ...hud('hud-zombies-ipad', 'zombies', 'brainEater', [2, 6]), viewport: { width: 1024, height: 768 } },
  {
    name: 'pause',
    url: '/?scene=battle&side=plants&skill=medium&seed=7',
    steps: async (page) => {
      await battleAt(page, 40);
      await page.click('[data-hud="pause"]');
      await settleUi(page);
    },
  },
  result('result-win', 'zombies'),
  result('result-lose', 'plants'),
  cheer('result-cheer-plants', 'zombies', 'zombies'),
  cheer('result-cheer-zombies', 'plants', 'plants'),
  // ---- Players: log-in, number pad, new player, Home, grown-up (phase 4a Task 3) ----
  ...playerShots(),
  // Phase 4a: the leaderboard and the Almanac at the iPad and laptop sizes.
  ...progressShots(),
  ...adventureShots(),
  // The phase-2 HUD pieces (?scene=hud-gallery) at the iPad, iPad Air and laptop sizes.
  ...hudGallery(),
  // ---- Hero powers and spells, wired (wiring B) ----
  // A real battle 46 s in (the hero is ready at 45 s): the hero picked by a tap on its button,
  // the lane aimed, then tapped; stills while the power plays, the banner up.
  heroShot('hero-plants', 'plants', 2),
  heroShot('hero-zombies', 'zombies', 2),
  // Every spell from the roster demo's powers part (frozen stills just after each cast).
  ...[
    // Rock Wall heaving up, then bitten, then crumbling; Sun Shower; Vines; Thunderbolt; Healing Rain.
    ['spells-plants', [35.3, 38.5, 40.4, 42.2, 44.45, 46.2, 47.2]],
    // Frenzy; Brain Feast; Fog; Meteor falling, landing; Grave Rise.
    ['spells-zombies', [37.3, 39.5, 41.4, 43.4, 43.8, 45.5, 45.9]],
    // Close: the rock in lane 0, the Frenzy pack in lane 3, the fog over lane 0's plants.
    ['spells-rock-close', [35.4, 40, 46.9], '0,6.5,1.8'],
    ['spells-frenzy-close', [37.4, 38.2], '3,7.5,2'],
    ['spells-fog-close', [41.6], '0,2.5,2'],
  ].map(([name, times, focus]) => {
    const url = (t) => `/?scene=roster-demo&seed=7${focus ? `&focus=${focus}` : ''}&t=${t}`;
    return {
      name,
      url: url(times[0]),
      frames: times.map((t, i) => ({ suffix: `t${t}`, run: (page) => (i === 0 ? Promise.resolve() : open(page, url(t))) })),
    };
  }),
  // The battle HUD at the iPad window (1024x704): hero and both spells ready, an aimed spell
  // picked and its area under the mouse.
  hudBattle('hud-battle-plants-1024', 'plants', [2, 5]),
  hudBattle('hud-battle-zombies-1024', 'zombies', [2, 6]),
  // The zombies' aimed area over their own purple graveyard columns.
  hudBattle('hud-battle-zombies-1024-grave', 'zombies', [1, 9]),
];

/** A real battle as `side`, 46 s in: tap the hero button, aim at `lane`, tap; stills of the power playing. */
function heroShot(name, side, lane) {
  const aimAndFire = async (page) => {
    await battleAt(page, 46);
    await page.click('[data-hero]');
    const at = await page.evaluate((l) => window.__lvt.tileToClient(l, 5), lane);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await nextFrames(page, 3);
  };
  return {
    name,
    url: `/?scene=battle&side=${side}&skill=medium&seed=7`,
    viewport: { width: 1024, height: 704 },
    frames: [
      { suffix: 'aim', run: aimAndFire },
      {
        suffix: 'fire1',
        run: async (page) => {
          await page.mouse.down();
          await page.mouse.up();
          await page.waitForTimeout(260);
        },
      },
      { suffix: 'fire2', run: (page) => page.waitForTimeout(260) },
      { suffix: 'fire3', run: (page) => page.waitForTimeout(400) },
    ],
  };
}

/** The battle HUD as `side` at 1024x704, 46 s in with every power ready, an aimed spell picked and the mouse over `tile`. */
function hudBattle(name, side, [lane, col]) {
  return {
    name,
    url: `/?scene=battle&side=${side}&skill=medium&seed=7`,
    viewport: { width: 1024, height: 704 },
    steps: async (page) => {
      await page.evaluate(() => window.__lvt.portraits);
      // Both dealt spells ready, and one of them aimed, so the area shows.
      await page.evaluate((s) => {
        const players = window.__lvt.session.controller.match.state.players[s];
        const aimed = { plants: 'thunderbolt', zombies: 'meteor' }[s];
        const unaimed = { plants: 'sunShower', zombies: 'brainFeast' }[s];
        players.spells = [{ key: aimed, timer: 1 }, { key: unaimed, timer: 1 }];
      }, side);
      await battleAt(page, 46);
      await page.click('[data-spell]:first-child');
      const at = await page.evaluate(([l, c]) => window.__lvt.tileToClient(l, c), [lane, col]);
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await settleUi(page);
    },
  };
}

/** hud-gallery-<view>-<size> (screens, and iPad Safari windows with the bars showing): ten and three cards with hero and spells for both sides, and the states sheet. */
function hudGallery() {
  const sizes = [['1024', 1024, 768], ['1180', 1180, 820], ['1440', 1440, 900], ['1024x704', 1024, 704], ['1180x746', 1180, 746]];
  const views = [
    ['plants10', 'side=plants&cards=10'],
    ['zombies10', 'side=zombies&cards=10&hero=charging'],
    ['plants3', 'side=plants&cards=3&hero=selected'],
    ['states', 'view=states'],
  ];
  const quit = {
    name: 'hud-gallery-quit-1024',
    url: '/?scene=hud-gallery&side=plants&cards=10',
    viewport: { width: 1024, height: 768 },
    steps: async (page) => {
      await page.waitForFunction(() => window.__lvt.hudReady?.then(() => true), null, { timeout: 20_000 });
      await page.click('[data-hud="pause"]');
      await page.click('[data-action="quit"]');
      await settleUi(page);
    },
  };
  return [quit, ...sizes.flatMap(([label, width, height]) => views.map(([name, query]) => ({
    name: `hud-gallery-${name}-${label}`,
    url: `/?scene=hud-gallery&${query}`,
    viewport: { width, height },
    steps: async (page) => {
      await page.waitForFunction(() => window.__lvt.hudReady?.then(() => true), null, { timeout: 20_000 });
      await settleUi(page);
    },
  })))];
}

/** Waits for the card portraits, then plays the title's demo battle on to `seconds`. */
async function demoAt(page, seconds) {
  await page.evaluate(() => window.__lvt.portraits);
  await page.evaluate((s) => window.__lvt.demo?.advance(Math.round(s * 30)), seconds);
  await settleUi(page);
}

/** Waits for the portraits, then fast-forwards the battle to `seconds`. */
async function battleAt(page, seconds) {
  await page.evaluate(() => window.__lvt.portraits);
  await page.evaluate((s) => window.__lvt.fastForward(Math.round(s * 30)), seconds);
  await nextFrames(page, 10);
}

/** Makes a player on the page's fake cloud through the session (as the taps would) and opens Home. */
async function asPlayer(page, name, picture, slot) {
  await page.evaluate(async ([n, p, sl]) => {
    const r = await window.__lvt.players.create(n, p, '123', sl ?? undefined);
    if (typeof r !== 'object') throw new Error(`create ${n}: ${r}`);
    window.__lvt.go({ name: 'home' });
  }, [name, picture, slot ?? null]);
  await settleUi(page);
}

/** A player with `coins` and Marketplace `upgrades`, on Home. */
async function marketPlayer(page, name, picture, slot, coins, upgrades) {
  await asPlayer(page, name, picture, slot);
  await page.evaluate(([c, u]) => window.__lvt.players.update((v) => ({ ...v, coins: c, upgrades: u })), [coins, upgrades]);
  await settleUi(page);
}

/** Every cloud call from now on answers "offline" (the device copies stay). */
function goOffline(page) {
  return page.evaluate(() => {
    window.__lvt.players.configure({ cloud: new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : async () => 'offline') }) });
  });
}

/** Several players, then back to the pictures with nobody logged in. */
async function manyPlayers(page, n) {
  const pics = ['sunflower', 'hotTopic', 'torchwood', 'necromancer', 'kernelPult', 'cowboyZombie', 'mangoPult', 'skeletonArcher', 'cherryBomber', 'desertZombie'];
  await page.evaluate(async ([count, pictures]) => {
    const names = ['Mia', 'Ben', 'Ella', 'Max', 'Sofia', 'Jakub', 'Nina', 'Adam', 'Ema', 'Leo', 'Zoe', 'Tom', 'Lili', 'Oskar'];
    const s = window.__lvt.players;
    for (const [slot, name, pic] of [['p01', 'Lukas', 'peashooter'], ['p02', 'Toby', 'brainEater']]) {
      await s.create(name, pic, '123', slot);
      s.logout();
    }
    for (let i = 0; i < count; i++) {
      const r = await s.create(`${names[i % names.length]}${i >= names.length ? i : ''}`, pictures[i % pictures.length], '123');
      if (typeof r !== 'object') throw new Error(`create ${i}: ${r}`);
      s.logout();
    }
    await s.login('p01', '123');
    s.logout();
    window.__lvt.go({ name: 'players' });
  }, [n, pics]);
  await settleUi(page);
}

/** Each player screen at the iPad (1024x704) and the laptop (1440x900) size. */
function playerShots() {
  const sizes = [['ipad', { width: 1024, height: 704 }], ['laptop', { width: 1440, height: 900 }]];
  const base = [
    ['players-first', async (page) => {
      await page.click('[data-action="play"]');
      await settleUi(page);
    }],
    ['players-few', async (page) => {
      await manyPlayers(page, 3);
    }],
    ['players-full', async (page) => {
      await manyPlayers(page, 28);
    }],
    ['players-offline', async (page) => {
      await manyPlayers(page, 2);
      await page.evaluate(() => { window.__lvt.go({ name: 'title' }); });
      await goOffline(page);
      await page.click('[data-action="play"]');
      await settleUi(page);
    }],
    ['pinpad', async (page) => {
      await manyPlayers(page, 2);
      await page.click('[data-player="p01"]');
      await page.click('[data-key="4"]');
      await settleUi(page);
    }],
    ['pinpad-wrong', async (page) => {
      await manyPlayers(page, 2);
      await page.click('[data-player="p02"]');
      // Shot only: hold the shake (its 420 ms clear-up waits) and freeze it mid-swing.
      await page.evaluate(() => {
        const st = window.setTimeout;
        window.setTimeout = (fn, ms, ...a) => st(fn, ms === 420 ? 60_000 : ms, ...a);
      });
      for (const d of '999') await page.click(`[data-key="${d}"]`);
      await page.waitForFunction(() => document.querySelector('[data-pin-boxes].is-wrong') !== null, null, { polling: 'raf' });
      await page.waitForTimeout(90);
      await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    }],
    ['pinpad-locked', async (page) => {
      await manyPlayers(page, 2);
      await page.click('[data-player="p01"]');
      for (const pin of ['000', '001', '002']) {
        for (const d of pin) await page.click(`[data-key="${d}"]`);
        await page.waitForTimeout(500);
      }
      await page.waitForSelector('[data-lock]');
      await settleUi(page);
    }],
    ['create-choose', async (page) => {
      await page.click('[data-action="play"]');
      await page.click('[data-player="p02"]');
      await page.waitForSelector('[data-pin-step="1"]');
      await page.click('[data-key="7"]');
      await settleUi(page);
    }],
    ['create-repeat', async (page) => {
      await page.click('[data-action="play"]');
      await page.click('[data-player="p02"]');
      await page.waitForSelector('[data-pin-step="1"]');
      for (const d of '777') await page.click(`[data-key="${d}"]`);
      await page.waitForSelector('[data-pin-step="2"]');
      await page.click('[data-key="7"]');
      await settleUi(page);
    }],
    ['create-picture', async (page) => {
      await page.click('[data-action="play"]');
      await page.click('[data-action="new-player"]');
      await page.waitForSelector('[data-pick]');
      await settleUi(page);
    }],
    ['create-name', async (page) => {
      await page.click('[data-action="play"]');
      await page.click('[data-action="new-player"]');
      await page.click('[data-pick="hotTopic"]');
      for (const ch of 'MIA') await page.click(`[data-letter="${ch}"]`);
      await settleUi(page);
    }],
    ['create-offline', async (page) => {
      await goOffline(page);
      await page.click('[data-action="play"]');
      await page.click('[data-action="new-player"]');
      await page.waitForSelector('[data-step="offline"]');
      await settleUi(page);
    }],
    ['home', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.evaluate(() => window.__lvt.players.update((s) => ({ ...s, coins: 1250 })));
      await settleUi(page);
    }],
    ['home-toby', async (page) => {
      await asPlayer(page, 'Toby', 'brainEater', 'p02');
    }],
    ['grownup-code', async (page) => {
      await page.click('[data-action="play"]');
      const lock = await page.waitForSelector('[data-action="grownup"]');
      const box = await lock.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(2200);
      await page.mouse.up();
      await page.waitForSelector('[data-screen="grownup"]');
      for (const d of '24') await page.click(`[data-key="${d}"]`);
      await settleUi(page);
    }],
    ['grownup-list', async (page) => {
      await manyPlayers(page, 4);
      await page.evaluate(async () => {
        await window.__lvt.players.setGrownUp('246802');
        window.__lvt.go({ name: 'grownup' });
      });
      await page.waitForSelector('[data-pin-boxes]');
      for (const d of '246802') await page.click(`[data-key="${d}"]`);
      await page.waitForSelector('[data-row]');
      await settleUi(page);
    }],
    ['result-coins', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="play"]');
      await page.click('[data-play="quick"]');
      await page.click('[data-action="start"]');
      await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 30_000 });
      await battleAt(page, 30);
      await page.evaluate(() => {
        window.__lvt.damageBase('zombies', 1e9);
        window.__lvt.fastForward(1);
      });
      await page.waitForFunction(() => window.__lvt.session?.resultReady.value === true, null, { timeout: 15_000 });
      await page.waitForSelector('[data-coins-earned]');
      await page.waitForTimeout(1600);
    }],
  ];
  return sizes.flatMap(([size, viewport]) => base.map(([name, steps]) => ({
    name: `${name}-${size}`,
    url: '/',
    viewport,
    steps: async (page) => {
      await page.evaluate(() => window.__lvt.portraits);
      await steps(page);
    },
  })));
}

/** Lets stepped UI animations (pops, drops) finish. */
async function settleUi(page) {
  await page.waitForTimeout(900);
  await nextFrames(page, 3);
}

/** A battle 40 s in as `side`, with `card` selected by a real click and the mouse over `tile`, so the ghost shows. */
function hud(name, side, card, [lane, col]) {
  return {
    name,
    url: `/?scene=battle&side=${side}&skill=medium&seed=7`,
    steps: async (page) => {
      await battleAt(page, 40);
      await page.click(`[data-card="${card}"]`);
      const at = await page.evaluate(([l, c]) => window.__lvt.tileToClient(l, c), [lane, col]);
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await settleUi(page);
    },
  };
}

/** A match decided by knocking `loser`'s base down, after the fall, with the result panel up. */
function result(name, loser) {
  return {
    name,
    url: '/?scene=battle&side=plants&skill=medium&seed=7',
    steps: async (page) => {
      await battleAt(page, 30);
      await page.evaluate((l) => {
        window.__lvt.damageBase(l, 1e9);
        window.__lvt.fastForward(1);
      }, loser);
      await page.waitForFunction(() => window.__lvt.session?.resultReady.value === true, null, { timeout: 15_000 });
      await settleUi(page);
    },
  };
}

/**
 * The winners' cheer before the result panel: `loser`'s base knocked down 60 s into a battle
 * played as `side`, shot a second into the confetti, with the camera on the winners' side.
 */
function cheer(name, side, loser) {
  return {
    name,
    url: `/?scene=battle&side=${side}&skill=medium&seed=7`,
    steps: async (page) => {
      await battleAt(page, 60);
      await page.evaluate((l) => {
        window.__lvt.damageBase(l, 1e9);
        window.__lvt.fastForward(1);
      }, loser);
      await page.waitForFunction(() => window.__lvt.session?.view.cheering === true, null, { timeout: 15_000 });
      await page.waitForTimeout(1000);
    },
  };
}

/**
 * A card portrait of each of `levels` of `model`, saved as `<name>-L1.png` and so on. Zombies
 * face the other way, so their cards turn the camera the other way (`yaw`).
 */
function portraits(name, model, levels = [1, 2, 3, 4, 5], yaw = 32) {
  return {
    name,
    url: portraitUrl(levels[0], model, yaw),
    viewport: { width: 88, height: 112 },
    frames: levels.map((level, i) => ({
      suffix: `L${level}`,
      run: (page) => (i === 0 ? Promise.resolve() : open(page, portraitUrl(level, model, yaw))),
    })),
  };
}

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const OUT_DIR = path.join(ROOT, 'artifacts', 'shots');
/** The dev server's port: 5273 unless LVT_PORT names another (a second checkout's server keeps its own). */
const PORT = Number(process.env.LVT_PORT) || 5273;
const ORIGIN = `http://localhost:${PORT}`;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const READY_TIMEOUT_MS = 20_000;
const FLAT_THRESHOLD = 0.999; // share of sampled pixels that is one colour

const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, 'localhost');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

/** The project root the server on the dev port reports (see vite.config.ts), or null. */
async function servedRoot() {
  try {
    const res = await fetch(`${ORIGIN}/__lvt/root`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.text()).trim();
    // A Vite SPA fallback answers unknown paths with index.html, so check the shape too.
    if (!res.ok || !res.headers.get('content-type')?.startsWith('text/plain') || !path.isAbsolute(body)) return null;
    try {
      return realpathSync(body);
    } catch {
      return body;
    }
  } catch {
    return null;
  }
}

/** The dev server this tool started (null when it reused one or none is needed yet). */
let server = null;
/** The browser this tool launched, so a signal can close it. */
let browser = null;

/** SIGTERM the dev server we started, then SIGKILL it if it is still alive after 3 s. */
function stopServer() {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => (clearTimeout(killTimer), resolve()));
    child.kill('SIGTERM');
  });
}

/**
 * Reuses the dev server on the dev port if it serves this checkout, refuses if it serves
 * another one, and otherwise starts `vite` here.
 */
async function ensureDevServer() {
  if (await portOpen()) {
    const served = await servedRoot();
    if (served === ROOT) return;
    throw new Error(
      served === null
        ? `Port ${PORT} is in use by something that does not answer ${ORIGIN}/__lvt/root, so it is not this ` +
            `project's dev server.\n  this checkout: ${ROOT}\nStop whatever listens on port ${PORT} and retry.`
        : `Port ${PORT} is served by a different checkout.\n  this checkout:   ${ROOT}\n` +
            `  server on ${PORT}:  ${served}\nStop that dev server and retry.`,
    );
  }
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  let exited = false;
  child.once('exit', () => (exited = true));
  for (let i = 0; i < 150; i++) {
    if (exited) throw new Error(`dev server exited early:\n${log}`);
    if (await portOpen()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server did not open port ${PORT}:\n${log}`);
}

/** Returns the WebGL2 renderer string, or null if no WebGL2 context can be created. */
async function probeWebGL2(target) {
  const page = await target.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
  } finally {
    await page.close();
  }
}

/** Launches Chromium with GPU flags, falling back to software GL if WebGL2 is missing. */
async function launchBrowser(headed) {
  for (const [label, args] of [['metal', GPU_ARGS], ['swiftshader (fallback)', SOFTWARE_ARGS]]) {
    // Signals are handled below, so the server we started is stopped as well.
    const candidate = await chromium.launch({
      headless: !headed,
      args,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    browser = candidate;
    let failure = '';
    const renderer = await probeWebGL2(candidate).catch((error) => {
      failure = ` (probe failed: ${error instanceof Error ? error.message : error})`;
      return null;
    });
    if (renderer) {
      console.log(`WebGL2 renderer [${label}]: ${renderer}`);
      return;
    }
    console.log(`No WebGL2 with ${label} flags: ${args.join(' ')}${failure}`);
    browser = null;
    await candidate.close();
  }
  throw new Error('No WebGL2 context available with GPU or software flags');
}

/** Share of sampled pixels held by the most common colour in a PNG (1 = flat). */
function dominantShare(page, png) {
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts = new Map();
    let sampled = 0;
    for (let i = 0; i < data.length; i += 28) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sampled++;
    }
    let top = 0;
    for (const count of counts.values()) top = Math.max(top, count);
    return { share: top / sampled, colours: counts.size };
  }, png.toString('base64'));
}

/** Shows the lawn's tile and lane highlights, then waits for them to be drawn. */
async function highlight(page, tile, lane) {
  await page.evaluate(
    ([t, l]) => {
      window.__lvt.lawn.highlightTile(...t);
      window.__lvt.lawn.highlightLane(...l);
    },
    [tile, lane],
  );
  await nextFrames(page, 3);
}

function portraitUrl(level, model = 'peashooter', yaw = 32) {
  return `/?scene=gallery&model=${model}&level=${level}&portrait=1&pitch=20&yaw=${yaw}&t=0.4`;
}

/** `url` with `debug` added, which a production build needs before it shows `window.__lvt`. */
/** Every shot opens with the test hooks and on the fake cloud (never the children's real data). */
function withDebug(url) {
  return url.includes('?') ? url.replace('?', '?debug&cloud=fake&') : `${url}?debug&cloud=fake`;
}

/** Loads a scene and waits until it has drawn and its fonts are in. */
async function open(page, url) {
  await page.goto(ORIGIN + withDebug(url), { waitUntil: 'load' });
  await page
    .waitForFunction(() => window.__lvt?.ready.then(() => true), null, { timeout: READY_TIMEOUT_MS })
    .catch((error) => {
      throw new Error(`__lvt.ready did not resolve within ${READY_TIMEOUT_MS} ms (${String(error.message).split('\n')[0]})`);
    });
  await page.evaluate(() => document.fonts.ready);
}

/** Freezes every model in the gallery at `seconds` into `clip`, then waits for it to be drawn. */
async function pose(page, clip, seconds) {
  await page.evaluate(([c, t]) => window.__lvt.gallery.pose(c, t), [clip, seconds]);
  await nextFrames(page, 3);
}

/** Freezes every model in the gallery at `share` of its own `clip`, then waits for it to be drawn. */
async function posePhase(page, clip, share) {
  await page.evaluate(([c, s]) => window.__lvt.gallery.posePhase(c, s), [clip, share]);
  await nextFrames(page, 3);
}

/** Resolves after the page has drawn `count` more animation frames. */
function nextFrames(page, count) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const tick = () => (n-- > 0 ? requestAnimationFrame(tick) : resolve());
        tick();
      }),
    count,
  );
}

async function shoot(scenario) {
  const page = await browser.newPage({ viewport: scenario.viewport ?? DEFAULT_VIEWPORT, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    // The gallery warns when a scenario names a model that is not registered: a typo there
    // would otherwise leave a shot quietly missing a unit.
    if (msg.type() === 'warning' && msg.text().startsWith('[gallery]')) problems.push(`console warning: ${msg.text()}`);
  });
  try {
    await open(page, scenario.url);
    await scenario.steps?.(page);

    await mkdir(OUT_DIR, { recursive: true });
    for (const frame of scenario.frames ?? [{ suffix: '', run: async () => {} }]) {
      await frame.run(page);

      // Judge the 3D canvas on its own: hide the UI layer so text cannot mask a blank canvas.
      const hideUi = await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
      const { share, colours } = await dominantShare(page, await page.screenshot({ type: 'png' }));
      await hideUi.evaluate((el) => el.remove());
      if (share > FLAT_THRESHOLD) problems.push(`canvas is one flat colour (${(share * 100).toFixed(2)}% of pixels)`);

      const file = path.join(OUT_DIR, `${scenario.name}${frame.suffix ? `-${frame.suffix}` : ''}.png`);
      await writeFile(file, await page.screenshot({ type: 'png' }));
      console.log(`[${scenario.name}] ${path.relative(ROOT, file)} (${colours} colours, ${(share * 100).toFixed(1)}% dominant)`);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    await page.close();
  }
  for (const problem of problems) console.error(`[${scenario.name}] ${problem}`);
  return problems.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed');
  const names = args.filter((a) => !a.startsWith('--'));
  const chosen = names.length ? names.map((n) => SCENARIOS.find((s) => s.name === n) ?? n) : SCENARIOS;
  const unknown = chosen.filter((s) => typeof s === 'string');
  if (unknown.length) {
    console.error(`Unknown scenario: ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
    return 2;
  }

  let ok = true;
  try {
    await ensureDevServer();
    await launchBrowser(headed);
    for (const scenario of chosen) ok = (await shoot(scenario)) && ok;
  } finally {
    await browser?.close();
    await stopServer();
  }
  return ok ? 0 : 1;
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, async () => {
    await browser?.close().catch(() => {});
    await stopServer();
    process.exit(code);
  });
}

process.exitCode = await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  return 1;
});

/**
 * Players with wins against the computer, as other devices would have made them, then Lukas
 * logged in (with `lukasWins`). Leaves Lukas logged in and on Home.
 */
async function boardPlayers(page, lukasWins) {
  await page.evaluate(async (mine) => {
    const s = window.__lvt.players;
    const others = [['Mia', 'hotTopic', 9], ['Ben', 'sunflower', 7], ['Ella', 'necromancer', 7], ['Max', 'kernelPult', 4], ['Sofia', 'cowboyZombie', 2], ['Jakub', 'torchwood', 1], ['Nina', 'mangoPult', 0]];
    for (const [name, pic, wins] of others) {
      const r = await s.create(name, pic, '123');
      if (typeof r !== 'object') throw new Error(`create ${name}: ${r}`);
      if (wins > 0) s.update((v) => ({ ...v, computerWins: wins, versusWins: Math.floor(wins / 3) }));
      await s.flush();
      s.logout();
    }
    for (const [slot, name, pic, wins] of [['p02', 'Toby', 'brainEater', 3], ['p01', 'Lukas', 'peashooter', mine]]) {
      const r = await s.create(name, pic, '123', slot);
      if (typeof r !== 'object') throw new Error(`create ${name}: ${r}`);
      if (wins > 0) s.update((v) => ({ ...v, computerWins: wins }));
      await s.flush();
      if (slot === 'p02') s.logout();
    }
    const rows = await window.__lvt.board.fetch();
    if (!rows.rows.some((r) => r.slot === 'p01' && r.computerWins === mine)) throw new Error(`board: ${JSON.stringify(rows)}`);
    window.__lvt.go({ name: 'home' });
  }, lukasWins);
}

/** The leaderboard, the Almanac and the Marketplace at the iPad (1024x704) and laptop (1440x900) sizes. */
function progressShots() {
  const sizes = [['ipad', { width: 1024, height: 704 }], ['laptop', { width: 1440, height: 900 }]];
  const base = [
    ['board', async (page) => {
      await boardPlayers(page, 5);
      await page.click('[data-home="leaderboard"]');
      await page.waitForSelector('[data-row="p01"]', { state: 'attached' });
      await settleUi(page);
    }],
    ['board-versus', async (page) => {
      await boardPlayers(page, 5);
      await page.click('[data-home="leaderboard"]');
      await page.waitForSelector('[data-row="p01"]', { state: 'attached' });
      await page.click('[data-tab="versus"]');
      await settleUi(page);
    }],
    ['board-empty', async (page) => {
      await boardPlayers(page, 5);
      await page.click('[data-home="leaderboard"]');
      await page.waitForSelector('[data-row="p01"]', { state: 'attached' });
      await page.click('[data-tab="stars"]');
      await settleUi(page);
    }],
    ['board-offline', async (page) => {
      await boardPlayers(page, 5);
      await page.click('[data-home="leaderboard"]');
      await page.waitForSelector('[data-row="p01"]', { state: 'attached' });
      await page.click('[data-action="back"]');
      await page.evaluate(() => {
        window.__lvt.board.configure({ cloud: new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : async () => 'offline') }) });
      });
      await page.click('[data-home="leaderboard"]');
      await page.waitForSelector('[data-offline]');
      await settleUi(page);
    }],
    ['result-rankup', async (page) => {
      await boardPlayers(page, 6);
      await page.click('[data-home="play"]');
      await page.click('[data-play="quick"]');
      await page.click('[data-action="start"]');
      await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 30_000 });
      await battleAt(page, 30);
      await page.evaluate(() => {
        window.__lvt.damageBase('zombies', 1e9);
        window.__lvt.fastForward(1);
      });
      await page.waitForFunction(() => window.__lvt.session?.resultReady.value === true, null, { timeout: 15_000 });
      await page.waitForSelector('[data-rank-up]');
      await page.waitForTimeout(1800);
    }],
    ['almanac', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="almanac"]');
      await page.waitForSelector('[data-unit="peashooter"][aria-pressed="true"]');
      await page.waitForTimeout(1200);
      await nextFrames(page, 3);
    }],
    ['almanac-zombie', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="almanac"]');
      await page.click('[data-unit="cowboyZombie"]');
      await page.click('[data-level="5"]');
      await page.waitForTimeout(1200);
      await nextFrames(page, 3);
    }],
    ['almanac-bunker', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="almanac"]');
      await page.click('[data-unit="avocadoBunker"]');
      await page.click('[data-level="3"]');
      await page.waitForTimeout(1200);
      await nextFrames(page, 3);
    }],
    ['almanac-upgraded', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.evaluate(() => window.__lvt.players.update((v) => ({ ...v, upgrades: { ...v.upgrades, peashooter: 8 } })));
      await page.click('[data-home="almanac"]');
      await page.click('[data-level="3"]');
      await page.waitForTimeout(1200);
      await nextFrames(page, 3);
    }],
    // Marketplace: Lukas with coins and a few levels bought (one at the top, gold); a buy caught mid-hop.
    ['market', async (page) => {
      await marketPlayer(page, 'Lukas', 'peashooter', 'p01', 1650, { peashooter: 10, sunflower: 3, walnutBomb: 1, kernelPult: 6, potatoMine: 2 });
      await page.click('[data-home="marketplace"]');
      await page.waitForSelector('[data-card="peashooter"]');
      await settleUi(page);
      await page.click('[data-buy="mangoPult"]');
      // Hold the hop at its top (25% of 420 ms).
      await page.evaluate(() => {
        for (const a of document.querySelector('[data-card="mangoPult"] .market__pic').getAnimations()) { a.pause(); a.currentTime = 105; }
      });
    }],
    // Toby on the zombie tab with too few coins: a tap on "+" caught mid-shake.
    ['market-zombies', async (page) => {
      await marketPlayer(page, 'Toby', 'brainEater', 'p02', 240, { brainEater: 4, veryFastWalker: 1, necromancer: 10 });
      await page.click('[data-home="marketplace"]');
      await page.waitForSelector('[data-card="brainEater"]');
      await settleUi(page);
      await page.click('[data-buy="hotTopic"]');
      await page.click('[data-buy="brainEater"]');
      // Hold the shake at its first swing (20% of 420 ms).
      await page.evaluate(() => {
        for (const a of document.querySelector('[data-card="brainEater"]').getAnimations()) { a.pause(); a.currentTime = 84; }
      });
    }],
    ['almanac-minion', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="almanac"]');
      await page.click('[data-unit="boneMinion"]');
      await page.click('[data-action="act"]');
      await page.waitForTimeout(300);
      await nextFrames(page, 3);
    }],
  ];
  return sizes.flatMap(([size, viewport]) => base.map(([name, steps]) => ({
    name: `${name}-${size}`,
    url: '/',
    viewport,
    steps: async (page) => {
      await page.evaluate(() => window.__lvt.portraits);
      await steps(page);
    },
  })));
}

/** Stars on `side` for the levels `1..n` (each given), as a finished level would have saved them. */
function starsUpTo(side, list) {
  const letter = side === 'plants' ? 'p' : 'z';
  return Object.fromEntries(list.map((n, i) => [`${letter}1-${i + 1}`, n]));
}

/**
 * Lukas with Adventure progress, on the map of `side` (and the card of `card`, if given). Every
 * tutorial step is marked done except those in `teach` (ids), so a level shows only those.
 */
async function onMap(page, side, stars, unlocked, card, teach = []) {
  await asPlayer(page, 'Lukas', 'peashooter', 'p01');
  await page.evaluate(([sd, st, un, keep]) => window.__lvt.players.update((v) => ({
    ...v, [sd]: { stars: st, unlocked: un },
    teached: window.__lvt.levels.flatMap((l) => (l.teaches ?? []).map((t) => t.id)).filter((id) => !keep.includes(id)),
  })), [side, stars, unlocked, teach]);
  await page.click('[data-home="play"]');
  await page.click('[data-play="adventure"]');
  await page.click(`[data-side="${side}"]`);
  await page.waitForSelector('[data-screen="map"]');
  if (card) await page.click(`[data-stone="${card}"]`);
  await settleUi(page);
}

/** From the map, `id` started by its card's play button; waits for the fight. */
async function inLevel(page, side, stars, unlocked, id, teach = []) {
  await onMap(page, side, stars, unlocked, id, teach);
  await page.click('[data-action="start-level"]');
  await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 30_000 });
  await page.waitForSelector('[data-banner]', { state: 'detached' });
}

/** Lukas on Home, then Play → Free Play → `side`: straight into the run; waits for the fight. */
async function inFreePlay(page, side) {
  await asPlayer(page, 'Lukas', 'peashooter', 'p01');
  await page.evaluate(() => window.__lvt.players.update((v) => ({ ...v, bestWave: 2 })));
  await page.click('[data-home="play"]');
  await page.click('[data-play="free"]');
  await page.click(`[data-side="${side}"]`);
  await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 30_000 });
  await page.waitForSelector('[data-banner="ready"], [data-banner="fight"]', { state: 'detached' });
}

/** Waits for the tutorial's glove to stand at its target, holding, at the bottom of its tap. */
async function gloveStill(page) {
  await page.waitForSelector('[data-tutorial] [data-glove][data-glove-x][data-holding="true"]', { state: 'attached', timeout: 15_000 });
  await nextFrames(page, 6);
  await page.evaluate(() => {
    // Every glove on the same frame of its tap: the press (the bottom of the hop) is the clearest still.
    for (const a of document.getAnimations()) if (a.animationName === 'tut-tap') { a.pause(); a.currentTime = 450; }
  });
  await nextFrames(page, 2);
}

/** The running level fast-forwarded to `seconds`. */
async function levelAt(page, seconds) {
  await page.evaluate((s) => window.__lvt.fastForward(Math.round(s * 30)), seconds);
  await nextFrames(page, 10);
  await page.waitForTimeout(300);
}

/** The running level decided against `loser` (a little play first), then `wait` ms of the result show. */
async function levelEnd(page, loser, wait) {
  await page.evaluate((l) => {
    window.__lvt.fastForward(300);
    window.__lvt.damageBase(l, 99999);
    window.__lvt.fastForward(1);
  }, loser);
  await page.waitForSelector('[data-level-result]', { timeout: 30_000 });
  await page.waitForTimeout(wait);
  await nextFrames(page, 3);
}

/** The Play menu, the map and the level card at the iPad (1024x704) and laptop (1440x900) sizes. */
function adventureShots() {
  const sizes = [['ipad', { width: 1024, height: 704 }], ['laptop', { width: 1440, height: 900 }]];
  const base = [
    ['play-menu', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="play"]');
      await settleUi(page);
    }],
    ['play-side', async (page) => {
      await asPlayer(page, 'Lukas', 'peashooter', 'p01');
      await page.click('[data-home="play"]');
      await page.click('[data-play="adventure"]');
      await settleUi(page);
    }],
    ['play-guest', async (page) => {
      await page.evaluate(() => window.__lvt.go({ name: 'play' }));
      await settleUi(page);
    }],
    ['map-fresh', (page) => onMap(page, 'plants', {}, [])],
    ['map-midway', (page) => onMap(page, 'plants', starsUpTo('plants', [3, 2, 3, 1]), ['potatoMine'])],
    ['map-done', (page) => onMap(page, 'plants', starsUpTo('plants', [3, 3, 2, 3, 3, 1, 2, 3]), ['potatoMine', 'kernelPult'])],
    ['map-zombies', (page) => onMap(page, 'zombies', starsUpTo('zombies', [2, 1]), [])],
    ['level-card-battle', (page) => onMap(page, 'plants', {}, [], 'p1-1')],
    ['level-card-survive', (page) => onMap(page, 'plants', starsUpTo('plants', [3, 2]), [], 'p1-3')],
    ['level-card-boss', (page) => onMap(page, 'plants', starsUpTo('plants', [3, 2, 3, 1, 2, 3, 1]), ['potatoMine', 'kernelPult'], 'p1-8')],
    ['level-card-locked', (page) => onMap(page, 'plants', starsUpTo('plants', [3]), [], 'p1-5')],
    // Task 5: playing a level.
    // Survive p1-6 at 100 s: the clock bar, the wave bar with the head marching up to the big wave's flag.
    ['level-survive-hud', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3, 3, 3, 3, 3]), ['potatoMine'], 'p1-6');
      await levelAt(page, 100);
    }],
    // Breakthrough z1-3 at 40 s: the clock with its two star marks.
    ['level-breakthrough-hud', async (page) => {
      await inLevel(page, 'zombies', starsUpTo('zombies', [3, 3]), [], 'z1-3');
      await levelAt(page, 40);
    }],
    // Conveyor p1-5 at 22 s: the belt in place of the tray, a card picked, the mouse over a tile.
    ['level-conveyor-belt', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3, 3, 3, 3]), ['potatoMine'], 'p1-5');
      await levelAt(page, 22);
      await page.click('[data-belt][data-slot="1"]');
      const at = await page.evaluate(() => window.__lvt.tileToClient(2, 3));
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await nextFrames(page, 6);
    }],
    // A first win of p1-1: three stars popped, 90 coins fallen.
    ['level-result-3stars', async (page) => {
      await inLevel(page, 'plants', {}, [], 'p1-1');
      await levelEnd(page, 'zombies', 3200);
    }],
    // A first win of p1-3 with the base at 60%: two stars, then the Potato Mine on the turntable.
    ['level-result-unlock', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3, 3]), [], 'p1-3');
      await page.evaluate(() => {
        const s = window.__lvt.session.controller.match.state;
        window.__lvt.damageBase('plants', Math.round(s.baseMaxHp.plants * 0.4));
      });
      await levelEnd(page, 'zombies', 5200);
    }],
    // Task 6: the tutorial's glove. p1-1 at its start: the glove on the Peashooter card, the rest dimmed.
    ['tutorial-card', async (page) => {
      await inLevel(page, 'plants', {}, [], 'p1-1', ['p1-1.card', 'p1-1.tile']);
      await gloveStill(page);
    }],
    // p1-1, the card picked: the glove on the marked tile.
    ['tutorial-tile', async (page) => {
      await inLevel(page, 'plants', {}, [], 'p1-1', ['p1-1.card', 'p1-1.tile']);
      await page.evaluate(() => window.__lvt.session.controller.select('peashooter'));
      await gloveStill(page);
    }],
    // p1-3: a Peashooter on the lawn, its card picked again: the glove on the Peashooter with the level-up arrow.
    ['tutorial-merge', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3, 3]), [], 'p1-3', ['p1-3.card', 'p1-3.tile', 'p1-3.merge-card', 'p1-3.merge']);
      await page.evaluate(() => {
        const lvt = window.__lvt;
        const c = lvt.session.controller;
        c.select('peashooter');
        c.click({ lane: 2, col: 1 }, null);
        lvt.fastForward(30 * 20);
        c.select('peashooter');
      });
      await gloveStill(page);
    }],
    // p1-2 at 45 s: the hero is ready, the glove on Lukas's button.
    ['tutorial-hero', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3]), [], 'p1-2', ['p1-2.hero']);
      await page.evaluate(() => {
        const lvt = window.__lvt;
        const c = lvt.session.controller;
        c.select('sunflower');
        c.click({ lane: 1, col: 0 }, null);
        lvt.fastForward(30 * 6);
        c.select('peashooter');
        c.click({ lane: 1, col: 1 }, null);
        lvt.fastForward(30 * 46);
      });
      await gloveStill(page);
    }],
    // Task 7b: Free Play. Survive 75 s in (wave 4): the flag counter and the next wave's ring, a garden planted.
    ['freeplay-survive', async (page) => {
      await inFreePlay(page, 'plants');
      await page.evaluate(() => {
        const lvt = window.__lvt;
        const c = lvt.session.controller;
        const s = c.match.state;
        // A shot, not a match: the base holds and the garden grows.
        const ff = (sec) => { for (let i = 0; i < sec; i++) { s.baseHp.plants = s.baseMaxHp.plants; lvt.fastForward(30); } };
        const plant = (card, lane, col) => {
          s.players.plants.energy = Math.max(s.players.plants.energy, 300);
          c.select(card); c.click({ lane, col }, null); lvt.fastForward(2);
        };
        plant('sunflower', 1, 0); plant('sunflower', 3, 0);
        ff(6);
        for (const lane of [0, 1, 2, 3, 4]) { ff(6); plant('peashooter', lane, 2); }
        ff(4);
        plant('walnutBomb', 2, 5); plant('walnutBomb', 0, 5);
        for (let i = 0; i < 5; i++) { ff(6); plant('peashooter', i, 3); }
        // Halfway to the next wave: the ring half lit.
        while (s.waveTimer !== 300) { s.baseHp.plants = s.baseMaxHp.plants; lvt.fastForward(1); }
        c.select(null);
      });
      await page.waitForTimeout(1800); // the wave banner has gone
      await nextFrames(page, 6);
    }],
    // Breakthrough: one garden broken (+30 on the clock), garden 2 standing, zombies on their way.
    ['freeplay-breakthrough', async (page) => {
      await inFreePlay(page, 'zombies');
      await page.evaluate(() => {
        const lvt = window.__lvt;
        const c = lvt.session.controller;
        lvt.fastForward(30 * 3);
        for (const lane of [0, 2, 4]) { c.select('brainEater'); c.click({ lane, col: 9 }, null); lvt.fastForward(30 * 3); }
        c.select('veryFastWalker'); c.click({ lane: 1, col: 9 }, null); lvt.fastForward(30 * 2);
        // The garden falls: +30 on the clock, garden 2 laid.
        lvt.damageBase('plants', 999999);
        lvt.fastForward(3);
      });
      await nextFrames(page, 4);
      await page.waitForTimeout(250); // the +30 at its biggest
    }],
    // The tenth wave's banner: the flag, 10, and the big one's silhouette.
    ['freeplay-wave-banner', async (page) => {
      await inFreePlay(page, 'plants');
      await page.evaluate(() => {
        const lvt = window.__lvt;
        lvt.fastForward(30 * 11);
        const s = lvt.session.controller.match.state;
        s.wave = 9;
        s.waveTimer = 1;
        lvt.fastForward(1);
      });
      await page.waitForTimeout(500); // the band has slid in
      await nextFrames(page, 2);
    }],
    // The end of a run that beat the best: wave 3, the crown, 10 coins.
    ['freeplay-result-best', async (page) => {
      await inFreePlay(page, 'plants');
      await page.evaluate(() => {
        const lvt = window.__lvt;
        lvt.fastForward(30 * 51);
        lvt.damageBase('plants', 999999);
        lvt.fastForward(1);
      });
      await page.waitForSelector('[data-free-result]', { timeout: 30_000 });
      await page.waitForTimeout(2600);
      await nextFrames(page, 3);
    }],
    // Fix round 1: the armed Quit in a run shows what ending now banks (the flag and the coins).
    ['freeplay-quit-bank', async (page) => {
      await inFreePlay(page, 'plants');
      await page.evaluate(() => window.__lvt.fastForward(30 * 51));
      await page.click('[data-hud="pause"]');
      await page.click('[data-screen="pause"] [data-action="quit"]');
      await settleUi(page);
    }],
    // p1-2: the Sunflower's first payout: the counter pulses big and golden, once.
    ['tutorial-sun-pays', async (page) => {
      await inLevel(page, 'plants', starsUpTo('plants', [3]), [], 'p1-2', ['p1-2.sun-card', 'p1-2.sun-tile', 'p1-2.pea-card', 'p1-2.pea-tile']);
      await page.evaluate(() => {
        const lvt = window.__lvt;
        const c = lvt.session.controller;
        c.select('sunflower'); c.click({ lane: 1, col: 0 }, null); lvt.fastForward(1);
        c.select('peashooter'); c.click({ lane: 1, col: 1 }, null); lvt.fastForward(1);
        while (c.tutorial.sunPulse.value === 0) lvt.fastForward(1);
      });
      await page.waitForTimeout(220); // the pulse at its biggest
    }],
    // A loss: grey stars, the consolation coins, replay and map.
    ['level-result-lost', async (page) => {
      await inLevel(page, 'plants', {}, [], 'p1-1');
      await levelEnd(page, 'plants', 2500);
    }],
  ];
  return sizes.flatMap(([size, viewport]) => base.map(([name, steps]) => ({
    name: `${name}-${size}`,
    url: '/?cloud=fake',
    viewport,
    steps: async (page) => {
      await page.evaluate(() => window.__lvt.portraits);
      await steps(page);
    },
  })));
}
