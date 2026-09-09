# Simulator guide

Everything the client does, in one place: moving, looking, the HUD, and reviewing a pull.

## Movement and camera

One simulator unit is one FFXIV yalm. You run at **6 units per second**, and Sprint multiplies that
by **1.3** (7.8 units/s) — the same numbers as in game. A standard arena is radius 20, so crossing
the full diameter takes a little under seven seconds at run speed. The full derivation is in
[Movement & scale](./movement-and-scale.md).

There is no acceleration ramp: you reach top speed the instant you press a key, and stop the
instant you release it. Compared to FFXIV this makes very short adjustments slightly generous.

Walking off the floor is fatal. The arena is defined by its zones, and any point outside every zone
is a fall.

### Control schemes

Both schemes are in **Settings → CAMERA → CONTROL SCHEME**, and both drag-rotate the camera with
either mouse button held.

**LEGACY** is camera-based. `W`/`S` move forward and back relative to the camera, `Q`/`E` strafe,
and `A`/`D` also sidestep rather than turning. Your character always faces the way it is travelling.
This is the simplest scheme when you only care about position.

**STANDARD** is character-based. Your facing changes only when you turn with `A`/`D`, or when you
hold the right mouse button, which snaps your character to face where the camera is pointing.
`W`/`S`/`Q`/`E` then move relative to *your character*, not the camera. The camera trails behind you
as you move.

Facing matters more than it first appears: gaze mechanics check which way you are looking, and
directional cleaves resolve against the boss's facing rather than yours.

**MOUSE SENSITIVITY** (0.1–2.0) scales camera drag speed.

### Default keybinds

Every binding is rebindable in **Settings → KEYBINDS**, which shows the keyboard and controller
binding side by side. **RESET KEYBINDS** restores this table.

| Action | Default key |
|---|---|
| Forward | `W` |
| Back | `S` |
| Strafe left | `Q` |
| Strafe right | `E` |
| Camera left / turn left | `A` |
| Camera right / turn right | `D` |
| Jump | `Space` |
| Sprint | `1` |
| Anti-knockback | `2` |
| Provoke | `3` |
| Target swap | `Tab` |

Sprint, Anti-knockback and Provoke are the three hotbar abilities and have cooldowns. Anti-knockback
is the simulator's Arm's Length: use it before a knockback resolves, not after.

### Controller

Connect a gamepad and it is detected automatically; **Settings → CONTROLLER** shows the detected
type and name, and lets you choose between multiple connected pads.

The left stick moves (camera-relative, character faces travel) and the right stick pans the camera.
Face and d-pad buttons drive the hotbar and are rebindable alongside the keyboard bindings.

Two options tune the camera stick: **CONTROLLER SENSITIVITY** (0.5–6.0) and **CAMERA ACCELERATION**
with its own **ACCELERATION STRENGTH** (0–3). Acceleration makes small stick deflections turn slowly
and large ones turn quickly, which suits fine aiming; turn it off if you want a linear response.

## The HUD

| Element | What it shows |
|---|---|
| Hotbar | Sprint, Anti-knockback and Provoke with their cooldowns. The **⌨** button switches between keyboard and controller display. |
| Buffs | Buffs you currently hold, such as Sprint or the Anti-knockback window. |
| Debuff tracker | Your debuffs with their remaining time. This is the panel every Dancing Mad encounter is really played out of. |
| Resources | HP and MP bars, plus the invincibility, bot-invincibility and No Cooldowns toggles. |
| Boss casts | Cast bars for every boss currently casting, named as the timeline names them. |
| Raid selector | The current raid, playback controls, and (for the host) OPTIONS. |
| Minimap | A top-down view of the arena with player and mechanic positions. |

### Position helper

Inside the hotbar panel is a small position readout used mainly for authoring. The **⌖** button
prints your current coordinates, and clicking the readout copies them — which is how most of the
spots in the raid YAML files were found. The **World** button chooses which frame the readout is
expressed in (world coordinates, or a frame relative to a boss or mechanic).

### Editing the HUD layout

The **▦** toolbar button (also **EDIT HUD LAYOUT** in Settings → Display) enters layout mode:

- Drag an element to move it.
- Drag the handles on the selected element to resize it.
- Right-click an element to hide or show it.
- **SAVE & CLOSE** to keep the layout.

The layout is stored in your own browser and persists across sessions.

## Display options

**Settings → DISPLAY** holds the presentation options:

- **RENDERED PLAYER HP BARS** — floating HP bars above party members in the 3D view.
- **UI FONT** — `PIXEL (JERSEY 10)` for the arcade look, or `READABLE (CHAKRA PETCH)` if the pixel
  font is hard to read. The readable font is the default.
- **UI SCALE** — XS through XL. Raise this on a high-DPI display before assuming the HUD is broken.

## Host permissions

Being host is a property of the *session*, held by whoever created it. It is not something you can
claim or transfer from the UI.

Only the host can:

- change the raid,
- open **OPTIONS** (waymarks, bot pattern, RNG pins),
- press **PLAY**, **PAUSE**, **STOP** or **RESTART**,
- open the **▶** replay browser.

Everyone else's copies of those controls are disabled, and the raid selector is a plain label. If
you are not the host and nothing responds, that is why.

## Replays

Every pull is recorded, and **stopping** a pull is what saves the recording. A pull that is
restarted or abandoned without a stop is not kept.

The host opens **▶** in the top-right toolbar to get **SESSION RECORDINGS**: one row per pull,
labelled `Pull n` with the raid id and the length in seconds, plus a search box. Recordings are
scoped to the session — a new session starts with an empty list. A recording made by an
incompatible older version of the client is listed as `INCOMPATIBLE REPLAY` and cannot be opened.

### Reviewing a pull

Watching a replay replaces the live simulator until you press **⏎** (back to simulator). You get:

**Playback** — `PLAY`, `PAUSE` and `RESTART`, a seek bar, and a timestamp field you can type into
directly (`mm:ss`, or just seconds).

**Jump to mechanic** — a dropdown built from the encounter's named sections, each with its
timestamp. These are authored bookmarks like *Towers 1-2*, *Grand Cross 1* or *Black Hole 3*; they
are labels only and have no effect on the simulation. Every walkthrough in these docs lists its
encounter's sections, so you can find a mechanic by name rather than by scrubbing.

**The EVENTS sidebar** — every death and every avoidable hit in the pull, in time order, each row
showing the timestamp, whether it was a death (☠) or a hit (⚠), the source that caused it, the
player it happened to, and the damage. You can filter to `DEATHS` or `AVOIDABLE HITS`, filter to one
party member, or search across player, source and section names.

Clicking a row does three things at once: it pauses, seeks to shortly *before* the event, and
switches the camera to spectate the player it happened to. That combination is what makes review
worth doing — you see the mistake from the position of the person who made it, with enough lead time
to see what they should have done instead.

"Avoidable" is a property the encounter author tags onto a damage source. A raidwide that everyone
is meant to eat is not avoidable and will not clutter the sidebar; a cone you were supposed to dodge
is. So an empty `AVOIDABLE HITS` list genuinely means nobody made a positioning mistake.

## Where things are stored

Your keybinds, control scheme, sensitivities, display options, HUD layout, waymark preference and
RNG pins live in your own browser, per raid where that makes sense. They follow you between sessions
on the same browser and do not follow you to another machine. Clearing site data resets them to
defaults.
