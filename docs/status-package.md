# The status package

`src/status/` owns every buff and debuff in the simulation: the template catalog, reference
resolution and validation, the runtime instance shape, lifecycle and behavior dispatch, and the
queries other layers use to read status state. It is imported through the `@status` and
`@status/schema` aliases (see `tsconfig.json`).

The package decides *what a status does*. The engine still owns *when things happen* and *what the
world contains*: ability activation and cooldowns, chains, tethers, targeting, scheduling, spawned
mechanics, physics and the tick order. The client owns asset loading and drawing.

## Layout

```
src/status/
  types.ts          # canonical status, behavior, instance, actor and engine-service contracts
  catalog/
    buffs.ts        # buff templates
    debuffs.ts      # debuff templates, including the Kefka Says marker variants
    index.ts        # the combined, frozen catalog with duplicate-id checks
  resolve.ts        # ref lookup and override rules
  behaviors.ts      # the behavior registry: one handler table entry per behavior kind
  state.ts          # small instance helpers shared by the registry and the operations
  operations.ts     # apply, refresh, remove, consume, and every status query
  lifecycle.ts      # the per-tick dispatch (ticks, full-HP cleanses, expiries, culling)
  schema.ts         # zod validation for authored references (`@status/schema`)
  index.ts          # the public entry point (`@status`)
```

`src/shared/world/effects.ts` re-exports the package types under their existing names
(`EffectSpec`, `StatusEffect`, `EffectBehavior`, …), and `src/shared/world/foundation.ts`
re-exports `DamageType` and `CrystalElement`, so code that imports `@shared/types` keeps working.

## The import boundary

`@status` may import `zod`, the pure vector helpers in `@shared/math`, the deterministic trig in
`@shared/dmath`, and — type-only — the `AOEShape` geometry from `@effects`. It never imports the
engine, the client, the server, `World` or `TickContext`.

Consumers import only `@status` and `@status/schema`, never the files behind them.

`src/status/__tests__/boundaries.test.ts` enforces both rules, and two architectural guards:

- no code outside the package assigns or mutates a `.effects` list, and
- no code outside the package reads `behavior.kind`. Consumers may query status data, but the
  behavior itself is implemented once, in the registry.

## Templates and references

Every authored or engine-generated status is a registered template referenced by id. There are no
inline statuses: the raid schema rejects any status object without a `ref`, for buffs and debuffs
alike.

```yaml
applyEffect: { ref: magic_vulnerability, duration: 12 }
```

The two catalog files are disjoint inputs. `catalog/index.ts` combines them into one lookup
(`STATUS_CATALOG`), throws on a duplicate id, and deep-freezes the result. `statusIds("buff")` and
`statusIds("debuff")` are filtered views of that one catalog, not separate lookup paths.

### Overrides

A reference may override:

- timing — `duration`, `stacks`
- presentation — `name`, `icon`, `marker`, `markerIcon`, `markerIconScale`, `ring`, `countdown`,
  `visibility`, `priority`, `showTimer`, `avoidable`
- grouping — `group`
- behavior parameters — merged shallowly over the template's behavior, so
  `behavior: { multiplier: 3 }` keeps every other field of the template's behavior

A template's identity is locked: its buff/debuff classification (`kind`) and its behavior kind
(`behavior.kind`) cannot change. Restating the same value is allowed; a different one is rejected.

`resolveStatus` returns `{ ok, spec }` or `{ ok: false, error }`. `requireStatus(ref, overrides)`
throws instead and is what engine code uses for the statuses it creates. `overrideStatus(spec,
overrides)` applies the same rules to an already-resolved spec — chains use it to stretch their
debuff over the break window. Resolution builds new objects, so catalog defaults are never touched.

`@status/schema` validates the completed specification after the merge, so a parameter override
that produces an invalid behavior (a negative multiplier, a donut without an inner radius) is
reported at raid load time.

A resolved spec always carries its `ref`, and so does every runtime instance. Chains and line links
store the whole resolved spec on their world entities, not just the status name, so icons, groups
and behavior parameters survive into the applied status.

### Marker variants

Kefka Says applies the real debuffs' icons and names without their behavior while the true outcome
is decided elsewhere. The catalog builds a `<id>_marker` variant from each of those shared
definitions with a `none` behavior, so the name and icon come from one place and nothing needs a
behavior-kind override.

## The behavior registry

`BEHAVIORS` in `behaviors.ts` is typed as `{ [K in StatusBehaviorKind]: BehaviorHandler<K> }`, so
adding a behavior kind without an entry is a compile error. A handler declares only the hooks it
needs:

