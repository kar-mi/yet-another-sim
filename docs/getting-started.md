# Getting started

This page takes you from opening the site to finishing a pull. It assumes nothing about FFXIV
experience beyond knowing what a tank, a healer and a DPS are.

## Create or join a session

Open the simulator at [yetanothersim.com](https://yetanothersim.com).

The landing screen has a single button, **CREATE NEW SESSION**. Pressing it generates a session id,
puts it in the page URL as `?s=<id>`, and drops you into that session's lobby.

There is no "join by code" field: **you join a session by opening its URL**. Copy the page URL out
of the address bar and send it to the people you want to practise with. Anyone who opens it lands
in the same lobby.

The first person to arrive is the **host**. The host is the only person who can pick the raid,
change options, and start, pause, stop or restart a pull. Everyone else plays their character and
watches the host's decisions take effect.

> If a session sits unused it eventually expires. When that happens the client shows a notice and
> returns you to the landing screen; create a new session and share the new link.

## Claim a party slot

The lobby lists the eight roster slots, always in the same order:

| Slot | Role | Conventional meaning |
|---|---|---|
| `mt` | Tank | Main tank |
| `ot` | Tank | Off tank |
| `h1` | Healer | First healer |
| `h2` | Healer | Second healer |
| `m1` | DPS | Melee 1 |
| `m2` | DPS | Melee 2 |
| `r1` | DPS | Ranged 1 |
| `r2` | DPS | Ranged 2 |

Press **CLAIM** on the slot you want; press **RELEASE** to give it up. Each slot shows `BOT` when
nobody has claimed it, `YOU` for your own slot, and `CLAIMED` for someone else's. You may hold
exactly one slot at a time.

Every unclaimed slot is played by a bot for the whole pull, so a solo player gets a full party of
eight. Which slot you pick matters: mechanics in these encounters are assigned by slot id, not
picked at random per player, so `m1` and `r2` genuinely have different jobs.

There is also an **observer** slot with its own capacity, shown as `OBSERVERS n/m`. Observers watch
the pull without occupying a roster slot, and cannot claim a party slot at the same time.

### Joining while a pull is running

If you arrive mid-pull, claiming a slot **queues** you rather than putting you in immediately, and
the lobby says so: *"Raid in progress. The host must stop the raid for you to join."* Queued players
enter on the next pull, once the host stops the current one.

## Pick a raid

Once the host presses **START**, everyone loads into the arena and the in-game HUD appears.

The **RAID** selector sits at the top of the screen. Only the host's is clickable; for everyone
else it is a read-only label showing what is loaded.

Opening it shows the raid browser: categories on the left (**Default Lobby**, **Dancing Mad
Ultimate**, **Debug**), raids on the right, and a search box that searches across every category at
once. Picking a raid loads it for the whole session and starts it automatically after a short
loading overlay — there is no separate confirm step.

**Default Lobby** is an empty arena with no timeline. It is the right place to warm up on movement,
or to sit while people file in.

## Practise against bots

Bot party members follow the encounter's authored bot pattern. They are written for *survival and
correct mechanic resolution*, not for optimal play, and a few of them deliberately take a simpler
line than a human group would. They are good enough to show you where a mechanic wants people to
stand.

Two HUD buttons make drilling a single mechanic much less painful:

- **🛡∞** toggles your own invincibility, so a mistake does not end the run.
- **BOT∞** does the same for the bots, so one bot dying early does not cascade into a wipe and rob
  you of the rest of the timeline.

There is also a **No Cooldowns** button that removes the cooldown on your own abilities (Sprint,
Anti-knockback, Provoke), which is useful when you are repeating one movement over and over.

None of these change the timeline: casts still resolve on schedule, and damage is still calculated
— you simply do not die from it.

## Control the pull

The playback controls sit under the raid selector, and only the host may use them.

| Button | What it does |
|---|---|
| **START** / **PLAY** | Begins the pull, or resumes a paused one. Shows `START` when the raid is stopped. |
| **PAUSE** | Freezes the simulation where it is. |
| **STOP** | Ends the pull, freezes the world, and saves the recording. |
| **RESTART** | Runs the encounter again from time zero with a fresh seed. |

`PLAY` cannot resume a *finished* pull — once the timeline runs out the host must use `RESTART`.

**STOP is what saves a replay.** A pull that is restarted without stopping is not recorded, so if
you want to review what just happened, stop first.

The host also has an **OPTIONS** button, which stops the pull before opening so that changes cannot
take effect halfway through a mechanic. It has three tabs:

- **WAYMARK** — the ground-marker layout: `Default` (whatever the raid file authored), `Standard`,
  `Mirrored`, or `Wide`.
- **BOTS** — the bot pattern to use. Every Dancing Mad encounter that has bots ships exactly one
  pattern, `Default`; *P4 — Kefka Says* has no bot movement at all and says so.
- **RNG** — the pre-pull random choices for this encounter. Each one can be left on `RNG` to reroll
  every pull, or pinned to a specific outcome so you can drill that case. `RESET` clears every
  pin. Your pins are remembered per raid in your own browser.

Pinning RNG is the single most useful practice tool in the simulator. Rather than rerolling until
the pattern you keep failing comes up, pin it and run it ten times.

## Review what went wrong

After a stopped pull, the host's **▶** toolbar button opens **SESSION RECORDINGS**, listing this
session's pulls with their raid id and length. Pick one to watch it back.

In a replay you get a seek bar, a timestamp you can type into, a jump-to-mechanic dropdown built
from the encounter's named sections, and an **EVENTS** sidebar listing every death and avoidable
hit. Clicking an event pauses, seeks to just before it, and switches the camera to the player it
happened to.

That last part is the point: the sidebar tells you *who* got hit by *what*, and one click puts you
behind their eyes a moment before it landed.

The full detail is in the [simulator guide](./simulator-guide.md#replays).

## Next steps

- Learn the controls and HUD properly: [Simulator guide](./simulator-guide.md)
- Write your own encounter: [Authoring overview](./authoring/index.md)
- Something looks or feels wrong: [Browser & performance help](./troubleshooting/browsers.md)
