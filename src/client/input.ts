import type { Intent } from "../shared/types";
import { normalize } from "../shared/math";
import { DEFAULT_BINDINGS } from "./settings";
import type { KeyBindings } from "./settings";

const keys = new Set<string>();
let jumpPressed = false;
let sprintPressed = false;
let keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };

export function setKeyBindings(kb: KeyBindings): void {
  keyBindings = kb;
}

export function pressAction(slot: number): void {
  if (slot === 0) sprintPressed = true;
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

  if (x === 0 && z === 0) return { move: { x: 0, z: 0 }, jump, sprint };

  // Rotate input by camera yaw so movement is camera-relative
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  return { move: normalize({ x: x * cos + z * sin, z: -x * sin + z * cos }), jump, sprint };
}
