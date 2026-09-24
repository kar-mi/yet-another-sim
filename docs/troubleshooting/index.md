# Troubleshooting

Start here when something is not working. This page covers sessions, slots, hosting and replays;
anything to do with how the simulator *looks* or *performs* is on
[Browser & performance help](./browsers.md).

## Find your symptom

| What you see | Where to look |
|---|---|
| Low frame rate, stuttering, missing telegraphs | [Browser & performance help](./browsers.md) |
| Your character snapping backwards | [Browser & performance help](./browsers.md#rollbacks-and-rubber-banding) |
| Stuck on **DOWNLOADING CLIENT** | [Browser & performance help](./browsers.md#loading-problems) |
| Everyone else moving but you frozen | [Session and connection](#session-and-connection) |
| Cannot open a friend's session link | [Session and connection](#session-and-connection) |
| Claimed a slot but did not spawn | [Slots and bots](#slots-and-bots) |
| Buttons greyed out and nothing responds | [Host controls](#host-controls) |
| A pull you wanted to review is not listed | [Replays](#replays) |
| Keybinds or HUD layout reset themselves | [Settings that do not stick](#settings-that-do-not-stick) |

## Session and connection

The simulator holds a live WebSocket connection for the whole session.

| Symptom | Likely cause |
|---|---|
| Other players moving, you frozen | Your client fell behind or lost frames — reload the page |
| Everyone frozen at once | The session or the server, not your machine |
| Returned to the landing screen with a notice | The session expired, or your connection dropped (there is no automatic reconnect) — reopen the link |
| Cannot join a friend's link | The URL was truncated; the whole `?s=...` query has to be included |
| Nothing connects at all | WebSocket traffic may be blocked |

**Sessions are joined by URL, not by code.** There is no "join" field — you open the link. If
someone pasted only part of it, or a chat client stripped the query string, they land on the
landing screen and create their *own* session instead of joining yours. The give-away is two people
each thinking they are the host.

**Sessions expire when idle.** An expired session cannot be resurrected; create a new one.

Corporate networks and some VPNs block WebSocket traffic outright. If nothing connects at all while
everything else on the machine works, test from another network before reporting it.

## Slots and bots

**You claimed a slot but did not spawn.** A pull was already running, so the slot was *reserved*
rather than seated — the setup screen says so. The reservation holds, and you enter on the next
pull once the host stops or restarts the current one. In the waiting lobby a claim seats you at once.

**You reloaded the page and lost your place in the pull.** That is by design: a refresh takes you
out of the running pull, but your slot reservation is kept and you rejoin on the next one.

**You cannot claim any slot.** You already hold one, or you are in the observer slot. Release what
you hold first; a player may occupy exactly one slot at a time.

**A bot is standing still or dying repeatedly.** Bot patterns are authored per encounter and are
written for survival, not optimal play. A bot dying early tends to cascade, because stacks and
towers then go unfilled — turn on **BOT∞** while practising so one bot's death does not cost you
the rest of the timeline.

**A raid has no bot movement at all.** Some encounters ship without a bot pattern. The **OPTIONS →
BOTS** tab says so explicitly rather than leaving you guessing.

## Host controls

Almost every "the buttons do not work" report is this: **the host is someone else.**

The host is whoever created the session. It is not something you can claim or transfer from the UI,
but if the host disconnects it passes automatically to the next player in the pull — so the buttons
may suddenly start working for you.
Only the host can change the raid, open **OPTIONS**, press **PLAY**, **PAUSE**, **STOP** or
**RESTART**, and open the replay browser. For everyone else those controls are disabled and the
raid selector is a plain label.

Two host-side cases that look like bugs but are not:

- **PLAY does nothing on a finished pull.** Once the timeline runs out the pull is done; use
  **RESTART**.
- **OPTIONS stops the pull when opened.** That is deliberate — waymark, bot and RNG changes must
  not take effect halfway through a mechanic.

## Replays

**The pull you want is not in the list.** Only **stopped** pulls are recorded. A pull that was
restarted or abandoned without pressing **STOP** was never saved.

**The list is empty in a brand-new session.** Recordings are scoped to the session they were made
in. A new session starts with nothing.

**A recording says `INCOMPATIBLE REPLAY`.** It was recorded by a different version of the client
and cannot be opened by this one.

**Only the host sees the replay browser.** It is behind the same host permission as the playback
controls.

## Settings that do not stick

Keybinds, control scheme, sensitivities, display options, HUD layout, waymark preference and RNG
pins are stored in your own browser, per raid where that applies.

That means they follow you between sessions on the same browser, they do **not** follow you to
another machine or another browser, and clearing site data resets them to defaults. Private windows
start with defaults every time.

## Before reporting a bug

Open an issue at
[github.com/kar-mi/yet-another-sim/issues](https://github.com/kar-mi/yet-another-sim/issues) with:

- **Browser and exact version.** In Chrome: `chrome://version`. "Latest Chrome" is not a version —
  by the time anyone reads the report it means something different.
- **Operating system and version.**
- **What you were doing** — which raid, roughly what point in the pull, and whether you were host.
- **What you expected and what happened**, with a screenshot or clip if the problem is visual.
- **Whether it reproduces**, and whether it also happens in a different browser on the same machine.

That last one separates a bug in the simulator from a problem with one browser's configuration
faster than anything else in the list.

For rendering or performance problems, add the extra details listed under
[Browser & performance help](./browsers.md#what-to-add-for-a-graphics-or-performance-report).
