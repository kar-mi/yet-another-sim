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
  swapTarget: string;
}

export type HudGroupId = "party" | "hotbar" | "buffs" | "debuffs" | "resources" | "targetcast" | "bosscasts" | "timer" | "raidselector" | "replayevents" | "replayseek" | "minimap";

export interface HudGroupLayout {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  hidden: boolean;
}

const HUD_GROUPS: readonly HudGroupId[] = [
  "party", "hotbar", "buffs", "debuffs", "resources", "targetcast", "bosscasts", "timer", "raidselector",
  "replayevents", "replayseek", "minimap",
];

export const HUD_GROUP_LABELS: Record<HudGroupId, string> = {
  party: "Party List",
  hotbar: "Hotbar",
  buffs: "Buffs",
  debuffs: "Debuffs",
  resources: "HP / MP",
  targetcast: "Boss Cast Bar",
  bosscasts: "All Boss Casts",
  timer: "Timer",
  raidselector: "Raid Selector",
  replayevents: "Replay Events",
  replayseek: "Replay Seek Bar",
  minimap: "Minimap",
};

export const DEFAULT_HUD_LAYOUT: Record<HudGroupId, HudGroupLayout> = {
  hotbar: { x: 0.5052360701284252, y: 0.872830607757346, scale: 0.7, opacity: 0, hidden: false },
  debuffs: { x: 0.2901446439068872, y: 0.8750778037476836, scale: 0.6760804241689639, opacity: 0.34, hidden: false },
  resources: { x: 0.516154920284692, y: 0.9741880254619419, scale: 0.7, opacity: 1, hidden: false },
  bosscasts: { x: 0.7287770499512639, y: 0.7377124165993336, scale: 1, opacity: 0, hidden: false },
  timer: { x: 0.6029839049015961, y: 0.03804923684032202, scale: 0.6009382178436431, opacity: 0, hidden: false },
  raidselector: { x: 0.5037860125902104, y: 0.054555068125830095, scale: 1, opacity: 1, hidden: false },
  party: { x: 0.09028931244598525, y: 0.24041641353184845, scale: 0.9005636984521633, opacity: 0.43, hidden: false },
  targetcast: { x: 0.49902852419601074, y: 0.17075942920270956, scale: 1, opacity: 1, hidden: false },
  buffs: { x: 0.2899740953804115, y: 0.8149130143741858, scale: 0.6751756507521396, opacity: 0.3, hidden: false },
  minimap: { x: 0.9504122467762206, y: 0.17446841794729456, scale: 0.690400146484375, opacity: 0.62, hidden: false },
  replayevents: { x: 0.7629295197360986, y: 0.30284235951820393, scale: 1, opacity: 1, hidden: false },
  replayseek: { x: 0.26021691472362224, y: 0.14402454460006042, scale: 1, opacity: 1, hidden: false },
};

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
  uiFont: "pixel" | "readable";
  renderedPlayerHealthBars: boolean;
  minimapZoom: number;
  hudLayout: Partial<Record<HudGroupId, HudGroupLayout>>;
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
  swapTarget: "Tab",
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
  uiScale: 1.25,
  uiFont: "readable",
  renderedPlayerHealthBars: false,
  minimapZoom: 2,
  hudLayout: { ...DEFAULT_HUD_LAYOUT },
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
      minimapZoom: typeof saved.minimapZoom === "number" ? Math.min(4, Math.max(1, saved.minimapZoom)) : DEFAULTS.minimapZoom,
      hudLayout: { ...DEFAULT_HUD_LAYOUT, ...saved.hudLayout },
    };
  } catch {
    return {
      ...DEFAULTS,
      keyBindings: { ...DEFAULT_BINDINGS },
      controllerBindings: { ...DEFAULT_CONTROLLER_BINDINGS },
      hudLayout: { ...DEFAULT_HUD_LAYOUT },
    };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
