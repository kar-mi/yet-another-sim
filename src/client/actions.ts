import type { ControllerType, KeyBindings } from "./settings";

export type ActionId = "jump" | "sprint" | "antiKnockback" | "provoke";

export interface ActionMeta {
  label: string;
  icon: string;
  keyBinding: keyof KeyBindings;
  keyboardSlot?: number;
}

export const ACTIONS: Record<ActionId, ActionMeta> = {
  jump: {
    label: "JUMP",
    icon: "↑",
    keyBinding: "jump",
  },
  sprint: {
    label: "SPRINT",
    icon: "⚡",
    keyBinding: "sprint",
    keyboardSlot: 0,
  },
  antiKnockback: {
    label: "ANTI-KB",
    icon: "🛡",
    keyBinding: "antiKnockback",
    keyboardSlot: 1,
  },
  provoke: {
    label: "PROVOKE",
    icon: "🎯",
    keyBinding: "provoke",
    keyboardSlot: 2,
  },
};

export const KEYBOARD_HOTBAR_SLOT_COUNT = 10;
export const KEYBOARD_HOTBAR_ACTIONS = ["sprint", "antiKnockback", "provoke"] as const satisfies readonly ActionId[];

export const KEY_BINDING_LABELS: Record<keyof KeyBindings, string> = {
  moveForward: "FORWARD",
  moveBack: "BACK",
  strafeLeft: "STRAFE LEFT",
  strafeRight: "STRAFE RIGHT",
  cameraPanLeft: "CAM LEFT",
  cameraPanRight: "CAM RIGHT",
  jump: ACTIONS.jump.label,
  sprint: ACTIONS.sprint.label,
  antiKnockback: ACTIONS.antiKnockback.label,
  provoke: ACTIONS.provoke.label,
};

// ── Controller bindings ──────────────────────────────────────────────────────
// A controller "combo" is a button (face or dpad) optionally gated by a held
// modifier (LT/RT/LB/RB). Each modifier swaps the whole 8-button layer, so
// none + 4 modifiers = 5 layers of 8 buttons = 40 bindable combos.

export type ControllerModifier = "none" | "LT" | "RT" | "LB" | "RB";

export type ControllerFaceButton = "faceTop" | "faceLeft" | "faceRight" | "faceBottom";
export type ControllerDpadButton = "dpadUp" | "dpadLeft" | "dpadRight" | "dpadDown";
export type ControllerButtonId = ControllerFaceButton | ControllerDpadButton;

export const CONTROLLER_FACE_BUTTONS: readonly ControllerFaceButton[] = [
  "faceTop", "faceLeft", "faceRight", "faceBottom",
];
export const CONTROLLER_DPAD_BUTTONS: readonly ControllerDpadButton[] = [
  "dpadUp", "dpadLeft", "dpadRight", "dpadDown",
];
export const CONTROLLER_MODIFIERS = ["LT", "RT", "LB", "RB"] as const;

// Diamond position of each button so the hotbar can lay them out (top/left/right/bottom).
export const CONTROLLER_BUTTON_POSITION: Record<ControllerButtonId, "top" | "left" | "right" | "bottom"> = {
  faceTop: "top", faceLeft: "left", faceRight: "right", faceBottom: "bottom",
  dpadUp: "top", dpadLeft: "left", dpadRight: "right", dpadDown: "bottom",
};

export interface ControllerCombo {
  modifier: ControllerModifier;
  button: ControllerButtonId;
}

export type ControllerBindings = Record<ActionId, ControllerCombo>;

export const DEFAULT_CONTROLLER_BINDINGS: ControllerBindings = {
  jump:          { modifier: "none", button: "faceTop" },
  sprint:        { modifier: "none", button: "faceBottom" },
  antiKnockback: { modifier: "none", button: "dpadUp" },
  provoke:       { modifier: "none", button: "dpadDown" },
};

export interface ControllerGlyphs {
  face: Record<ControllerFaceButton, string>;
  dpad: Record<ControllerDpadButton, string>;
  modifiers: Record<"LT" | "RT" | "LB" | "RB", string>;
}

const DPAD_GLYPHS: Record<ControllerDpadButton, string> = {
  dpadUp: "↑", dpadLeft: "←", dpadRight: "→", dpadDown: "↓",
};

export const CONTROLLER_GLYPHS: Record<ControllerType, ControllerGlyphs> = {
  xbox: {
    face: { faceTop: "Y", faceLeft: "X", faceRight: "B", faceBottom: "A" },
    dpad: DPAD_GLYPHS,
    modifiers: { LT: "LT", RT: "RT", LB: "LB", RB: "RB" },
  },
  ps5: {
    face: { faceTop: "△", faceLeft: "□", faceRight: "○", faceBottom: "✕" },
    dpad: DPAD_GLYPHS,
    modifiers: { LT: "L2", RT: "R2", LB: "L1", RB: "R1" },
  },
  nintendo: {
    face: { faceTop: "X", faceLeft: "Y", faceRight: "A", faceBottom: "B" },
    dpad: DPAD_GLYPHS,
    modifiers: { LT: "ZL", RT: "ZR", LB: "L", RB: "R" },
  },
  unknown: {
    face: { faceTop: "Y", faceLeft: "X", faceRight: "B", faceBottom: "A" },
    dpad: DPAD_GLYPHS,
    modifiers: { LT: "LT", RT: "RT", LB: "LB", RB: "RB" },
  },
};

export function buttonGlyph(button: ControllerButtonId, glyphs: ControllerGlyphs): string {
  return button in glyphs.face
    ? glyphs.face[button as ControllerFaceButton]
    : glyphs.dpad[button as ControllerDpadButton];
}

// Composes a combo's display string, e.g. "R2+△" or "↑".
export function comboLabel(combo: ControllerCombo, glyphs: ControllerGlyphs): string {
  const btn = buttonGlyph(combo.button, glyphs);
  return combo.modifier === "none" ? btn : `${glyphs.modifiers[combo.modifier]}+${btn}`;
}

export function actionForKeyboardSlot(slot: number): ActionId | undefined {
  return KEYBOARD_HOTBAR_ACTIONS.find(actionId => ACTIONS[actionId].keyboardSlot === slot);
}

// The action bound to a given combo in the current bindings, if any.
export function actionForCombo(
  bindings: ControllerBindings,
  modifier: ControllerModifier,
  button: ControllerButtonId,
): ActionId | undefined {
  return (Object.keys(bindings) as ActionId[]).find(
    id => bindings[id].modifier === modifier && bindings[id].button === button,
  );
}
