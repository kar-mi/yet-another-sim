import type { Intent } from "../shared/types";
import { normalize } from "../shared/math";

const keys = new Set<string>();

export function initInput(): () => void {
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

export function getIntent(cameraYaw: number): Intent {
  let x = 0, z = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) z += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) z -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;

  if (x === 0 && z === 0) return { move: { x: 0, z: 0 } };

  // Rotate input by camera yaw so WASD is camera-relative
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  return { move: normalize({ x: x * cos + z * sin, z: -x * sin + z * cos }) };
}
