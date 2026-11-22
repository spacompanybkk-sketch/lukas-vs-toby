# Polish Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the kid-facing and Versus-correctness items of the phase VI backlog that need no owner decision.

**Architecture:** Small, independent fixes on branch `polish-1` (from main ddaa810), one task per area so no two tasks share a file. Each task first verifies its finding still reproduces in the current code; a finding already fixed is reported as such and skipped, not re-done.

**Tech Stack:** Vite + TypeScript + Preact/signals UI, Three.js voxel render, deterministic sim, Firebase RTDB by REST with rules from `tools/build-rules.mjs`; vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` (phase VI polish), backlog `~/Projects/worktrees/lukas-vs-toby-rebuild/.superpowers/sdd/polish-backlog.md` (item ids A1… C1… D2 below refer to it), Versus spec `docs/superpowers/specs/2026-11-18-versus-two-devices-design.md` for Task 6.

## Global Constraints

- No file under `src/sim/` changes; golden hash 3452586360, `tests/sim/determinism.test.ts`, `tests/sim/noTwistReplay.test.ts` and every Adventure outcome stay unchanged.
- Existing tests stay untouched unless a task says otherwise; new behaviour gets new tests.
- Kid rules: every tap target ≥ 64 px on a 1024×768 iPad; no text-only cue for Toby (a picture with any word); every refusal buzzes.
- Browser looks: e2e and screenshots only with the lid open (`ioreg -r -k AppleClamshellState` says No), under `caffeinate -i`, holding `/tmp/lvt-browser.lock`; look at every screenshot you take.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rules: `tools/build-rules.mjs` is the single source; regenerate `database.rules.json`; `node tools/build-rules.mjs --check` exits 0; v2 and v2test stay mirrored.

## Review Focus

1. A fix that silently changes single-player play (Adventure, Quick Battle, Free Play) — a reviewer should check the non-Versus paths of every touched file.
2. Render fixes that leak GPU objects (geometry/material counts after ten level ↔ map round trips stay flat).
3. Versus credit: a win credited twice or to the wrong boy after the Task 6 changes.
4. Rules: a forger gaining a write it did not have.
5. Audio: no sound starting while the tab is hidden.

---

### Task 1: Sound comes back after sleep (A1)

**Files:** Modify `src/audio/AudioEngine.ts` (and `src/ui/App.tsx` only if needed). Test: `tests/audio/*` (new cases).

- [ ] Verify A1: the engine already listens for `visibilitychange` (~line 218). Write a test that simulates hidden → visible with the context `suspended`/`interrupted` and asserts music and effects play again on the next gesture or on return. If it already passes, report "already fixed" with the test kept, and stop.
- [ ] Otherwise fix: on visible, try `resume()`; if Safari refuses outside a gesture, re-arm the one-tap unlock so the next tap anywhere resumes audio; music restarts at the current track.
- [ ] Run `npx vitest run tests/audio` then full `npx vitest run`. Commit `fix(audio): sound comes back after the iPad sleeps`.

### Task 2: Number pad says "again" (A5)

**Files:** `src/ui/screens/PinPad.tsx`, `src/ui/screens/players.css`. Test: `tests/ui/PinPad*.test.tsx` (new cases).

- [ ] Verify A5 on the second entry (`pinpad--repeat`): is there a picture-plus-word cue that this is "the same number again"? If yes, report and stop.
- [ ] Otherwise add above the dots a cue: a repeat-arrows picture (draw in the existing 12×12 picture style) and the word "Again!"; the first entry's digits stay masked. Test the cue exists only on step 2.
- [ ] Commit `fix(players): the number pad says "again" on the second entry`.

### Task 3: Frost Melon looks (A3, A4, A9)

**Files:** `src/render/battle/BattleView.ts` (Melon/boss look, hit flash), zombie/boss bar rendering, Melon warning colours. Test: `tests/render/*` new cases; e2e shot via the existing Tundra shots.

- [ ] A3: the Melon no longer flashes the whole screen/model white under a crowd of hits — cap the hit flash to the hit unit and at most one flash per 150 ms per unit; use the projectile's `sourceKey` for the frozen look instead of the boss view (BattleView ~1458).
- [ ] A4: health bars at the Melon do not stack: the boss bar hides the per-unit bar of the boss; overlapping unit bars on one tile offset vertically.
- [ ] A9: the freeze-warning frame on a snow lane is visible without the navy fill (darker outline colour).
- [ ] Look: `LVT_SHOTS` Tundra shots of the Melon fight before/after; geometry count flat (existing `e2e/tundra.spec.ts`). Commit `fix(tundra): the Melon fight reads clearly: no white flash, one bar, a visible freeze warning`.

### Task 4: Ice lesson matches play (A8)

**Files:** `src/render/world/TwistTiles.ts` (~480), the Tundra lesson scene. Test: existing `tests/**/tundraLessons*` plus one new case.

- [ ] The lesson's icy lane uses the same blue as in play; the lesson ghost slides along the ice instead of hopping.
- [ ] Shot of the lesson before/after. Commit `fix(tundra): the ice lesson looks like the ice in play`.

### Task 5: HUD small fixes (A11, A12, A13 part, A15, A17)

**Files:** `src/ui/hud/*` (boss entrance card CSS, 2X button), `src/ui/versus/*` (waiting hourglass, invite +/-), `src/ui/App.tsx` (player-list close after logout). Tests: matching `tests/ui/**` new cases.

- [ ] A11: the boss entrance card never overlaps Lukas's base bar at 1024 wide.
- [ ] A12: the Versus hourglass sits beside the silent boy's own bar (right side when the other device is the zombies side, etc.).
- [ ] A13: the 2X button stays put between tutorial steps (no disappear/reappear).
- [ ] A15: the invite card's +/- are greyed and buzz at the head-start limits.
- [ ] A17: closing the player list after logout goes to the title, not Play.
- [ ] Shots of boss entrance and Versus waiting; full `npx vitest run`. Commit `fix(hud): boss card, hourglass side, steady 2X, head-start limits, logout close`.

### Task 6: Versus correctness (C1, C2, C3, C5) and rules cleanup (D2)

**Files:** `src/app/versus.ts`, `src/cloud/versusLobby.ts`, `tools/build-rules.mjs` → `database.rules.json`, tests under `tests/app/versus*`, `tests/cloud/versus*`.

- [ ] C1: a device away when the other finishes still gets its credit: before the match is deleted, the finishing device waits until both end slots exist or the rematch window passes, and the away device on rejoin credits from a stored result record (`vs/results/<id>` write-once `{winner, by}` kept 24 h) when the match itself is gone. Test: winner's device asleep through the end and the 60 s window, then reloads → credited once.
- [ ] C2: going home after pressing rematch tells the other device at once: `again/<seat>` may change from 1 to 0 (rules: write-once value, or 1 → 0 only). Test: the other leaves the 60 s wait within one round trip.
- [ ] C3: decline carries the shown invite's `at`; a decline whose `at` differs from the current invite is ignored (rules or client). Test: old "no" panel cannot decline a fresh re-invite.
- [ ] C5: `credit()` asserts `player.slot === ctx.me`; when the player is null it keeps the credit pending until log-in instead of skipping silently. Test.
- [ ] D2: remove the dead `quit` grant and the unused `vs/allowed` node from the rules (and `VersusLobby.setAllowed`, `.vs-ticks*` CSS); update rules tests; `node tools/build-rules.mjs --check`.
- [ ] Full `npx vitest run`; `npx playwright test e2e/versus.spec.ts --project=ipad` (lid open). Commit `fix(versus): credit survives a sleeping device, home after rematch tells the other, a stale no cannot decline, rules tidy`.
