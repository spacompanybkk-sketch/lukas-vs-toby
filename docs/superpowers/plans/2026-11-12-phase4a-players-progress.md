# Phase 4a — Players and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 30 players who log in with a picture and a 3-digit password, keep their progress online and on the device, earn coins, upgrade units in the Marketplace, browse the Almanac, and see themselves on a leaderboard.

**Architecture:** A pure `progress` layer owns the save (model, rewards, upgrades, migration) with no DOM or network. A `cloud` layer talks to the Firebase Realtime Database over its REST API with `fetch` (no SDK), behind an interface the tests fake. The password never leaves the device: a salted hash is the key to a write-only-if-you-know-it path, enforced by database rules. Screens are Preact, picture-first. Marketplace upgrades reach the simulation as plain multipliers in the match config.

**Tech Stack:** as phases 1–2, plus the browser's `crypto.subtle` (SHA-256) and `fetch`. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` sections 7, 9, 19, 20 (and 8 for what phase 4b will add). Phase 4 is split: 4a is this plan; 4b (worlds, 80 levels, bosses, map, tutorial, Free Play) gets its own plan.

## Global Constraints

Everything in `.superpowers/sdd/2026-11-12-phase2-full-roster/parallel-rules.md` and `phase1-global-constraints.md` still binds. In addition:

- A player record holds a nickname (1–10 letters or digits), a picture key, and game numbers. Nothing else personal, ever.
- The password is exactly three digits. It is never stored or sent; only `hash = SHA-256("lvt2|" + slot + "|" + pin)` in hex is.
- At most 30 players: slots `p01` … `p30`. The cap is enforced by the database rules, not only by the screen.
- The game must be fully playable with no connection: every cloud call can fail or hang (5 s timeout) and the game carries on with the device copy and syncs later.
- Database paths: only under `v2/` (live) and `v2test/` (the same rules, for automated checks). The old paths `presence`, `rooms`, `challenges` are not touched.
- **No rules deploy without Michal's explicit go-ahead in the session.** Until then everything runs against the fake and the device copy.
- Toby (almost 5) cannot read: log-in, the number pad, Marketplace and leaderboard work from pictures, colour and sound. Touch targets ≥ 44 pt; number-pad keys ≥ 72 px on an iPad.
- Look: Minecraft — boxy, pixel-crisp. Layouts fit 1024×650 upward in landscape.
- The simulation stays deterministic; upgrades enter only through `MatchConfig`.
- Versus never applies Marketplace upgrades (spec 7).

## Review Focus

