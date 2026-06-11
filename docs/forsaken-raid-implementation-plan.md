# Forsaken Raid Implementation Plan

## Status / Gaps

Implemented: `forsaken.json` (full tower + clone timeline), the `forsaken_assign` event,
assignment/marker/ending effects, tower-gated debuff resolution, and soak swaps
(`src/engine/systems/forsakenAssign.ts`). `forsaken-bots.json` has static per-tower and
per-bait spots.

Remaining work:

- Bot solver: replace the static `towerSpots` / `baitSpots` with the positioning rules
  below (group X/Y, odd/even tower spots, stack tie-breaks, close/far past-future baits).

## Encounter Rules

### Groups

- Tower order: `AAABBBBA` (waves 1-3 = A, 4-7 = B, 8 = A).
- Fixed pairs: `h1/mt`, `h2/ot`, `r1/m1`, `r2/m2`.
- Default side split: supports left, DPS right, facing the boss.
- Group A: the pair's two debuffs are `stack + cone`, `stack + defam`, or `cone + defam`.
- Group B: the pair's two debuffs are `cone + cone` or `defam + defam`.
- X = the group whose letter matches the current tower in `AAABBBBA`; Y = the other
  group. X soaks the towers.

### Debuffs

- Kinds: `stack`, `cone`, `defamation`. (No separate spread — defamation is the only
  spread-style debuff. The defamation resolver uses the engine's `spread` action under
  the hood, but is labeled and id'd as defamation: `forsaken-defamation-resolve` /
  `Defamation Charge`.)
- Invisible in the party status list; a head marker icon shows for 5 s
  (`markerDuration`) then disappears. The assignment effect lasts 120 s and is
  reapplied on each swap.
- Initial (odd) set: 2 stacks + 3 cones + 3 defams.
  - One support pair and one DPS pair get the stacks — one pair is `stack + cone`, the
    other `stack + defam` (which pair gets cone vs defam alternates by pattern). These
    are the two A pairs.
  - The remaining support pair and DPS pair are `cone + cone` and `defam + defam` —
    the two B pairs.
- Even set: 4 cones + 4 defams, any order.
- Resolution: only the 2 players inside each tower resolve their debuff (4 per wave
  across the two towers).
- Swap on soak (soakers only):
  - After an odd tower (next wave is even): the 4 soakers receive 2 cones + 2 defams.
  - After an even tower (next wave is odd): the 4 soakers receive 2 stacks + 1 cone +
    1 defam — this guarantees the next odd tower always has its 2 stacks.
  - Implemented as: deal the kinds missing from the next parity's target counts
    (odd `2S/3C/3D`, even `0S/4C/4D`) to the soakers in roster order
    (`mt, ot, h1, h2, r1, r2, m1, m2`). Consequence: post-swap stacks always land on
    the soaking group's tank + healer.
- Missing a tower: lethal damage to all players (`failureDamage`).

### Odd towers

- X cone player resolves on the left side.
- X defam player resolves on the right side.
- X right stack resolves in front, aligned toward new north.
- X left stack resolves on the boss hitbox ring.
- Cone bait aims toward the stack side, not out to the arena edge.
- Y supports handle stack/cone on the left: tank north, healer south, outside the tower.
- Y DPS stand in the stack on the right.

### Stack side tie-breaks

Ordered precedence:

1. If a healer holds a stack: healer left, the other player right.
2. Otherwise tank counts as melee: ranged left, melee/tank right.
3. Same-job stacks should be impossible under the assignment rules; if one occurs,
   lower number goes left (e.g. `r1` left, `r2` right).

### Even towers

Left/right tower is relative to looking at the boss.

- The soaking group X holds 2 cones + 2 defams. The per-pair distribution is either
  mixed (each pair has 1 cone + 1 defam) or split by role (both cones on one pair,
  both defams on the other, either way around).
- Tower split — each tower gets one cone + one defam:
  - Mixed pairs: supports take the left tower, DPS take the right tower (facing the
    boss).
  - Split by role: healer left, tank right; melee DPS left, ranged DPS right — so each
    tower still gets one support + one DPS.
- Within a tower: the cone player stands on the boss hitbox toward the tower's outer
  side, facing the boss; the defam player stands on the north/far side of the tower,
  middle-ish, away from the cone.
- Y supports left, DPS right; Y ranged stand near the waymark to bait the cone.
- Y melee/tank: opposite side from the towers, on the outer boss hitbox — moving
  inward clips the tower/defam damage.

## Assignment Model (implemented)

- Patterns live in `optionals.combinations.forsaken` in `forsaken.json`
  (`rng: false`; patterns `baseline` and `alternate`). Each pair entry sets
  `assignments` and `endings` (`past` / `future`).
