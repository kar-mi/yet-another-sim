export interface KeyBindings {
  moveForward: string;
  moveBack: string;
  moveLeft: string;
  moveRight: string;
  jump: string;
  sprint: string;
}

export interface Settings {
  mouseSensitivity: number;
  panButton: "left" | "right";
  keyBindings: KeyBindings;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  sprint: "Digit1",
};

const DEFAULTS: Settings = {
  mouseSensitivity: 1,
  panButton: "left",
  keyBindings: { ...DEFAULT_BINDINGS },
};

const KEY = "yas_settings";

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "SPACE";
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  return code;
}

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