1. Two devices saving the same player (the iPad and the computer): the newer save wins whole, nothing is merged field by field, and a stale device never overwrites newer progress. Test in Task 2.
2. The connection dropping in the middle of create, log-in or save: no half-made player, no lost coins, a clear picture-level message, and a retry that works. Tests in Tasks 2 and 3.
3. A forged write (wrong hash, a 31st slot, another player's leaderboard row, absurd numbers): refused by the rules. Test in Task 7 against `v2test`.
4. A five-year-old at the number pad: wrong digits, double taps, backing out halfway — never stuck, never locked out for more than 30 s. Test in Task 3.
5. An old save (`lpvtz_save_lukas`, `lpvtz_save_toby`) that is missing, corrupt, or already imported: imported at most once, coins carried, upgrades refunded, never a crash. Test in Task 1.

## File map

- `src/progress/{save,rewards,upgrades,migrate,localStore}.ts` — pure model and device copy.
- `src/cloud/{types,hash,restClient,fakeCloud,sync}.ts` — cloud interface, REST client, fake, sync policy.
- `database.rules.json`, `tools/rules-check.mjs` — rules and their live check against `v2test`.
- `src/ui/screens/{Players,CreatePlayer,PinPad,GrownUp,Home,Leaderboard,Marketplace,Almanac}.tsx`, `src/app/{session,store}.ts`.
- `src/sim/{types,match,lookup}.ts`, `src/data/balance.ts` — upgrade multipliers.
- `src/scenes/almanacStage.ts` — turntable.

---

### Task 1: The save, rewards, upgrades and old-save import

**Files:** create `src/progress/{save,rewards,upgrades,migrate,localStore}.ts`; tests `tests/progress/*.test.ts`.

**Interfaces — Produces:**

```ts
export type Slot = `p${string}`;                       // 'p01' … 'p30'
export const SLOTS: readonly Slot[];                    // 30
export const PICTURES: readonly CardKey[];              // the 20 unit keys: a player's picture
export interface SideProgress { stars: Record<string, 0 | 1 | 2 | 3>; unlocked: CardKey[] } // stars by level id; filled by phase 4b
export interface Save {
  v: 1; slot: Slot; name: string; picture: CardKey;
  coins: number;                                        // whole, ≥ 0
  upgrades: Partial<Record<CardKey, number>>;           // 0..10
  plants: SideProgress; zombies: SideProgress;
  bestWave: number; versusWins: number; computerWins: number;
  difficulty: Record<Faction, Skill>;
  importedOld: boolean;
  updatedAt: number;                                    // ms; set by `touch`
}
export function newSave(slot: Slot, name: string, picture: CardKey, now: number): Save;
export function parseSave(raw: unknown): Save | null;   // strict: wrong shape, range or type → null
export function totalStars(s: Save): number;
export function touch(s: Save, now: number): Save;      // immutable update helpers return new objects
export function validName(name: string): boolean;       // 1–10 of [A-Za-z0-9], trimmed

// rewards.ts — numbers in one table REWARDS
export function rewardFor(result: { won: boolean; skill: Skill; baseHpShare: number }): number;
//   win: Easy 20, Medium 40, Hard 70; +50% (rounded to 5) when baseHpShare ≥ 0.8; loss: 5
export function applyBattleResult(s: Save, r: { won: boolean; skill: Skill; baseHpShare: number; versus: boolean }, now: number): Save;
//   versus: no coins, versusWins +1 on a win; otherwise coins += rewardFor, computerWins +1 on a win

// upgrades.ts
export const MAX_UPGRADE = 10;
export function upgradeCost(nextLevel: number): number; // 100 × nextLevel (1..10)
export function buyUpgrade(s: Save, unit: CardKey, now: number): Save | 'max' | 'no-coins';

// migrate.ts
export function importOldSave(s: Save, raw: string | null, now: number): Save;
//   only when !s.importedOld; coins += old coins + Σ refund(level) with refund(n) = 100 × n(n+1)/2 per old upgraded unit; sets importedOld; bad JSON → importedOld true, nothing added

// localStore.ts — keys `lvt2_save_<slot>`, `lvt2_last_slot`; storage injected like settings.ts
export function loadLocal(slot: Slot, storage?: Storage): Save | null;
export function saveLocal(s: Save, storage?: Storage): void;
export function lastSlot(storage?: Storage): Slot | null;
export function setLastSlot(slot: Slot | null, storage?: Storage): void;
```

- [ ] Tests first, exact values: `newSave` defaults (coins 0, difficulty plants Medium / zombies Medium, except slot `p01` "Lukas" plants Medium and `p02` "Toby" both Easy — see Task 3 for who gets which slot); `parseSave` rejects each wrong field (table-driven: negative coins, upgrade 11, unknown picture, name of 11 letters, missing key, extra `v`); rewards table; `buyUpgrade` to level 10 costs 5,500 in total and the eleventh returns `'max'`; `importOldSave` with coins 300 and one unit at old level 3 adds 300 + 600; runs once; corrupt JSON is safe (review-focus 5); local store survives a throwing storage.
- [ ] Implement; `npx tsc --noEmit && npx vitest run tests/progress`; commit.

### Task 2: Cloud layer and database rules

**Files:** create `src/cloud/{types,hash,restClient,fakeCloud,sync}.ts`, `tools/rules-check.mjs`; rewrite `database.rules.json`; tests `tests/cloud/*.test.ts`.

**Interfaces — Produces:**

```ts
// hash.ts
export function pinHash(slot: Slot, pin: string): Promise<string>;   // 64 hex chars; pin must be /^\d{3}$/
// types.ts
export interface PublicPlayer { slot: Slot; name: string; picture: CardKey }
export interface BoardRow extends PublicPlayer { stars: number; wave: number; versusWins: number; computerWins: number; updatedAt: number }
export type CloudError = 'offline' | 'wrong-pin' | 'taken' | 'full' | 'refused';
export interface Cloud {
  listPlayers(): Promise<PublicPlayer[] | CloudError>;
  createPlayer(save: Save, hash: string): Promise<'ok' | CloudError>;       // claims the slot, stores secret, save and board row in ONE multi-path update
  loadSave(slot: Slot, hash: string): Promise<Save | null | CloudError>;    // null = right hash, nothing stored; wrong hash → 'wrong-pin'
  writeSave(save: Save, hash: string): Promise<'ok' | CloudError>;          // save + board row in one update
  board(): Promise<BoardRow[] | CloudError>;
  setGrownUpCode(hash: string): Promise<'ok' | CloudError>;                 // only when none is set
  deletePlayer(slot: Slot, grownUpHash: string): Promise<'ok' | CloudError>;
  resetPin(slot: Slot, grownUpHash: string, newHash: string, save: Save): Promise<'ok' | CloudError>;
}
// sync.ts
export function reconcile(local: Save | null, remote: Save | null): { use: Save | null; push: boolean; store: boolean };
//   newer `updatedAt` wins whole; equal → no work; one side null → the other
export class SaveSync { constructor(cloud: Cloud, storage?: Storage); login(slot, pin): Promise<Save | CloudError>; update(fn: (s: Save) => Save): void; flush(): Promise<void>; readonly state: Signal<'synced' | 'pending' | 'offline'> }
//   `update` writes the device copy at once and queues one cloud write (latest wins, retried with backoff 2 s → 60 s, and on `online`/visibility)
```

**Database layout** (same under `v2` and `v2test`):

```
players/{slot}                    public: { name, picture }             read: anyone
secrets/{slot}                    the pin hash                          read: nobody
saves/{slot}/{hash}               { save: <Save>, touch: <server time> } read: only at this exact path
board/{slot}                      BoardRow                               read: anyone
admin/secret                      grown-up code hash                     read: nobody
admin/proof/{hash}/touch          proof of knowing the grown-up code     read: nobody
```

**Rules to write (each is a row in `tools/rules-check.mjs`):**

- [ ] `{slot}` must match `/^p(0[1-9]|[12][0-9]|30)$/` everywhere: a 31st player cannot exist.
- [ ] `secrets/{slot}`: writable only when it does not exist yet (create), or when the same update also writes `admin/proof/<stored admin secret>/touch = now` (grown-up reset or delete). A 64-hex string or null.
- [ ] `saves/{slot}/{hash}`: writable only when `{hash}` equals the value at `secrets/{slot}` after this update; `touch` must equal `now`; the parent `saves/{slot}` is neither readable nor listable.
- [ ] `players/{slot}` and `board/{slot}`: writable only when the same update also writes `saves/{slot}/<secret of that slot>/touch = now` (proof of the pin without publishing it), or with the grown-up proof for a delete. Validation: `name` 1–10 chars `[A-Za-z0-9]`, `picture` one of the 20 keys, `stars` 0–240, `wave` 0–9999, `versusWins`/`computerWins` 0–99999, `updatedAt ≤ now`.
- [ ] `admin/secret`: writable only when it does not exist. `admin/proof/{hash}`: writable only when `{hash}` equals `admin/secret`.
- [ ] Everything else under `v2`/`v2test`: no read, no write. `presence`, `rooms`, `challenges` keep their current open rules.

**Steps:**

- [ ] Tests first with `fakeCloud` (an in-memory implementation that enforces the same rules in TypeScript): create → list → load with the right and the wrong pin; the 31st create returns `'full'`; a taken slot returns `'taken'`; `reconcile` table (review-focus 1: device A saves at t1, device B at t2 > t1, A reconnects and must adopt B's save, not overwrite it); `SaveSync` with a cloud that fails then recovers keeps the device copy, shows `'offline'` then `'synced'`, and sends only the latest save (review-focus 2); a create interrupted after the request leaves no player on the device until the cloud confirms or a retry succeeds.
- [ ] `restClient.ts`: `fetch` to `https://lukas-toby-plants-vs-zombies-default-rtdb.<region>.firebasedatabase.app/<root>/….json` (read the database URL from the old game's config in git history: tag `old-game-final`), multi-path `PATCH` at the root for atomic updates, `{".sv":"timestamp"}` for `touch`, 5 s timeout via `AbortController`, HTTP 401/403 → `'wrong-pin'` or `'refused'` by call, network failure → `'offline'`. Root is `v2` by default, `v2test` with `?cloud=test`, and the fake with `?cloud=fake` or when the rules are not deployed yet (a build flag `VITE_CLOUD`, default `fake` until Task 7 flips it). Unit-test with a mocked `fetch` for each mapping.
- [ ] `tools/rules-check.mjs`: runs every rule row above against the live `v2test` root with plain `fetch`, cleans up after itself, prints a table, exits non-zero on any surprise. It is only run in Task 7.
- [ ] Validate the rules file's syntax offline (`firebase deploy --only database --dry-run` if available, otherwise the Firebase MCP validator); do NOT deploy.
- [ ] `npx tsc --noEmit && npx vitest run tests/cloud`; commit.

### Task 3: Log-in, create player, number pad, grown-up gate

**Files:** create `src/app/session.ts`, `src/ui/screens/{Players,CreatePlayer,PinPad,GrownUp,Home}.tsx`, CSS; modify `src/app/store.ts`, `src/ui/App.tsx`, `src/ui/screens/Title.tsx`; tests `tests/ui/*.test.tsx`, `tests/app/session.test.ts`, `e2e/players.spec.ts`.

**Interfaces — Produces:** `session.player: Signal<Save | null>`, `session.login(slot, pin)`, `session.create(name, picture, pin)`, `session.logout()`, `session.update(fn)`; `Screen` gains `'players' | 'create' | 'home' | 'leaderboard' | 'marketplace' | 'almanac' | 'grownup'`.

- [ ] Flow: Title → Players (a grid of up to 30 pictures with names; an empty "+" tile while fewer than 30 exist; the last player used on this device is first and pulsing) → tap a picture → PinPad → Home (big picture buttons: Play, Marketplace, Almanac, Leaderboard, and a small door to log out). The side-pick and difficulty screen from phase 1 follows Play, pre-set from the save.
- [ ] Lukas and Toby: slots `p01` (name "Lukas", picture `peashooter`) and `p02` ("Toby", `brainEater`) are shown from the first start even before they exist in the cloud; the first tap on one opens "choose your number" (PinPad twice: choose, repeat) and creates it, importing that boy's old save (Task 1) on this device.
- [ ] CreatePlayer: pick a picture from the 20 (taken pictures allowed), type a name on a boxy on-screen keyboard (A–Z, 0–9, backspace; the device keyboard also works), choose the number twice. A slot is assigned automatically (lowest free).
- [ ] PinPad: keys 0–9 and backspace, each ≥ 72 px on an iPad, three boxes filling as digits arrive, a sound per key; the third digit submits. Wrong: the boxes shake, clear, and the deny sound plays; three wrong in a row lock that picture for 30 s with a boxy hourglass counting down (kept per slot on the device, survives reload). Back arrow always works (review-focus 4).
- [ ] Offline: Players shows the players known on this device (those with a device copy) with a small "no connection" cloud icon; log-in then checks the pin against the device copy's stored hash; creating a player needs a connection and says so with a picture (cloud crossed out) and a retry button (review-focus 2).
- [ ] GrownUp (reached by holding the small lock on Players for 2 s): first use sets the grown-up code (4 digits, twice); afterwards the code opens a list where a player can be deleted (confirm by typing the code again) or given a new number.
- [ ] After a battle, `applyBattleResult` runs through `session.update`; the result screen shows the coins earned as falling coin blocks.
- [ ] Unit tests for each screen's states with the fake cloud; e2e on both projects with `?cloud=fake`: create a player by taps only, log out, log in with the wrong number three times (lock shows), wait out the lock with a fast clock, log in, win a fast-forwarded battle, see coins; reload and the player is still first in the grid.
- [ ] Typecheck, unit suite, e2e; commit.

### Task 4: Leaderboard

**Files:** create `src/ui/screens/Leaderboard.tsx`; modify `src/app/session.ts`; tests `tests/ui/Leaderboard.test.tsx`, e2e in `players.spec.ts`.

- [ ] Four tables as picture tabs (star, wave, crossed swords, robot head): Adventure stars, best Free Play wave, Versus wins, wins against the computer. Each row: rank block (gold, iron, bronze for 1–3), picture, name, number. The logged-in player's row is highlighted and scrolled into view. Ties share a rank; order within a tie by earlier `updatedAt`. Empty tables show a picture of an empty podium, not words. With no connection the last board fetched on this device is shown with the "no connection" icon.
- [ ] After a battle that changes the player's place in any table, the result screen shows a small "up" arrow with the new rank.
- [ ] Tests: ordering, ties, highlight, offline copy, the place-change hint; e2e: two fake players, the winner's row moves up.
- [ ] Commit.

### Task 5: Marketplace and upgrades in battle

**Files:** create `src/ui/screens/Marketplace.tsx`; modify `src/sim/{types,match,lookup}.ts`, `src/data/balance.ts`, `src/sim/hash.ts`, `src/app/{BattleController,session}.ts`; tests `tests/sim/upgrades.test.ts`, `tests/ui/Marketplace.test.tsx`, `tests/app/*`.

**Interfaces — Produces:** `MatchConfig.upgrades: Record<Faction, Partial<Record<CardKey, number>>>` (default empty); `Balance.upgradeStep: { hp: number; damage: number }` = `{ hp: 0.05, damage: 0.05 }` per level (level 10 = +50%); `upgradeScale(b, config, unit, 'hp' | 'damage'): number`.

- [ ] Sim: a unit's hp and its bite/shot/ability damage are multiplied by `1 + step × level` for its type's upgrade level at spawn and at merge; specials that are not damage (Sun, heal, durations) are not. Covered by hash/snapshot; classic helper has none; determinism test with upgrades on.
- [ ] `BattleController` passes the logged-in player's upgrades for their side only, and none in Versus; the computer has none.
- [ ] Marketplace screen: the ten units of each side on two picture tabs; each card shows the unit's portrait, ten pips, the price of the next step with the coin icon, and a big "+" button; buying plays the merge sound, fills a pip and makes the portrait hop; too few coins → deny shake; level 10 shows a gold frame. Coins counter at the top.
- [ ] Tests: exact multipliers at levels 0, 1, 10; a level-2 merged unit with upgrade 3; Versus ignores upgrades; buying flows through `session.update` and persists.
- [ ] Balance note in the report: measure Medium v Medium with the human side at upgrade 0, 5 and 10 on 200 seeds, so phase 4b knows how much an upgraded player gains.
- [ ] Commit.

### Task 6: Almanac

**Files:** create `src/ui/screens/Almanac.tsx`, `src/scenes/almanacStage.ts`; tests `tests/ui/Almanac.test.tsx`, `tests/render/almanacStage.test.ts`.

- [ ] A grid of the 20 units (and the Bone Minion) as portraits; tapping one shows it on a slowly turning 3D pedestal using the shared `Stage` (one WebGL context — no second canvas context), five level buttons (pips) that switch its look, three stat bars (health, damage, speed) drawn from `BALANCE` relative to its side's maximum, a role icon, and a "play" button that plays its attack or ability clip. The name is shown for Lukas; nothing depends on reading it.
- [ ] Until phase 4b adds unlocks, every unit is shown.
- [ ] Tests: one WebGL context after opening and closing the Almanac ten times; bars computed from the balance table; every unit's five looks build.
- [ ] Commit.

### Task 7: Rules deploy and proof (gated)

**Files:** modify `README.md`, build config; run `tools/rules-check.mjs`.

- [ ] **Stop and ask Michal for the go-ahead to deploy the database rules.** Show him the rules file's meaning in five plain lines and remind him what a 3-digit password does and does not protect.
- [ ] On go-ahead: `firebase deploy --only database` from an up-to-date `main` checkout; run `tools/rules-check.mjs` against `v2test`; every row must pass (review-focus 3). If any fails, roll the rules back to the previous file at once and report.
- [ ] Flip the build default to the real cloud; e2e smoke against `?cloud=test` (create, log in on a second browser context, save on one and load on the other; then the script deletes its test players).
- [ ] README: how players, the grown-up code and the leaderboard work; how to reset everything.
- [ ] Full unit suite ×2, e2e ×2; commit. Deploy of the site itself is Michal's call as before.
