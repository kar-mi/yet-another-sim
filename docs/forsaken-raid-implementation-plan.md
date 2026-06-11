# Forsaken Raid Implementation Plan

## Status / Gaps

Implemented: `forsaken.json` (full tower + clone timeline), the `forsaken_assign` event,
assignment/marker/ending effects, tower-gated debuff resolution, soak swaps
(`src/engine/systems/forsakenAssign.ts`), and the rule-driven bot solver
(`src/engine/forsakenSolver.ts` — see "Bot Solver" below). `forsaken-bots.json` keeps
the tower/bait windows plus static spots as a no-plan fallback.

Remaining work: browser smoke test of the full sequence.

## Encounter Rules

### Groups

- Tower order: `AAABBBBA` (waves 1-3 = A, 4-7 = B, 8 = A).
- Fixed pairs: `h1/mt`, `h2/ot`, `r1/m1`, `r2/m2`.
- Callout frame: strat directions are rotated 180° from the authored tower ids —
  callout "left" is the authored `tower-N-right`, callout "south" points radially
  outward (away from the boss). E.g. wave 1: callout-left tower = E tower between
  waymarks 4 and 1; "outside south" of it = at the D marker.
- Default side split: supports west (callout-left side), DPS east. The wave-1 opening
  fan puts supports on the SE arc and DPS on the NW arc.
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
  - One support pair and one DPS pair get the stacks — the support pair is
    `stack + defam` (resolving together in the right tower) and the DPS pair is
    `stack + cone` (left tower), in both patterns. These are the two A pairs.
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

Authored-id terms below; remember the callout frame is flipped (callout-left =
authored right tower).

- The support stack resolves at the middle of the right tower, on the boss ring.
- The cone (any role) resolves in the same right tower, on its outward side, and is
  baited radially outward by the Y healer standing just outside the tower (wave 1: at
  the D marker) — the cone fires away from the boss and the other tower.
- The Y tank holds the right tower's outer flank (toward latRight), outside the tower.
- Support stack + cone + Y healer + Y tank form one 4-person stack.
- The DPS stack resolves on the left tower's inner (boss-side) edge, inside the boss
  ring; the defam (any role) resolves behind it in the same tower — more than 2.5
  from everyone but inside the 4y stack.
- Y DPS join the DPS stack from just outside the tower, between it and the boss —
  DPS stack + defam + both Y DPS = the second 4-person stack.

### Stack side tie-breaks

Ordered precedence (authored ids: left = the DPS-stack tower, right = the
support-stack tower):

1. A DPS-held stack goes left, a support-held stack right.
2. Between two supports (post-swap waves put both stacks on tank + healer): healer
   right, tank left.
3. Same-role fallback: ranged left, then lower number left (e.g. `r1` left, `r2`
   right).

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
- Within a tower: the cone player hugs the tower's inner edge on the ray toward their
  Y baiter (keeping the baiter their nearest player); the defam player stands on the
  north/far side of the tower, away from the cone. (Even-wave towers sit on the
  intercardinals at radius ~10.25.)
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

## Bot Solver (implemented)

`src/engine/forsakenSolver.ts` computes spots from the assignment state during the
authored windows in `forsaken-bots.json`; the static `towerSpots` / `baitSpots` there
remain only as a fallback when no Forsaken plan exists. The static t=0 spots hold the
opening pattern (supports on the SE arc, DPS on the NW arc of the wave-1 frame) until
the first tower window opens at t=9.

- Tower windows: group X/Y from the `AAABBBBA` slot, current charge from active
  effects, then the odd/even positioning rules above (stack tie-breaks and the
  mixed/role-split even tower split included). Positions are computed in the rotating
  new-north frame from the wave's actual `tower-N-left` / `tower-N-right` events.
- Bait windows: everyone clusters toward the new north of the simultaneous tower wave
  (wave 2N+1 for bait N) — past holders at max melee (4.1), future holders far (7.5)
  on the same bearing. The locked closest target is therefore a past baiter, so the
  Past cleave (facing + π) fires away from the towers; a Future lock would aim at the
  cluster itself, equally clear of the towers.
- Bait window 4 runs through the final cleave at t=102 (no towers then, and no heal
  afterward).
- The `boss-facing-lock` event holds boss facing for the whole fight, so only the All
  Ending bait casts turn the boss — cleave directions are deterministic.

The solver covers deterministic clear-path movement, not every player-error scenario;
a missed swap or death falls back to filling open tower slots in roster order.

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
forward (offset 0), `Forsaken Past` fires behind (offset π). Boss facing is locked for
the whole fight (`boss-facing-lock`); each All Ending bait turns the boss toward its
locked (closest) target at cast start and the cleave detonates at cast end from that
facing.

## Tower Coordinates (from forsaken.json)

All towers: radius 3, `requiredCount: 2`. Odd waves use cardinal towers on the 7.25
ring; even waves use intercardinal towers at `(±7.25, ±7.25)` (radius ~10.25). The
boss ring renders at 7.8 (`boss.radius 3 × VISUAL_SCALE 2.6`, visual only) so it
crosses every tower — just outside the odd tower middles, through the even towers'
inner edges. Each
wave's two towers sit 90° apart and the pair rotates 45° clockwise per wave (new
north = the bisector of the pair: NE for wave 1, E for wave 2, ...).

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

1. ~~Fix the bot solver to follow the positioning rules above.~~ Done.
2. Validate against human-slot play.
3. Validate the raid list and run the full Forsaken sequence in the browser.

## Test Plan

Automated (`bun test`): the all-bot full run asserts the swap counts after every tower
wave, zero tower failures, and full-roster survival to the end of the sequence.

Manual checks:

- Start the Dancing Mad Ultimate Forsaken raid from the raid selector.
- Confirm debuff icons/head markers appear for 5 s, and swaps reapply them per soak.
- Confirm tower order follows the `AAABBBBA` plan.
- Confirm odd tower support/DPS side rules and stack tie-breaks.
- Confirm even tower spots.
- Confirm close/far clone baits lock and past/future cleaves fire front/behind.
- Confirm the final raidwide at resolve t=112 ends the mechanic sequence.
