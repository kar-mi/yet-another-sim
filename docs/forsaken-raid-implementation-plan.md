# Forsaken Raid Implementation Plan

## Summary

Implement Forsaken as a Dancing Mad Ultimate raid plan with two tracks:

1. Author the encounter skeleton with mechanics the simulator already supports.
2. Add the missing reusable mechanics needed for an accurate full Forsaken sequence.

The source notes are in `.claude/docs/forsaken.md`. They define the role-side rules, tower
grouping, odd/even tower positioning, close/far clone baits, tower-only debuff resolution,
and the P2 Forsaken timeline

## Current Support vs Gaps
Bot resolver:
- Forsaken assignment state: support/DPS side, odd/even tower rules, pair groups, group A/B
  classification, and the eight-tower order need to be represented deterministically.
- Bot solver support for the full tower and clone sequence.

## Encounter Rules to Preserve
- Tower Order
  AAABBBBA
- Base party groups:
  - `h1/mt`
  - `h2/ot`
  - `r1/m1`
  - `r2/m2`
- Default side split:
  - Supports left facing the boss.
  - DPS right facing the boss.
- Group classification:
  - Group A if the pair receives `stack + cone` or `stack + defam` or `cone + defam`
  - Group B if the pair receives `cone + cone` or `defam + defam`.
  - Group X/Y will be A/B depending on if tower number ie. tower 1 is A is X, tower 4 is B is X
    X is tower group, Y is non tower
- Odd towers:
  - Group X Cone players resolve on the left side.
  - Group X Spread players resolve on the right side.
  - Group X Right stack resolves in front aligned toward new north.
  - Group X Left stack resolves on the boss hitbox ring.
  - Cone bait should aim toward the stack side, not out to the arena edge.
  - Group Y Non-tower supports always handle stack/cone on the left. tank north and healer south, outside the tower
  - Group Y Non-tower DPS always stand in the stack on the right.
- Same-role stack tie-breaks:
  - Healer left, tank right.
  - ranged left, Melee right,
  - "melee right, tank is melee"

- Even towers:
    cone dps y - in tower, in boss hitbox to the right facing boss
    cone support y in tower, in boss hitbox to the left facing boss
    spread dps y - north middle ish, away from support
    spread support y - north middle ish, away from support

  - group y Supports left, DPS right.
      range near marker to bait cone
  - group y Melee/tank  
      opposite side of the towers
      stand on the outer hitbox; moving inward will cause clipping with damage

- Debuffs:
  - Forsaken assignment debuffs should be invisible in the party status list but show an
    icon/marker over the player's head. icon shows for 5 seconds then dispears, lasts for 60 seconds, only resolves on tower
    odd tower
  - odd one, always 2 stacks, 3 cones, and 3 debuffs
  - even tower , always 4 cone and 4 defam
  - since 4 players in towers will always swap debuff, use that to calculate swapping of two sets
  - if someone misses a tower, apply lethal dmg to all players


## Implementation Changes

### Raid Content

- Add `raids/dancing-mad-ultimate/forsaken.json`.
- Add `raids/dancing-mad-ultimate/forsaken-bots.json`.
- Keep the existing `raids/dancing-mad-ultimate/raid_info.json` category; no category
  rename is needed.
- Use a 20-yalm circular arena to match the existing Dancing Mad Ultimate content unless
  later measurement proves Forsaken needs a larger scale.
Diamond Waymarks

convert using -100
{"Name":"12y Waymarks","MapID":1094,"A":{"X":100.0,"Y":0.0,"Z":88.0,"ID":0,"Active":true},"B":{"X":112.0,"Y":0.0,"Z":100.0,"ID":1,"Active":true},"C":{"X":100.0,"Y":0.0,"Z":112.0,"ID":2,"Active":true},"D":{"X":88.0,"Y":0.0,"Z":100.0,"ID":3,"Active":true},"One":{"X":94.0,"Y":0.0,"Z":94.0,"ID":4,"Active":true},"Two":{"X":106.0,"Y":0.0,"Z":94.0,"ID":5,"Active":true},"Three":{"X":106.0,"Y":0.0,"Z":106.0,"ID":6,"Active":true},"Four":{"X":94.0,"Y":0.0,"Z":106.0,"ID":7,"Active":true}}


### Forsaken Assignment Model

Add a deterministic assignment helper for Forsaken rather than hard-coding every role in
the raid JSON. The helper should produce:

- Pair groups from the four fixed pairs: `h1/mt`, `h2/ot`, `r1/m1`, `r2/m2`.
- Assignment type per player: `cone`, `stack`, `spread`, or `defamation`.
- Group classification: A or B.
- Tower order slot from the notes' `AAA BBBB A` sequence.
- Side and spot metadata for odd/even towers.

