import type { Intent } from "@model/types";
import { normalize, shortestAngleDelta, normalizeAngle, type Vec2 } from "@shared/math";
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
let cooldownsToggled = false;
let keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
let controllerBindings: ControllerBindings = { ...DEFAULT_CONTROLLER_BINDINGS };
let prevButtons: boolean[] = [];
let controllerDeadzone = 0.15;
let selectedGamepadIndex: number | null = null;
let controlScheme: "legacy" | "standard" = "legacy";
let standardFacing = 0;
let standardFacingSynced = false;
let keyboardCameraPan = 0;
let oneShotSink: (() => void) | null = null;
let cachedPads: ReturnType<typeof navigator.getGamepads> | null = null;
let inputSuppressed = false;

const STANDARD_TURN_RATE = 2.6;
const CAMERA_FOLLOW_RATE = 4;

function getGamepad(): Gamepad | null {
  const pads = cachedPads ?? navigator.getGamepads();
  if (selectedGamepadIndex !== null && pads[selectedGamepadIndex]) {
    return pads[selectedGamepadIndex];
  }
  for (const gp of pads) {
    if (gp) return gp;
  }
  return null;
}

function relMove(st: number, f: number, ang: number): Vec2 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return normalize({ x: st * c + f * s, z: -st * s + f * c });
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

export function getActiveModifier(): ControllerModifier {
  const gp = getGamepad();
  return gp ? activeModifier(gp) : "none";
}

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
  prevButtons.length = 0;
  cachedPads = null;
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
  standardFacingSynced = false;
}

export function setOneShotSink(fn: (() => void) | null): void {
  oneShotSink = fn;
}

export function getKeyboardCameraPan(): number {
  return keyboardCameraPan;
}

export function getRightStick(): { x: number; y: number } {
  const gp = inputSuppressed ? null : getGamepad();
  if (!gp) return { x: 0, y: 0 };
  const yAxis = detectType(gp) === 'ps5' && gp.mapping !== 'standard' ? 5 : 3;
  return {
    x: applyDeadzone(gp.axes[2] ?? 0, controllerDeadzone),
    y: applyDeadzone(gp.axes[yAxis] ?? 0, controllerDeadzone),
  };
}

export function toggleCooldowns(): void {
  cooldownsToggled = true;
  oneShotSink?.();
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

export function setGameplayInputSuppressed(suppressed: boolean): void {
  inputSuppressed = suppressed;
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
      e.preventDefault();
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
  cachedPads = navigator.getGamepads();
  if (inputSuppressed) {
    keys.clear();
    jumpPressed = sprintPressed = antiKbPressed = provokePressed = swapTargetPressed = false;
    invincibilityToggled = false;
    cooldownsToggled = false;
    keyboardCameraPan = 0;
    const pad = getGamepad();
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i++) prevButtons[i] = pad.buttons[i].pressed;
      prevButtons.length = pad.buttons.length;
    }
    return { move: { x: 0, z: 0 } };
  }
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
  const toggleCooldowns = cooldownsToggled || undefined;
  cooldownsToggled = false;
  const toggleInvincibility = invincibilityToggled || undefined;
  invincibilityToggled = false;

  let fb = 0, strafe = 0;
  if (keys.has(keyBindings.moveForward)) fb += 1;
  if (keys.has(keyBindings.moveBack)) fb -= 1;
  if (keys.has(keyBindings.strafeLeft)) strafe -= 1;
  if (keys.has(keyBindings.strafeRight)) strafe += 1;

  let pan = 0;
  if (keys.has(keyBindings.cameraPanLeft)) pan -= 1;
  if (keys.has(keyBindings.cameraPanRight)) pan += 1;

  const gp = getGamepad();
  let usingStick = false;
  if (gp) {
    const lx = applyDeadzone(gp.axes[0] ?? 0, controllerDeadzone);
    const ly = applyDeadzone(gp.axes[1] ?? 0, controllerDeadzone);
    if (lx !== 0 || ly !== 0) {
      strafe = lx;
      fb = -ly;
      usingStick = true;
    }

    const active = activeModifier(gp);
    for (const actionId of Object.keys(controllerBindings) as ActionId[]) {
      const combo = controllerBindings[actionId];
      if (combo.modifier !== active) continue;
      const idx = physicalIndex(combo.button, gp);
      const pressed = gp.buttons[idx]?.pressed ?? false;
      if (pressed && !(prevButtons[idx] ?? false)) triggerAction(actionId);
    }
    for (let i = 0; i < gp.buttons.length; i++) prevButtons[i] = gp.buttons[i].pressed;
    if (prevButtons.length > gp.buttons.length) prevButtons.length = gp.buttons.length;
  }

  let move = { x: 0, z: 0 };
  let facing: number | undefined;
  keyboardCameraPan = 0;

  if (controlScheme === "legacy" && !usingStick) {
    const lateral = Math.max(-1, Math.min(1, strafe + pan));
    if (lateral !== 0 || fb !== 0) {
      move = relMove(lateral, fb, cameraYaw);
      const heading = Math.atan2(move.x, move.z);
      if (pan !== 0 || strafe === 0) {
        facing = heading;
      } else if (fb === 0) {
        facing = cameraYaw;
      } else if (fb > 0) {
        facing = heading;
      } else {
        facing = Math.atan2(-move.x, -move.z);
      }
    }
  } else if (usingStick) {
    if (strafe !== 0 || fb !== 0) {
      move = relMove(strafe, fb, cameraYaw);
      facing = Math.atan2(move.x, move.z);
    }
  } else {
    if (!standardFacingSynced) { standardFacing = cameraYaw; standardFacingSynced = true; }
    if (mouse.right) {
      standardFacing = cameraYaw;
    } else if (pan !== 0) {
      standardFacing = normalizeAngle(standardFacing + pan * STANDARD_TURN_RATE * dt);
    }
    facing = standardFacing;
    const moving = strafe !== 0 || fb !== 0;
    if (moving) move = relMove(strafe, fb, standardFacing);
    if (!mouse.left && !mouse.right && (moving || pan !== 0)) {
      keyboardCameraPan = shortestAngleDelta(cameraYaw, standardFacing) * Math.min(1, dt * CAMERA_FOLLOW_RATE);
    }
  }

  return { move, facing, jump, sprint, antiKnockback, provoke, cycleTarget, toggleInvincibility, toggleCooldowns };
}
