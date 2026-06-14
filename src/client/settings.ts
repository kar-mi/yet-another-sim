import type { ControllerBindings } from "./actions";
import { DEFAULT_CONTROLLER_BINDINGS } from "./actions";

export interface KeyBindings {
  moveForward: string;
  moveBack: string;
  strafeLeft: string;
  strafeRight: string;
  cameraPanLeft: string;
  cameraPanRight: string;
  jump: string;
  sprint: string;
  antiKnockback: string;
  provoke: string;
}

export interface Settings {
  mouseSensitivity: number;
  controlScheme: "legacy" | "standard";
  keyBindings: KeyBindings;
  controllerBindings: ControllerBindings;
  hotbarMode: "kbm" | "controller";
  controllerSensitivity: number;
  controllerDeadzone: number;
  cameraAccel: boolean;
  cameraAccelStrength: number;
  uiScale: number;
  renderedPlayerHealthBars: boolean;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  strafeLeft: "KeyQ",
  strafeRight: "KeyE",
  cameraPanLeft: "KeyA",
  cameraPanRight: "KeyD",
  jump: "Space",
  sprint: "Digit1",
  antiKnockback: "Digit2",
  provoke: "Digit3",
};

const DEFAULTS: Settings = {
  mouseSensitivity: 1,
  controlScheme: "legacy",
  keyBindings: { ...DEFAULT_BINDINGS },
  controllerBindings: { ...DEFAULT_CONTROLLER_BINDINGS },
  hotbarMode: "kbm",
  controllerSensitivity: 2.0,
  controllerDeadzone: 0.15,
  cameraAccel: false,
  cameraAccelStrength: 1,
  uiScale: 1.125,
  renderedPlayerHealthBars: true,
};

const KEY = "yas_settings";

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "SPACE";
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  return code;
}

export type ControllerType = 'xbox' | 'ps5' | 'nintendo' | 'unknown';


export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      ...DEFAULTS,
      ...saved,
      keyBindings: { ...DEFAULT_BINDINGS, ...saved.keyBindings },
      controllerBindings: { ...DEFAULT_CONTROLLER_BINDINGS, ...saved.controllerBindings },
    };
  } catch {
    return {
      ...DEFAULTS,
      keyBindings: { ...DEFAULT_BINDINGS },
      controllerBindings: { ...DEFAULT_CONTROLLER_BINDINGS },
    };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
