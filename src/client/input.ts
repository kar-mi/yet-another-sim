import type { Intent } from "@shared/types";
import { normalize, shortestAngleDelta, normalizeAngle } from "@shared/math";
import {
  CONTROLLER_FACE_BUTTONS,
  CONTROLLER_DPAD_BUTTONS,
  DEFAULT_CONTROLLER_BINDINGS,
} from "./actions";
import type {
  ActionId,
  ControllerBindings,
  ControllerCombo,
  ControllerButtonId,
  ControllerDpadButton,
  ControllerFaceButton,
  ControllerModifier,
} from "./actions";
import { DEFAULT_BINDINGS } from "./settings";
import type { KeyBindings, ControllerType } from "./settings";

const keys = new Set<string>();
let jumpPressed = false;
let sprintPressed = false;
let antiKbPressed = false;
let provokePressed = false;
let swapTargetPressed = false;
let invincibilityToggled = false;
let keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
let controllerBindings: ControllerBindings = { ...DEFAULT_CONTROLLER_BINDINGS };
let prevButtons: boolean[] = [];
let controllerDeadzone = 0.15;
let selectedGamepadIndex: number | null = null;
let controlScheme: "legacy" | "standard" = "legacy";
let standardFacing = 0;         // client-tracked character facing for standard (char-based) scheme
let standardFacingSynced = false;
let keyboardCameraPan = 0;      // camera yaw delta produced by the last getIntent() call
let oneShotSink: (() => void) | null = null;

const STANDARD_TURN_RATE = 2.6; // rad/s character turn from A/D (standard)
const CAMERA_FOLLOW_RATE = 4;   // camera auto-trail responsiveness (standard)

function getGamepad(): Gamepad | null {
  const pads = navigator.getGamepads();
  if (selectedGamepadIndex !== null && pads[selectedGamepadIndex]) {
    return pads[selectedGamepadIndex];
  }
  for (const gp of pads) {
    if (gp) return gp;
  }
  return null;
}

function applyDeadzone(v: number, dz: number): number {
  return Math.abs(v) < dz ? 0 : v;
}

function detectType(gp: Gamepad): ControllerType {
  const id = gp.id.toLowerCase();
  if (id.includes('dualsense') || id.includes('playstation') || id.includes('054c')) return 'ps5';
  if (id.includes('nintendo') || id.includes('pro controller') || id.includes('057e')) return 'nintendo';
  if (id.includes('xbox') || id.includes('xinput') || id.includes('045e')) return 'xbox';
  return 'unknown';
}

function isPs5NonStandard(gp: Gamepad): boolean {
  return detectType(gp) === 'ps5' && gp.mapping !== 'standard';
}

// Physical gamepad button index for each logical button/modifier (standard mapping).
// PS5 non-standard reports its face buttons in physical order [□,✕,○,△]; see the
// "PS5 controller mapping" note. Dpad (12-15) and shoulder/trigger (4-7) indices on a
// non-standard DualSense are device-dependent and should be confirmed on hardware.
const FACE_INDEX_STANDARD: Record<ControllerFaceButton, number> = {
  faceBottom: 0, faceRight: 1, faceLeft: 2, faceTop: 3,
};
const FACE_INDEX_PS5: Record<ControllerFaceButton, number> = {
  faceLeft: 0, faceBottom: 1, faceRight: 2, faceTop: 3,
};
const DPAD_INDEX: Record<ControllerDpadButton, number> = {
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
};
const MODIFIER_INDEX: Record<"LT" | "RT" | "LB" | "RB", number> = {
  LB: 4, RB: 5, LT: 6, RT: 7,
};
const MODIFIER_PRIORITY = ["LT", "RT", "LB", "RB"] as const;
const ALL_BUTTONS: readonly ControllerButtonId[] = [...CONTROLLER_FACE_BUTTONS, ...CONTROLLER_DPAD_BUTTONS];

function physicalIndex(button: ControllerButtonId, gp: Gamepad): number {
  if (button in DPAD_INDEX) return DPAD_INDEX[button as ControllerDpadButton];
  const map = isPs5NonStandard(gp) ? FACE_INDEX_PS5 : FACE_INDEX_STANDARD;
  return map[button as ControllerFaceButton];
}

function activeModifier(gp: Gamepad): ControllerModifier {
  for (const m of MODIFIER_PRIORITY) {
    if ((gp.buttons[MODIFIER_INDEX[m]]?.value ?? 0) > 0.5) return m;
  }
  return "none";
}

