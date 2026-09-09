# Browser & performance help

The simulator renders with Babylon.js, which uses **WebGL/WebGL2**. Almost every "it runs badly"
report comes down to the browser not using the GPU for that.

Everything below is a **diagnostic step, not a confirmed fix**. These are the things worth checking
when the simulator misbehaves; whether any of them helps on your machine is exactly what you are
finding out. If a step does help, that is useful information for a bug report — please say which one.

Heavy lag, characters snapping backwards, and attacks that never draw are the three symptoms that
turn up most often, and in practice they usually share a single cause: the browser has fallen back
to rendering the 3D scene on the CPU instead of the GPU. Start there before assuming the problem is
your hardware or your connection.

## Symptoms and where to look

| What you see | Most likely area |
|---|---|
| Low frame rate, stuttering, fans spinning | Graphics acceleration — start at [step 1](#1-check-that-graphics-acceleration-is-on) |
| Attacks or telegraphs not drawing at all | Graphics acceleration or a WebGL fallback — [step 2](#2-check-webgl-status) |
| Your character snapping backwards ("rollbacks") | Frame rate, not network — see [rollbacks](#rollbacks-and-rubber-banding) |
| Stuck on **DOWNLOADING CLIENT** | Loading, not rendering — see [loading problems](#loading-problems) |
| Performance degrading the longer a tab is open | Browser power/memory saving — [step 5](#5-chrome-energy-and-memory-saver) |

For sessions, slots, hosting and replays, see [Troubleshooting](./index.md) instead.

## Chrome diagnostic steps

`chrome://` addresses cannot be opened from a link — copy the address and paste it into the address
bar yourself.

### 1. Check that graphics acceleration is on

```text
chrome://settings/system
```

Enable **Use graphics acceleration when available**, then relaunch Chrome. The setting only takes
effect after a restart.

This is the single most common cause. With it off, Chrome renders the 3D scene on the CPU, which
looks exactly like "my computer is too slow" even on hardware that is not.

### 2. Check WebGL status

```text
chrome://gpu
```

Look at the **Graphics Feature Status** list. You want:

- **WebGL: Hardware accelerated**
- **WebGL2: Hardware accelerated**

Signs of trouble:

- `Software only, hardware acceleration unavailable`
- `SwiftShader` appearing anywhere — that is Chrome's CPU renderer
- WebGL or WebGL2 listed as `Disabled`

If this page disagrees with what you set in step 1, the relaunch did not happen or something else
is overriding it.

### 3. Reset experimental flags

```text
chrome://flags
```

Press **Reset all**, then relaunch.

**Read this before doing it.** Resetting returns *every* experimental flag to its default, not just
graphics ones. If you have deliberately enabled flags for anything else — a developer feature, a
privacy setting, an unrelated site workaround — those go back to default too. There is no undo
beyond setting them again by hand, so note what you have changed first if you are not sure.

The reason it is on this list: graphics-related flags such as forced Vulkan, forced OpenGL or ANGLE
backend overrides can silently break WebGL on some driver combinations. Resetting is the quickest
way to rule that out.

Do not go the other way and start forcing those backends hoping to improve things. If you want to
test one, do it on a single affected machine and change one flag at a time.

### 4. Windows GPU selection

On a laptop with both integrated and discrete graphics, Windows may be handing Chrome the
integrated GPU.

1. **Settings → System → Display → Graphics**
2. Add or select `chrome.exe`
3. Set it to **High performance**

Relaunch the browser afterwards. Recheck `chrome://gpu` to confirm the reported GPU changed.

### 5. Chrome Energy and Memory Saver

```text
chrome://settings/performance
```

- Turn off **Energy Saver** while playing. It throttles background work and can reduce frame rate
  on battery.
- Turn off **Memory Saver**, or add the simulator to its exceptions list. Memory Saver can discard
  or throttle a tab that has been in the background, which is a problem for a tab holding a live
  session.

## Rollbacks and rubber-banding

"Rollback" here means your character snapping back to a position it was in a moment ago.

The simulator runs the same deterministic simulation in every browser and predicts your own movement
locally so it feels responsive. When your client falls behind — because frames are being missed, not
necessarily because the network is slow — the prediction is corrected against the authoritative
result, and the correction looks like a snap.

So rollbacks are usually a **rendering performance symptom**, and the graphics steps above are the
right place to start. Work through steps 1 and 2 before assuming it is your connection.

If frame rate is clearly fine and it still happens, that is worth reporting, with the details listed
at the end of this page.

## Loading problems

**Stuck on DOWNLOADING CLIENT.** That overlay is plain HTML in the page, shown while the JavaScript
bundle downloads. If it never goes away the bundle did not arrive:

- Hard-reload the page (`Ctrl`+`Shift`+`R`).
- Try a private window, which starts with a clean cache and no extensions.
- Check whether an extension — an ad blocker, script blocker or corporate filter — is blocking the
  script or the font requests.

**Blank page or black canvas after loading.** The client loaded but rendering failed. Check
`chrome://gpu` first, then open the browser console (`F12`) and look for WebGL errors.

## What to add for a graphics or performance report

The [general reporting checklist](./index.md#before-reporting-a-bug) covers browser version, OS and
reproduction steps. For anything visual or performance-related, add:

- **Your GPU, and what `chrome://gpu` says** for WebGL and WebGL2. Copying the Graphics Feature
  Status block is ideal.
- **Which diagnostic steps above you already tried**, and whether any of them changed anything. A
  step that helped is as informative as one that did not.
