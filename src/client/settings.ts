export interface Settings {
  mouseSensitivity: number;
  panButton: "left" | "right";
}

const DEFAULTS: Settings = { mouseSensitivity: 1, panButton: "left" };
const KEY = "yas_settings";

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