// The modifier currently held on the active gamepad (for the layer-aware hotbar).
export function getActiveModifier(): ControllerModifier {
  const gp = getGamepad();
  return gp ? activeModifier(gp) : "none";
}

// The combo currently pressed on the active gamepad (for rebind capture in settings).
// Returns the first held non-modifier button plus the held modifier, or null.
export function readControllerCombo(): ControllerCombo | null {
  const gp = getGamepad();
  if (!gp) return null;
  const modifier = activeModifier(gp);
  for (const button of ALL_BUTTONS) {
    if (gp.buttons[physicalIndex(button, gp)]?.pressed) return { modifier, button };
  }
  return null;
}

export function getControllerInfo(): { index: number; name: string; type: ControllerType } | null {
  const gp = getGamepad();
  if (!gp) return null;
  return { index: gp.index, name: gp.id, type: detectType(gp) };
}

export function listControllers(): { index: number; name: string; type: ControllerType }[] {
  const out: { index: number; name: string; type: ControllerType }[] = [];
  for (const gp of navigator.getGamepads()) {
    if (gp) out.push({ index: gp.index, name: gp.id, type: detectType(gp) });
  }
  return out;
}

export function setActiveGamepad(index: number | null): void {
  selectedGamepadIndex = index;
  prevButtons = []; // avoid carrying button state across a switch
}

export function setKeyBindings(kb: KeyBindings): void {
  keyBindings = kb;
}

export function setControllerBindings(cb: ControllerBindings): void {
  controllerBindings = cb;
}

export function setControllerDeadzone(dz: number): void {
  controllerDeadzone = dz;
}

export function setControlScheme(scheme: "legacy" | "standard"): void {
  controlScheme = scheme;
  standardFacingSynced = false; // re-sync the character's facing to the camera on (re)entry
}

export function setOneShotSink(fn: (() => void) | null): void {
  oneShotSink = fn;
}

// Camera yaw delta (radians) the loop applies to the renderer after sending the intent.
export function getKeyboardCameraPan(): number {
  return keyboardCameraPan;
}

export function getRightStick(): { x: number; y: number } {
  const gp = getGamepad();
  if (!gp) return { x: 0, y: 0 };
  // PS5 non-standard mapping: right-stick Y is on axes[5]; axes[3] is the L2 analog
  // trigger, so reading it here makes the camera pan whenever LT is held.
  const yAxis = detectType(gp) === 'ps5' && gp.mapping !== 'standard' ? 5 : 3;
  return {
    x: applyDeadzone(gp.axes[2] ?? 0, controllerDeadzone),
    y: applyDeadzone(gp.axes[yAxis] ?? 0, controllerDeadzone),
  };
}

export function toggleInvincibility(): void {
  invincibilityToggled = true;
  oneShotSink?.();
}

export function triggerAction(actionId: ActionId): void {
  switch (actionId) {
    case "jump":
      jumpPressed = true;
      break;
    case "sprint":
      sprintPressed = true;
      break;
    case "antiKnockback":
      antiKbPressed = true;
      break;
    case "provoke":
      provokePressed = true;
      break;
    case "swapTarget":
      swapTargetPressed = true;
      break;
  }
}

