export interface KeyBindings {
  moveForward: string;
  moveBack: string;
  moveLeft: string;
  moveRight: string;
  jump: string;
  sprint: string;
  antiKnockback: string;
}

export interface Settings {
  mouseSensitivity: number;
  panButton: "left" | "right";
  keyBindings: KeyBindings;
  hotbarMode: "kbm" | "controller";
  controllerSensitivity: number;
  controllerDeadzone: number;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  sprint: "Digit1",
  antiKnockback: "Digit2",
};

const DEFAULTS: Settings = {
  mouseSensitivity: 1,
  panButton: "left",
  keyBindings: { ...DEFAULT_BINDINGS },
  hotbarMode: "kbm",
  controllerSensitivity: 2.0,
  controllerDeadzone: 0.15,
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

export const CONTROLLER_BUTTON_LABELS: Record<ControllerType, string[]> = {
  xbox:     ['A', 'B', 'X', 'Y', 'LT+A', 'LT+B', 'LT+X', 'LT+Y'],
  ps5:      ['✕', '○', '□', '△', 'L2+✕', 'L2+○', 'L2+□', 'L2+△'],
  nintendo: ['B', 'A', 'Y', 'X', 'ZL+B', 'ZL+A', 'ZL+Y', 'ZL+X'],
  unknown:  ['A', 'B', 'X', 'Y', 'LT+A', 'LT+B', 'LT+X', 'LT+Y'],
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      ...DEFAULTS,
      ...saved,
      keyBindings: { ...DEFAULT_BINDINGS, ...saved.keyBindings },
    };
  } catch {
    return { ...DEFAULTS, keyBindings: { ...DEFAULT_BINDINGS } };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