For v1, this can live as an `optionals.combinations.forsaken` block if that matches the
existing plant-combination pattern. If the implementation becomes too specialized, use a
dedicated `forsaken_assign` event that applies invisible assignment debuffs at the start
of the Forsaken sequence.

### Bot Solver

Add bot support after the mechanics work for human-controlled slots. The solver should:

- Read the Forsaken assignment state.
- Move support players to left-side planned spots and DPS to right-side planned spots.
- Use odd tower positioning rules for cone, stack, spread, and defamation.
- Use even tower static RMMR spots.
- Move bait players to max melee close/far bait spots for clone lock-ins.
- Resume tower positions after clone cleaves.

The initial `forsaken-bots.json` should focus on deterministic clear-path movement, not
cover every possible player-error scenario.

## Timeline

•  Fight time    Encounter t    Shifted t    Event
  ━━━━━━━━━━━━  ━━━━━━━━━━━━━  ━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   3:28                  208            0    P2 start
  ────────────  ─────────────  ───────────  ────────────────────────────
   3:41                  221           13    Shared tankbuster
  ────────────  ─────────────  ───────────  ────────────────────────────
   3:55                  235           27    Forsaken raidwide
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:08                  248           40    Towers 1 explode
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:19                  259           51    Towers 2 + clone baits 1 past/future
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:24                  264           56    Clones 1 lock in all ending start cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:29                  269           61    Towers 3 + clone cleaves 1 all ending end cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:39                  279           71    Towers 4 + clone baits 2 past/future
  ────────────  ─────────────  ───────────  ──────────────────────────── 
   4:46                  286           78    Clones 2 lock in all ending start cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   4:50                  290           82    Towers 5 + clone cleaves 2 all ending end cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:01                  301           93    Towers 6 + clone baits 3 past/future
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:06                  306           98    Clones 3 lock in all ending start cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:11                  311          103    Towers 7 + clone cleaves 3 all endgn end cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:21                  321          113    Towers 8 + clone baits 4 past/future
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:28                  328          120    Clones 4 lock in all ending start cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:34                  334          126    Clone cleaves 4 all ending end cast
  ────────────  ─────────────  ───────────  ────────────────────────────
   5:41                  341          133    Forsaken ends raidwide

  Shifted authored duration: 142

## Implementation Order
1. Author `forsaken.json` with the full timeline and placeholder assignment icons.
2. Author `forsaken-bots.json` after manual human-slot validation.
3. Validate the raid list and run the full Forsaken sequence in the browser.

## Test Plan

Automated tests:

- Schema accepts `clone_bait` and rejects invalid timing, missing cleave shape, or unknown
  player ids.
- Clone baits lock positions once and resolve from the locked clone state even if players
  move afterward.
- Past/future bait assignment is deterministic for the same seed.
- Tower-gated debuff resolution consumes effects only from valid tower soakers.
- Existing towers without `resolveEffects` still pass current tower tests unchanged.
- Wrong-role lethal tower behavior runs before tower-gated effect resolution.
- `forsaken.json` and `forsaken-bots.json` load through `loadRaid` / `loadBotPatterns`.

Manual checks:

- Start the Dancing Mad Ultimate Forsaken raid from the raid selector.
- Confirm placeholder debuff icons/head markers appear for Forsaken assignments.
- Confirm tower order follows the `AAA BBBB A` plan.
- Confirm odd tower support/DPS side rules and same-role tie-breaks.
- Confirm even tower static defined spots.
- Confirm close/far clone baits lock
- Confirm the final raidwide at `142` ends the mechanic sequence.

Commands:

```powershell
bun test
bun run typecheck
bun run build
```

## Acceptance Criteria

- `docs/forsaken-raid-implementation-plan.md` remains the source of truth for the full
  Forsaken implementation sequence.
- The simulator can load a `Forsaken` raid entry under Dancing Mad Ultimate.
- A player can practice the full tower and clone sequence from P2 start through the ending
  raidwide.
- Unsupported approximations are removed before the raid is considered complete.
- Existing debug raids and Graven Image 3 behavior continue to pass tests.

## Assumptions

- The source note file is `.claude/docs/forsaken.md`.
- The first implementation should prefer reusable mechanics over one-off hard-coded
  Forsaken behavior.
- Placeholder icons are acceptable until final image assets are provided in `static/`.
- Coordinates should start from the existing 20-yalm Dancing Mad Ultimate arena scale.
- Exact clone cleave angles, tower coordinates, and debuff damage values may need one
  tuning pass after browser verification.


    {
      "mark": "1",
      "pos": [-6, -6]
    },
    {
      "mark": "2",
      "pos": [6, -6]
    },
    {
      "mark": "3",
      "pos": [6, 6]
    },
    {
      "mark": "4",
      "pos": [-6, 6]
    }

possible tower positions