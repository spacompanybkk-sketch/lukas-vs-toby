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
 *   proof/{slot}/{hash}/touch  proof of knowing a player's pin       read: nobody
 *   vs/allowed/{slot}          unused since every player may play    read: anyone
 *   vs/here/{slot}             { at, busy } heartbeat                read: anyone
 *   vs/lobby/{owner}/in|back/{from}   invites and replies            read: anyone, per owner
 *   vs/matches/{id}            one private match                     read: whoever knows the id
 *
 * Versus (spec 7-8): "proven" = the same update writes `proof/<slot>/<its pin hash>/touch = now`;
 * "allowed" = the player exists under `players` (the old `vs/allowed` grant is unused). The match id (32 hex digits from an ECDH
 * secret) is the only thing keeping a match private, so `vs/matches` itself is never readable.
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
const WHOLE = 'newData.isNumber() && newData.val() % 1 === 0';
const NOW = 'newData.val() === now';
const SEAT_RE = '/^(plants|zombies)$/';
/** The short commit of a build. */
const BUILD = "newData.isString() && newData.val().length >= 7 && newData.val().length <= 12 && newData.val().matches(/^[0-9a-f]+$/)";
/** An uncompressed P-256 public key as base64url. */
const PUB = "newData.isString() && newData.val().length === 87 && newData.val().matches(/^[A-Za-z0-9_-]+$/)";
/** Turn keys t000000 … t009000 (30 minutes of 6-tick turns at 30 ticks a second). */
const TURN_KEY_RE = '/^t00([0-8][0-9][0-9][0-9]|9000)$/';
export const MAX_TURN_CHARS = 400;
export const MAX_SNAP_CHARS = 200000;
/** A slot as a value. */
const SLOT_VALUE = `newData.isString() && newData.val().matches(${SLOT_RE})`;
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
  /**
   * As adminProof, and the stored touch was not already `now`: a proof written by another update
   * in the same server millisecond cannot be borrowed. Used by every Versus grant; the older
   * paths above keep adminProof as shipped.
   */
  const adminProofFresh = (depth) =>
    `(${adminSecret}.isString() && ${top(depth)}.child('admin/proof/' + ${adminSecret}.val() + '/touch').val() === now && root.child('${R}/admin/proof/' + ${adminSecret}.val() + '/touch').val() !== now)`;

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
    proof: {
      $slot: {
        // The grown-up clears a slot's proofs, including those under an old pin hash (delete only).
        '.write': `${slotOk} && !newData.exists() && ${adminProofFresh(2)}`,
        $hash: {
          // Only someone who knows the slot's pin hash can name this path; nobody can read it.
          '.write': `${slotOk} && root.child('${R}/secrets/' + $slot).val() === $hash`,
          '.validate': "newData.hasChildren(['touch'])",
          touch: { '.validate': NOW },
          $other: NOTHING_ELSE,
        },
      },
    },
    vs: versus(R, { top, adminProof: adminProofFresh }),
    $other: NOTHING_ELSE,
  };
}

/**
 * `v2/vs` (spec 8.3). Rules cascade, so every grant sits at a leaf; `vs/matches/$id` grants only
 * deleting the whole match, which cannot cascade to an ordinary write below it.
 */