- The `forsaken_assign` event (`t: 3`, `duration: 120`, `markerDuration: 5`) applies
  the assignment effect, head marker icon, ending effect, and ending text marker.
- Soak swaps are handled by `resolveForsakenTowerDebuffSwaps` in
  `src/engine/systems/forsakenAssign.ts`.

## Bot Solver

The solver should:

- Read the Forsaken assignment state (current charge per player + group X/Y).
- Move support players to left-side planned spots and DPS to right-side planned spots.
- Use odd tower positioning rules for cone, stack, and defamation.
- Use even tower spots per the rules above.
- Move bait players to max melee close/far bait spots for clone lock-ins
  (close = past, far = future).
- Resume tower positions after clone cleaves.

The initial `forsaken-bots.json` should focus on deterministic clear-path movement, not
cover every possible player-error scenario.

## Timeline (from forsaken.json)

`t` = cast start; resolve = `t + telegraph`. Raid `duration: 118`.
Heal events at t = 18, 29, 39, 49, 60, 71, 81, 91.

| Cast t | Resolve | Event |
| ------ | ------- | ----- |
| 3      | 6       | Forsaken raidwide; `forsaken_assign` applies debuffs at t=3 |
| 11     | 16      | Towers 1 (A) |
| 22     | 27      | Towers 2 (A) |
| 27     | 32      | Past/Future ending 1 stored + clone bait 1 locks (closest) |
| 32     | 37      | Towers 3 (A) + All Ending 1 clone cleaves |
| 42     | 47      | Towers 4 (B) |
| 47     | 54      | Past/Future ending 2 stored + clone bait 2 locks |
| 54     | 58      | Towers 5 (B) + All Ending 2 clone cleaves |
| 64     | 69      | Towers 6 (B) |
| 69     | 74      | Past/Future ending 3 stored + clone bait 3 locks |
| 74     | 79      | Towers 7 (B) + All Ending 3 clone cleaves |
| 84     | 89      | Towers 8 (A) |
| 89     | 96      | Past/Future ending 4 stored + clone bait 4 locks |
| 96     | 102     | All Ending 4 clone cleaves |
| 109    | 112     | Forsaken Ends raidwide |

Clone cleave: 120° cone, length 24, anchored to boss facing; `Forsaken Future` fires
forward (offset 0), `Forsaken Past` fires behind (offset π).

## Tower Coordinates (from forsaken.json)

All towers: radius 4, `requiredCount: 2`, centers on the 7.25 ring. Each wave's two
towers sit 90° apart and the pair rotates 45° clockwise per wave (new north = the
bisector of the pair: NE for wave 1, E for wave 2, ...).

| Wave | Group | Left tower        | Right tower       | Resolve t |
| ---- | ----- | ----------------- | ----------------- | --------- |
| 1    | A     | [0, 7.25] N       | [7.25, 0] E       | 16        |
| 2    | A     | [7.25, 7.25] NE   | [7.25, -7.25] SE  | 27        |
| 3    | A     | [7.25, 0] E       | [0, -7.25] S      | 37        |
| 4    | B     | [7.25, -7.25] SE  | [-7.25, -7.25] SW | 47        |
| 5    | B     | [0, -7.25] S      | [-7.25, 0] W      | 58        |
| 6    | B     | [-7.25, -7.25] SW | [-7.25, 7.25] NW  | 69        |
| 7    | B     | [-7.25, 0] W      | [0, 7.25] N       | 79        |
| 8    | A     | [-7.25, 7.25] NW  | [7.25, 7.25] NE   | 89        |

Waymarks: `A [0, 12] N`, `B [-12, 0] W`, `C [0, -12] S`, `D [12, 0] E`,
`1 [6, 6] NE`, `2 [-6, 6] NW`, `3 [-6, -6] SW`, `4 [6, -6] SE`.

## Implementation Order

1. Fix the bot solver to follow the positioning rules above.
2. Validate against human-slot play, then `forsaken-bots.json`.
3. Validate the raid list and run the full Forsaken sequence in the browser.

## Test Plan
Manual checks:

- Start the Dancing Mad Ultimate Forsaken raid from the raid selector.
- Confirm debuff icons/head markers appear for 5 s, and swaps reapply them per soak.
- Confirm tower order follows the `AAABBBBA` plan.
- Confirm odd tower support/DPS side rules and stack tie-breaks.
- Confirm even tower spots.
- Confirm close/far clone baits lock and past/future cleaves fire front/behind.
- Confirm the final raidwide at resolve t=112 ends the mechanic sequence.
