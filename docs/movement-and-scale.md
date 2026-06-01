# Movement & Scale

How the sim's distances and movement speed map to FFXIV. The goal is that a fight
ports over 1:1 from the game: **1 sim unit = 1 FFXIV yalm**, and travel times match.

## Constants

All defined in `src/engine/sim.ts`. Movement is server-authoritative — only these
engine constants govern it; the client just sends intents and renders snapshots.

| Constant | Value | Meaning |
|----------|-------|---------|
| `MOVE_SPEED` | `6` | Run speed in units/s (= FFXIV yalms/s). |
| `SPRINT_MULTIPLIER` | `1.3` | Sprint multiplies run speed → 7.8 units/s. |

A standard single-circle arena is **radius ≈ 20** (FFXIV's common arena size).
Author distances, radii, spawns, and waymarks directly in yalms.

## Why 6.0 (and not 5.69)

Derived from real FFXIV measurements in a radius-20 arena (cardinal waymarks at
the edge, C→A diameter = 39.81 yalms):

- C→A normal run was measured at **7 s** → 39.81 / 7 ≈ 5.69 yalms/s.
- FFXIV's canonical run speed is **6.0 yalms/s** (39.81 / 6 = 6.64 s).

The 0.36 s gap is FFXIV's **standstill acceleration ramp** — the player spends the
first fraction of a second speeding up. This sim has **no acceleration model**:
players hit top speed instantly. So we match FFXIV's *top* speed (6.0), which makes
steady-state movement identical. The trade-off is that a full edge-to-edge crossing
in the sim is ~0.3 s faster than the in-game stopwatch (the sim doesn't lose the ramp
time). Matching the measured 7 s instead (5.69) would have made all steady-state
movement ~5% too slow, which is worse.

Sprint is **1.3×**, matching FFXIV's in-combat Sprint (+30%).

## Notes

- `botIntent.ts` imports `MOVE_SPEED`, so bots and players always move at the same
  speed — no separate bot constant to keep in sync.
- Some older raids (e.g. `sample-raid.json` at radius 38) predate this scale and were
  not rescaled. New raids should be authored in yalms.
- Changing `MOVE_SPEED` can break tests with fixed-duration travel assertions (e.g.
  the "walks off arena" fall test, whose tick window assumed the old speed). Run
  `bun test` and adjust durations, not behavior, if any surface.
