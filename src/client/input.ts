import type { Intent } from "../shared/types";
import { normalize } from "../shared/math";
import { DEFAULT_BINDINGS } from "./settings";
import type { KeyBindings } from "./settings";

const keys = new Set<string>();
let jumpPressed = false;
let sprintPressed = false;
let keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
let prevButtons: boolean[] = [];
let controllerDeadzone = 0.15;

function getGamepad(): Gamepad | null {
  for (const gp of navigator.getGamepads()) {
    if (gp) return gp;
  }
  return null;
}

function applyDeadzone(v: number, dz: number): number {
  return Math.abs(v) < dz ? 0 : v;
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
  return {
    x: applyDeadzone(gp.axes[2] ?? 0, controllerDeadzone),
    y: applyDeadzone(gp.axes[3] ?? 0, controllerDeadzone),
  };
}

export function pressAction(slot: number): void {
  if (slot === 0 || slot === 7) sprintPressed = true; // KBM slot-0 click or controller LT+Y
  if (slot === 3) jumpPressed = true;                 // controller Y = jump
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

    const ltHeld = (gp.buttons[6]?.value ?? 0) > 0.5;
    for (let i = 0; i < 4; i++) {
      const pressed = gp.buttons[i]?.pressed ?? false;
      const wasPressed = prevButtons[i] ?? false;
      if (pressed && !wasPressed) {
        pressAction(ltHeld ? i + 4 : i);
      }
    }
    prevButtons = Array.from(gp.buttons).map(b => b.pressed);
  }

  if (x === 0 && z === 0) return { move: { x: 0, z: 0 }, jump, sprint };

  // Rotate input by camera yaw so movement is camera-relative
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  return { move: normalize({ x: x * cos + z * sin, z: -x * sin + z * cos }), jump, sprint };
}
