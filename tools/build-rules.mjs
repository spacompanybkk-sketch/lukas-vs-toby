#!/usr/bin/env node
/**
 * Builds database.rules.json: one block of player rules written twice, under `v2` (live) and
 * `v2test` (automated checks), from the same function so the two can never differ. Nothing else
 * is granted, so every other top-level path (including the retired `presence`, `rooms` and
 * `challenges`, see RETIRED_PATHS) refuses all reads and writes.
 *
 *   node tools/build-rules.mjs          write database.rules.json
 *   node tools/build-rules.mjs --print  print it instead
 *   node tools/build-rules.mjs --check  exit 1 when database.rules.json is not what this builds
 *
 * Nothing here talks to the network or deploys anything.
 *
 * Layout under each root (spec 20, plan phase 4a):
 *   players/{slot}             { name, picture }                     read: anyone
 *   secrets/{slot}             the pin hash                          read: nobody
 *   saves/{slot}/{hash}        { save, touch: <server time> }        read: only at this exact path
 *   board/{slot}               BoardRow                              read: anyone
 *   admin/secret               grown-up code hash                    read: nobody
 *   admin/proof/{hash}/touch   proof of knowing the grown-up code    read: nobody
 *
 * Rules cascade (a grant at a parent cannot be taken back below), so reads and writes are granted
 * only at the nodes listed here, never at a root or a collection — except the two public
 * collections `players` and `board`, which must be readable as a whole to be listed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOTS = ['v2', 'v2test'];

/** p01 … p30 and nothing else: a 31st player cannot exist. */
export const SLOT_RE = '/^p(0[1-9]|[12][0-9]|30)$/';

/** The 20 unit keys a picture may be (src/data/units.ts; tests/cloud/rules.test.ts checks they agree). */
export const PICTURE_KEYS = [
  'peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult',
  'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
  'brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher',
  'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie', 'brainRot',
];

/**
 * The old game's paths, retired and closed: they are left out of the rules, and with no grant at
 * the top a path that is not listed refuses every read and write. They were each
 * `{ ".read": true, ".write": true }` (open to anyone); to restore them, put those three entries
 * back in front of the roots in buildRules(). Closing them does not delete data stored there.
 */
export const RETIRED_PATHS = ['presence', 'rooms', 'challenges'];

// Regexes avoid `{n}` quantifiers: the Realtime Database's regex dialect is a subset, and the
// documented examples only use classes, groups, alternation, anchors and + * ?.
const HEX16 = "newData.isString() && newData.val().length === 16 && newData.val().matches(/^[0-9a-f]+$/)";
const HEX64 = "newData.isString() && newData.val().length === 64 && newData.val().matches(/^[0-9a-f]+$/)";
const NAME = "newData.isString() && newData.val().length >= 1 && newData.val().length <= 10 && newData.val().matches(/^[A-Za-z0-9]+$/)";
const PICTURE = `newData.isString() && newData.val().matches(/^(${PICTURE_KEYS.join('|')})$/)`;
const wholeIn = (lo, hi) =>
  `newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= ${lo} && newData.val() <= ${hi}`;
const NOTHING_ELSE = { '.validate': false };
/** Longest save string accepted (a full save is about 2,000 characters). */
export const MAX_SAVE_CHARS = 20000;