function versus(R, { top, adminProof }) {
  const secretOf = (S) => `root.child('${R}/secrets/' + ${S})`;
  /** The same update writes `proof/<S>/<S's stored pin hash>/touch = now`, from `depth` below the root. */
  const proven = (S, depth) =>
    `(${secretOf(S)}.isString() && ${top(depth)}.child('proof/' + ${S} + '/' + ${secretOf(S)}.val() + '/touch').val() === now && root.child('${R}/proof/' + ${S} + '/' + ${secretOf(S)}.val() + '/touch').val() !== now)`;
  /** On the Versus list: every player that exists (a slot with a `players/<slot>` record). */
  const allowed = (S) => `root.child('${R}/players/' + ${S}).exists()`;
  const isSlot = (v) => `${v}.matches(${SLOT_RE})`;
  const seatOk = `$seat.matches(${SEAT_RE})`;
  /** `meta` exists (after this update), from a node `up` levels below the match. */
  const metaExists = (up) => `newData${'.parent()'.repeat(up)}.child('meta').exists()`;
  /** One of the match's seats, from a node `up` levels below the match. */
  const aSeat = (up) => {
    const m = `newData${'.parent()'.repeat(up)}.child('meta/seats/`;
    return `newData.isString() && (newData.val() === ${m}plants').val() || newData.val() === ${m}zombies').val())`;
  };
  /** Written once; the very same value again is fine (a retry of a lost answer). */
  const once = (same) => `newData.exists() && (!data.exists() || ${same})`;
  const sameVal = 'data.val() === newData.val()';
  /** A per-seat record of the match: `$seat` plants|zombies, meta exists, written once. */
  const seatRecord = (validate) => ({
    $seat: {
      '.write': `${seatOk} && ${metaExists(2)} && ${once(sameVal)}`,
      '.validate': validate,
    },
  });
  const lobbyEntry = (write, children) => ({
    $from: {
      // Deleted by either party, or by the grown-up (a player taken off the list or removed).
      '.write': `${isSlot('$owner')} && ${isSlot('$from')} && ((newData.exists() && ${write}) || (!newData.exists() && (${proven('$from', 5)} || ${proven('$owner', 5)} || ${adminProof(5)})))`,
      ...children,
    },
  });
  const plantsSeat = "newData.child('seats/plants').val()";
  const zombiesSeat = "newData.child('seats/zombies').val()";

  return {
    allowed: {
      '.read': true,
      $slot: {
        // Ticked in, or out again (deleted), from the grown-up screen.
        '.write': `$slot.matches(${SLOT_RE}) && ${adminProof(3)}`,
        '.validate': 'newData.val() === true',
      },
    },
    here: {
      '.read': true,
      $slot: {
        // The player with his proof; the grown-up may only delete it.
        '.write': `$slot.matches(${SLOT_RE}) && ((${proven('$slot', 3)} && ${allowed('$slot')}) || (!newData.exists() && ${adminProof(3)}))`,
        '.validate': "newData.hasChildren(['at', 'busy'])",
        at: { '.validate': NOW },
        busy: { '.validate': 'newData.isBoolean()' },
        $other: NOTHING_ELSE,
      },
    },
    lobby: {
      $owner: {
        // Nothing in a lobby is secret: slots, times, public keys.
        '.read': isSlot('$owner'),
        // The grown-up clears a whole lobby (delete only; entries are granted below).
        '.write': `${isSlot('$owner')} && !newData.exists() && ${adminProof(3)}`,
        // An invite from $from to $owner.
        in: lobbyEntry(`${proven('$from', 5)} && ${allowed('$from')} && ${allowed('$owner')} && $from !== $owner`, {
          '.validate': "newData.hasChildren(['pub', 'side', 'build', 'at'])",
          pub: { '.validate': PUB },
          side: { '.validate': `newData.isString() && newData.val().matches(${SEAT_RE})` },
          head: {
            '.validate': "newData.hasChildren(['slot', 'step'])",
            slot: { '.validate': 'newData.val() === $owner || newData.val() === $from' },
            step: { '.validate': wholeIn(0, 5) },
            $other: NOTHING_ELSE,
          },
          build: { '.validate': BUILD },
          at: { '.validate': NOW },
          $other: NOTHING_ELSE,
        }),
        // $from's answer to $owner's invite; the key only when he accepts. Only while that invite
        // (`lobby/$from/in/$owner`) exists, and only in the update that deletes it: of two devices
        // of one player answering at once, the second is refused as a whole (meta included), and a
        // stale "no" cannot overwrite a "yes".
        back: lobbyEntry(`${proven('$from', 5)} && ${allowed('$from')} && root.child('${R}/vs/lobby/' + $from + '/in/' + $owner).exists() && !${top(5)}.child('vs/lobby/' + $from + '/in/' + $owner).exists()`, {
          '.validate': "newData.hasChildren(['ok', 'build', 'at']) && (newData.child('ok').val() === false || newData.hasChild('pub'))",
          ok: { '.validate': 'newData.isBoolean()' },
          pub: { '.validate': PUB },
          build: { '.validate': BUILD },
          at: { '.validate': NOW },
          $other: NOTHING_ELSE,
        }),
        $other: NOTHING_ELSE,
      },
    },
    matches: {
      $id: {
        // The id is the secret: anyone who knows it may read the match, nobody may list them.
        '.read': '$id.length === 32 && $id.matches(/^[0-9a-f]+$/)',
        // Only deleting the whole match; everything else is granted at the leaves.
        '.write': '$id.length === 32 && $id.matches(/^[0-9a-f]+$/) && !newData.exists()',
        meta: {
          // Written once, by one of the two seats with his pin proof in the same update.
          '.write': `!data.exists() && newData.exists() && (${proven(plantsSeat, 4)} || ${proven(zombiesSeat, 4)})`,
          '.validate': "newData.hasChildren(['v', 'build', 'seed', 'seats', 'host', 'turn', 'delay', 'created'])",
          v: { '.validate': 'newData.val() === 1' },
          build: { '.validate': BUILD },
          seed: { '.validate': WHOLE },
          seats: {
            '.validate': `newData.hasChildren(['plants', 'zombies']) && newData.child('plants').val() !== newData.child('zombies').val() && ${allowed("newData.child('plants').val()")} && ${allowed("newData.child('zombies').val()")}`,
            plants: { '.validate': SLOT_VALUE },
            zombies: { '.validate': SLOT_VALUE },
            $other: NOTHING_ELSE,
          },
          host: { '.validate': aSeat(2) },
          head: {
            '.validate': "newData.hasChildren(['slot', 'step'])",
            slot: { '.validate': aSeat(3) },
            step: { '.validate': wholeIn(0, 5) },
            $other: NOTHING_ELSE,
          },
          turn: { '.validate': 'newData.val() === 6' },
          delay: { '.validate': wholeIn(9, 30) },
          // Smaller base health so a browser test ends in seconds: only on v2test.
          test: R === 'v2test' ? { '.validate': wholeIn(1, 500) } : NOTHING_ELSE,
          created: { '.validate': NOW },
          $other: NOTHING_ELSE,
        },
        ready: seatRecord(NOW),
        end: seatRecord(`newData.isString() && newData.val().length < 100`),
        again: seatRecord(wholeIn(0, 1)),
        turns: {
          $seat: {
            $k: {
              // Write-once turn log, bounded in key range and size (spec 7.4).
              '.write': `${seatOk} && $k.matches(${TURN_KEY_RE}) && ${metaExists(3)} && ${once(sameVal)}`,
              '.validate': `newData.isString() && newData.val().length <= ${MAX_TURN_CHARS}`,
            },
          },
        },
        pause: {
          '.write': `!newData.exists() || ${metaExists(1)}`,
          '.validate': "newData.hasChildren(['by', 'n'])",
          by: { '.validate': aSeat(2) },
          n: { '.validate': WHOLE },
          $other: NOTHING_ELSE,
        },
        quit: {
          '.write': `${metaExists(1)} && ${once("data.child('by').val() === newData.child('by').val()")}`,
          '.validate': "newData.hasChildren(['by'])",
          by: { '.validate': aSeat(2) },
          $other: NOTHING_ELSE,
        },
        sync: {
          $n: {
            // A snapshot from the host on a mismatch: at most three per match.
            '.write': `$n.matches(/^s[1-3]$/) && ${metaExists(2)} && ${once("data.child('tick').val() === newData.child('tick').val() && data.child('snap').val() === newData.child('snap').val()")}`,
            '.validate': "newData.hasChildren(['tick', 'snap'])",
            tick: { '.validate': WHOLE },
            snap: { '.validate': `newData.isString() && newData.val().length <= ${MAX_SNAP_CHARS}` },
            $other: NOTHING_ELSE,
          },
        },
        $other: NOTHING_ELSE,
      },
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
