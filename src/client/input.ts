import type { Intent } from "@shared/types";
import { normalize, shortestAngleDelta, normalizeAngle } from "@shared/math";
import { actionForControllerSlot } from "./actions";
import type { ActionId } from "./actions";
import { DEFAULT_BINDINGS } from "./settings";
import type { KeyBindings, ControllerType } from "./settings";

const keys = new Set<string>();
let jumpPressed = false;
let sprintPressed = false;
let antiKbPressed = false;
let provokePressed = false;
let invincibilityToggled = false;
let keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
let prevButtons: boolean[] = [];
let controllerDeadzone = 0.15;
let selectedGamepadIndex: number | null = null;
let controlScheme: "legacy" | "standard" = "legacy";
let standardFacing = 0;         // client-tracked character facing for standard (char-based) scheme
let standardFacingSynced = false;
let keyboardCameraPan = 0;      // camera yaw delta produced by the last getIntent() call

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

export function setControllerDeadzone(dz: number): void {
  controllerDeadzone = dz;
}

export function setControlScheme(scheme: "legacy" | "standard"): void {
  controlScheme = scheme;
  standardFacingSynced = false; // re-sync the character's facing to the camera on (re)entry
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
  }
}

function pressAction(slot: number): void {
  const actionId = actionForControllerSlot(slot);
  if (actionId) triggerAction(actionId);
}

export function initInput(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === keyBindings.jump && !e.repeat) {
      jumpPressed = true;
      e.preventDefault();
    }
    if (e.code === keyBindings.sprint && !e.repeat) {
      sprintPressed = true;
    }
    if (e.code === keyBindings.antiKnockback && !e.repeat) {
      antiKbPressed = true;
    }
    if (e.code === keyBindings.provoke && !e.repeat) {
      provokePressed = true;
    }
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

  // Gamepad: left stick overrides keyboard movement; face buttons drive the hotbar.
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

    const rtHeld = (gp.buttons[7]?.value ?? 0) > 0.5;
    // PS5 non-standard mapping: physical order is [□,✕,○,△] instead of [A,B,X,Y]
    // Remap to logical slots so ✕(1)→slot0(sprint), △(3)→slot3(jump), etc.
    const ps5Remap = detectType(gp) === 'ps5' && gp.mapping !== 'standard'
      ? [2, 0, 1, 3] as const
      : null;
    for (let i = 0; i < 4; i++) {
      const pressed = gp.buttons[i]?.pressed ?? false;
      const wasPressed = prevButtons[i] ?? false;
      if (pressed && !wasPressed) {
        const slot = ps5Remap ? ps5Remap[i]! : i;
        pressAction(rtHeld ? slot + 4 : slot);
      }
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

  return { move, facing, jump, sprint, antiKnockback, provoke, toggleInvincibility };
}