/** The player rules for one root. */
export function block(R) {
  const slotOk = `$slot.matches(${SLOT_RE})`;
  /** `newData` of the root, from a node `depth` levels below it (rules have no `newRoot`). */
  const top = (depth) => `newData${'.parent()'.repeat(depth)}`;
  /** The slot's pin hash as it will be after this update. */
  const secretAfter = (depth) => `${top(depth)}.child('secrets/' + $slot)`;
  /**
   * The same update writes `saves/<slot>/<that hash>/touch = now`: proof of the pin without
   * publishing it (only someone who knows the hash can name that path).
   */
  const pinProof = (depth) =>
    `(${secretAfter(depth)}.isString() && ${top(depth)}.child('saves/' + $slot + '/' + ${secretAfter(depth)}.val() + '/touch').val() === now)`;
  const adminSecret = `root.child('${R}/admin/secret')`;
  /** The same update writes `admin/proof/<stored grown-up hash>/touch = now`. */
  const adminProof = (depth) =>
    `(${adminSecret}.isString() && ${top(depth)}.child('admin/proof/' + ${adminSecret}.val() + '/touch').val() === now)`;

  return {
    players: {
      '.read': true,
      $slot: {
        // The owner may change the row but never delete it (that would leave a ghost slot).
        '.write': `${slotOk} && ((newData.exists() && ${pinProof(2)}) || ${adminProof(2)})`,
        '.validate': "newData.hasChildren(['name', 'picture'])",
        name: { '.validate': NAME },
        picture: { '.validate': PICTURE },
        $other: NOTHING_ELSE,
      },
    },
    secrets: {
      $slot: {
        // Create: only when the slot is free (no secret and no player row yet) and this very
        // update creates its player row. Change or delete: only with the grown-up proof.
        '.write': `${slotOk} && ((!data.exists() && !data.parent().parent().child('players/' + $slot).exists() && ${top(2)}.child('players/' + $slot).exists()) || ${adminProof(2)})`,
        '.validate': HEX64,
      },
    },
    saves: {
      $slot: {
        // Replacing or deleting a slot's saves wholesale (reset pin, delete player): grown-up only.
        '.write': `${slotOk} && ${adminProof(2)}`,
        $hash: {
          '.read': `${slotOk} && root.child('${R}/secrets/' + $slot).val() === $hash`,
          // The owner may write the save but never delete it; only the grown-up clears saves.
          '.write': `${slotOk} && newData.exists() && $hash === ${secretAfter(3)}.val()`,
          // Compare-and-swap: replacing a stored record needs `prev` equal to its `ver`, so of
          // two devices writing from the same version only the first wins; the other reloads,
          // merges and writes again. A grown-up proof in the same update waives it (a reset to
          // the pin the player already has lands on the existing record).
          '.validate': `newData.hasChildren(['save', 'touch', 'ver']) && $hash === ${secretAfter(3)}.val() && (!data.exists() || newData.child('prev').val() === data.child('ver').val() || ${adminProof(3)})`,
          // The save is ONE JSON string (the client parses it strictly), bounded in size.
          save: { '.validate': `newData.isString() && newData.val().length <= ${MAX_SAVE_CHARS}` },
          touch: { '.validate': 'newData.val() === now' },
          // A fresh random version id with every write (never the one it replaces).
          ver: { '.validate': `${HEX16} && newData.val() !== data.val()` },
          prev: { '.validate': HEX16 },
          $other: NOTHING_ELSE,
        },
      },
    },
    board: {
      '.read': true,
      $slot: {
        // The owner may change the row but never delete it (that would leave a ghost slot).
        '.write': `${slotOk} && ((newData.exists() && ${pinProof(2)}) || ${adminProof(2)})`,
        '.validate':
          "newData.hasChildren(['slot', 'name', 'picture', 'stars', 'wave', 'versusWins', 'computerWins', 'updatedAt'])",
        slot: { '.validate': 'newData.val() === $slot' },
        name: { '.validate': NAME },
        picture: { '.validate': PICTURE },
        stars: { '.validate': wholeIn(0, 240) },
        wave: { '.validate': wholeIn(0, 9999) },
        versusWins: { '.validate': wholeIn(0, 99999) },
        computerWins: { '.validate': wholeIn(0, 99999) },
        updatedAt: { '.validate': 'newData.isNumber() && newData.val() <= now' },
        $other: NOTHING_ELSE,
      },
    },
    admin: {
      secret: {
        // Set once when there is none; changed later only with the current grown-up proof;
        // never deleted.
        '.write': `newData.exists() && (!data.exists() || ${adminProof(2)})`,
        '.validate': HEX64,
      },
      proof: {
        $hash: {
          '.write': `${adminSecret}.val() === $hash`,
          '.validate': "newData.hasChildren(['touch'])",
          touch: { '.validate': 'newData.val() === now' },
          $other: NOTHING_ELSE,
        },
      },
      $other: NOTHING_ELSE,
    },
    $other: NOTHING_ELSE,
  };
}

export function buildRules() {
  const rules = {};
  for (const R of ROOTS) rules[R] = block(R);
  return { rules };
}

export const render = () => `${JSON.stringify(buildRules(), null, 2)}\n`;

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'database.rules.json');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render();
  if (process.argv.includes('--print')) {
    process.stdout.write(text);
  } else if (process.argv.includes('--check')) {
    const current = readFileSync(FILE, 'utf8');
    if (current !== text) {
      console.error('database.rules.json is out of date: run node tools/build-rules.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(FILE, text);
    console.log(`wrote ${FILE}`);
  }
}