| Hook | Used for |
|------|----------|
| `onApply` | runtime fields set when the status lands (confusion's locked target) |
| `reapplyKey` / `onReapply` | escalation and alternation on reapplication |
| `onTick` | continuous effects (damage over time) |
| `onExpiry` | everything that fires when the status runs out |
| `onMechanicHit` | element cleansing when a named mechanic hits the carrier |
| `modifyDamage` | vulnerability, mitigation, element vulnerability |
| `survivesLethal` / `cleansesAtFullHp` | the optional rules on `expiryDamage` |
| `modifyKnockback` / `requiredFacing` | directional knockback and the bot facing it needs |
| `blocksKnockback` | knockback immunity |
| `speedMultiplier` | movement speed |
| `disablesInput` / `freezes` / `forcedWalk` | client prediction, sleep, confusion |
| `slot` / `displaySlot` | plant headings from the combination plan and their HUD order |
| `icon` | the fallback HUD icon when a template names none |

`expiryDamage` is the reusable "punish on expiry" behavior. `surviveLethal: true` makes a lethal hit
leave the carrier at 1 HP and remove the status (Primordial Crust); `cleanseAtFullHp: true` removes
it whenever the carrier is at full HP (Accretion); without either it is a plain assignment
penalty. Encounter names and icons live on the templates, not in the behavior.

## Operations and queries

Everything that changes a status list goes through `operations.ts`: `applyStatus`,
`refreshStatus`, `removeStatus`, `removeStatuses`, `consumeStacks`, `notifyMechanicHit`, and the
combat hooks below. They replace the list and any changed instance instead of mutating them, so a
previous `World` snapshot is never altered.

The engine's damage pipeline calls `applyDamageModifiers` and `surviveLethal`; knockback calls
`isKnockbackImmune` and `modifyKnockback`; movement calls `movementControl`, `resolveForcedWalk` and
`movementSpeedMultiplier`. Read-only queries — `hasActiveStatus`, `hasActiveStatusNamed`,
`remainingTime`, `requiredKnockbackFacing`, `urgentSlot`, `statusIcon`, `sortForDisplay`,
`isInputDisabled` — serve the HUD, animation, bots and prediction.

## Engine services

Behaviors that reach into the world do it through a `StatusServices` object the engine builds for
each tick (`src/engine/systems/statusServices.ts`): damage, logging, death records, the seeded RNG,
shape hits, stack shares, target selection, resolved-AoE visuals, gaze checks, unblockable launches,
and scheduling of follow-ups, twisters and plant traps. The adapter contains no status names and no
behavior kinds — it only exposes engine capabilities.

Shape hits and stack shares are the same functions mechanic systems use
(`src/engine/systems/strikes.ts`): status expiries, effect resolvers and spread/stack events share
them. Their differences are explicit arguments — an exempt player for self-centred knockback, an
excluded carrier for resolver cones — rather than separate copies.

Knockback immunity is decided in one place, `knockbackPlayer` in the engine helpers, which asks the
package. The only unblockable path is the motion-check launch, which calls `applyKnockback`
directly; a directional modifier is still consumed by any knockback that actually lands.

## The tick

Phase 4 (`src/engine/systems/statusEffects.ts`) resolves scheduled follow-ups and twisters, records
voluntary motion, then calls `tickStatuses`. For each player in roster order it runs `onTick`
hooks (unless dead or invincible), full-HP cleanses, `onExpiry` hooks for statuses whose expiry
falls in `(previousTime, time]`, and finally drops expired statuses. A status is active while
`appliedAt + duration > time`. Removing a status before its expiry tick never runs its expiry
behavior.

## Sprint and Arm's Length

Both are catalog buffs: `sprint` (`movementSpeed`) and `arms_length` (`knockbackImmunity`). The
engine keeps their activation and cooldowns in player movement and applies the status when the
action fires. Both are grouped, so recasting with cooldowns disabled replaces the active instance.
They are invisible in the effect chips; the HUD shows them in its dedicated buff row by querying
`remainingTime`.

Client prediction keeps its own predicted status list and clock, seeded from the authoritative
player, and applies the same `sprint` template with the same speed query. It never writes to the
authoritative player.

## Adding things

- **A new status** — add a template to `catalog/buffs.ts` or `catalog/debuffs.ts`. The registry
  tests validate it against the schema and check its linked references.
- **A new behavior kind** — add it to `StatusBehavior` in `types.ts`, its zod schema to
  `schema.ts`, and its handler to `behaviors.ts`. The compiler and
  `src/status/__tests__/registry.test.ts` fail until all three exist and at least one template
  uses it.
- **A new engine capability for behaviors** — add it to `StatusServices` and implement it in
  `statusServices.ts`, keeping status knowledge on the package side.

Changing the serialized status shape changes replays and snapshots: bump `REPLAY_FORMAT_VERSION`
and `SNAPSHOT_FORMAT_VERSION` in `src/shared/replay.ts`. Old files are then rejected by the existing
unsupported-version handling; there is no converter.