export function initInput(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    let fired = false;
    keys.add(e.code);
    if (e.code === keyBindings.jump && !e.repeat) {
      jumpPressed = true;
      fired = true;
      e.preventDefault();
    }
    if (e.code === keyBindings.sprint && !e.repeat) {
      sprintPressed = true;
      fired = true;
    }
    if (e.code === keyBindings.antiKnockback && !e.repeat) {
      antiKbPressed = true;
      fired = true;
    }
    if (e.code === keyBindings.provoke && !e.repeat) {
      provokePressed = true;
      fired = true;
    }
    if (e.code === keyBindings.swapTarget && !e.repeat) {
      swapTargetPressed = true;
      fired = true;
      e.preventDefault(); // prevent Tab from moving browser focus
    }
    if (fired) oneShotSink?.();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

export function getIntent(cameraYaw: number, dt: number, mouse: { left: boolean; right: boolean }): Intent {
  const jump = jumpPressed;
  jumpPressed = false;
  const sprint = sprintPressed;
  sprintPressed = false;
  const antiKnockback = antiKbPressed;
  antiKbPressed = false;
  const provoke = provokePressed;
  provokePressed = false;
  const cycleTarget = swapTargetPressed || undefined;
  swapTargetPressed = false;
  const toggleInvincibility = invincibilityToggled || undefined;
  invincibilityToggled = false;

  // Movement axes: fb = forward/back (W/S), strafe = left/right (Q/E).
  let fb = 0, strafe = 0;
  if (keys.has(keyBindings.moveForward)) fb += 1;
  if (keys.has(keyBindings.moveBack)) fb -= 1;
  if (keys.has(keyBindings.strafeLeft)) strafe -= 1;
  if (keys.has(keyBindings.strafeRight)) strafe += 1;

  // A/D: camera pan (standard) or character turn (legacy). +1 = right, -1 = left.
  let pan = 0;
  if (keys.has(keyBindings.cameraPanLeft)) pan -= 1;
  if (keys.has(keyBindings.cameraPanRight)) pan += 1;

  // Gamepad: left stick overrides keyboard movement; face/dpad buttons drive the hotbar.
  const gp = getGamepad();
  let usingStick = false;
  if (gp) {
    const lx = applyDeadzone(gp.axes[0] ?? 0, controllerDeadzone);
    const ly = applyDeadzone(gp.axes[1] ?? 0, controllerDeadzone);
    if (lx !== 0 || ly !== 0) {
      strafe = lx;
      fb = -ly; // gamepad stick up = -1, forward should be +z
      usingStick = true;
    }

    // Each held modifier swaps the whole button layer; with none held only the
    // base ("none") combos fire. Edge-detect per physical button index.
    const active = activeModifier(gp);
    for (const actionId of Object.keys(controllerBindings) as ActionId[]) {
      const combo = controllerBindings[actionId];
      if (combo.modifier !== active) continue;
      const idx = physicalIndex(combo.button, gp);
      const pressed = gp.buttons[idx]?.pressed ?? false;
      if (pressed && !(prevButtons[idx] ?? false)) triggerAction(actionId);
    }
    prevButtons = Array.from(gp.buttons).map(b => b.pressed);
  }

  // Move vector for strafe/forward axes, relative to a given heading angle.
  const relMove = (st: number, f: number, ang: number) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return normalize({ x: st * c + f * s, z: -st * s + f * c });
  };

  let move = { x: 0, z: 0 };
  let facing: number | undefined;
  keyboardCameraPan = 0;

  if (controlScheme === "legacy" && !usingStick) {
    // Legacy = camera-based: W/S + Q/E strafe + A/D all move relative to the camera and combine.
    const lateral = Math.max(-1, Math.min(1, strafe + pan)); // Q/E strafe and A/D both move sideways
    if (lateral !== 0 || fb !== 0) {
      move = relMove(lateral, fb, cameraYaw);
      const heading = Math.atan2(move.x, move.z);
      if (pan !== 0 || strafe === 0) {
        // A/D sidesteps and pure W/S → face the movement direction.
        facing = heading;
      } else if (fb === 0) {
        // Pure Q/E strafe → face camera-forward (sidestep).
        facing = cameraYaw;
      } else if (fb > 0) {
        // W + strafe → forward diagonal = the movement direction.
        facing = heading;
      } else {
        // S + strafe → still a forward diagonal: face opposite the back-diagonal movement.
        facing = Math.atan2(-move.x, -move.z);
      }
    }
    // Mouse pans the camera in legacy (handled by the renderer).
  } else if (usingStick) {
    // Gamepad: camera-relative move, character faces travel; right stick pans the camera.
    if (strafe !== 0 || fb !== 0) {
      move = relMove(strafe, fb, cameraYaw);
      facing = Math.atan2(move.x, move.z);
    }
  } else {
    // Standard = character-based: facing changes ONLY via A/D (turn) or right mouse (face camera).
    if (!standardFacingSynced) { standardFacing = cameraYaw; standardFacingSynced = true; }
    if (mouse.right) {
      standardFacing = cameraYaw;                 // free-look: character faces where the camera points
    } else if (pan !== 0) {
      standardFacing = normalizeAngle(standardFacing + pan * STANDARD_TURN_RATE * dt);
    }
    facing = standardFacing;
    // WSQE move relative to the character's own facing (not the camera).
    const moving = strafe !== 0 || fb !== 0;
    if (moving) move = relMove(strafe, fb, standardFacing);
    // Camera trails behind the character while moving/turning, unless the mouse is driving it.
    if (!mouse.left && !mouse.right && (moving || pan !== 0)) {
      keyboardCameraPan = shortestAngleDelta(cameraYaw, standardFacing) * Math.min(1, dt * CAMERA_FOLLOW_RATE);
    }
  }

  return { move, facing, jump, sprint, antiKnockback, provoke, cycleTarget, toggleInvincibility };
}
