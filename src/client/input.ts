import type { Intent } from "../shared/types";
import { normalize } from "../shared/math";
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

export function pressAction(slot: number): void {
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

export function getIntent(cameraYaw: number): Intent {
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

  let x = 0, z = 0;
  if (keys.has(keyBindings.moveForward)) z += 1;
  if (keys.has(keyBindings.moveBack)) z -= 1;
  if (keys.has(keyBindings.moveLeft)) x -= 1;
  if (keys.has(keyBindings.moveRight)) x += 1;

  const gp = getGamepad();
  if (gp) {
    const lx = applyDeadzone(gp.axes[0] ?? 0, controllerDeadzone);
    const ly = applyDeadzone(gp.axes[1] ?? 0, controllerDeadzone);
    if (lx !== 0 || ly !== 0) {
      x = lx;
      z = -ly; // gamepad stick up = -1, forward should be +z
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

  if (x === 0 && z === 0) return { move: { x: 0, z: 0 }, jump, sprint, antiKnockback, provoke, toggleInvincibility };

  // Rotate input by camera yaw so movement is camera-relative
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  return { move: normalize({ x: x * cos + z * sin, z: -x * sin + z * cos }), jump, sprint, antiKnockback, provoke, toggleInvincibility };
}
