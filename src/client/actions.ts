import type { ControllerType, KeyBindings } from "./settings";

export type ActionId = "jump" | "sprint" | "antiKnockback" | "provoke";

export interface ActionMeta {
  label: string;
  icon: string;
  keyBinding: keyof KeyBindings;
  keyboardSlot?: number;
  controllerSlot: number;
}

export const ACTIONS: Record<ActionId, ActionMeta> = {
  jump: {
    label: "JUMP",
    icon: "↑",
    keyBinding: "jump",
    controllerSlot: 3,
  },
  sprint: {
    label: "SPRINT",
    icon: "⚡",
    keyBinding: "sprint",
    keyboardSlot: 0,
    controllerSlot: 7,
  },
  antiKnockback: {
    label: "ANTI-KB",
    icon: "🛡",
    keyBinding: "antiKnockback",
    keyboardSlot: 1,
    controllerSlot: 6,
  },
  provoke: {
    label: "PROVOKE",
    icon: "🎯",
    keyBinding: "provoke",
    keyboardSlot: 2,
    controllerSlot: 5,
  },
};

export const KEYBOARD_HOTBAR_SLOT_COUNT = 10;
export const KEYBOARD_HOTBAR_ACTIONS = ["sprint", "antiKnockback", "provoke"] as const satisfies readonly ActionId[];

export const KEY_BINDING_LABELS: Record<keyof KeyBindings, string> = {
  moveForward: "FORWARD",
  moveBack: "BACK",
  moveLeft: "LEFT",
  moveRight: "RIGHT",
  jump: ACTIONS.jump.label,
  sprint: ACTIONS.sprint.label,
  antiKnockback: ACTIONS.antiKnockback.label,
  provoke: ACTIONS.provoke.label,
};

export type ControllerSlotPosition = "top" | "left" | "right" | "bottom";

export interface ControllerSlotMeta {
  slot: number;
  position: ControllerSlotPosition;
  action?: ActionId;
}

export const CONTROLLER_FACE_SLOTS: readonly ControllerSlotMeta[] = [
  { slot: 3, position: "top", action: "jump" },
  { slot: 2, position: "left" },
  { slot: 1, position: "right" },
  { slot: 0, position: "bottom" },
];

export const CONTROLLER_MODIFIED_SLOTS: readonly ControllerSlotMeta[] = [
  { slot: 7, position: "top", action: "sprint" },
  { slot: 6, position: "left", action: "antiKnockback" },
  { slot: 5, position: "right", action: "provoke" },
  { slot: 4, position: "bottom" },
];

export const CONTROLLER_SLOT_ACTIONS: Readonly<Record<number, ActionId | undefined>> = {
  3: "jump",
  5: "provoke",
  6: "antiKnockback",
  7: "sprint",
};

export const CONTROLLER_BUTTON_LABELS: Record<ControllerType, string[]> = {
  xbox: ["A", "B", "X", "Y", "RT+A", "RT+B", "RT+X", "RT+Y"],
  ps5: ["✕", "○", "□", "△", "R2+✕", "R2+○", "R2+□", "R2+△"],
  nintendo: ["B", "A", "Y", "X", "ZR+B", "ZR+A", "ZR+Y", "ZR+X"],
  unknown: ["A", "B", "X", "Y", "RT+A", "RT+B", "RT+X", "RT+Y"],
};

export function actionForControllerSlot(slot: number): ActionId | undefined {
  return CONTROLLER_SLOT_ACTIONS[slot];
}

export function actionForKeyboardSlot(slot: number): ActionId | undefined {
  return KEYBOARD_HOTBAR_ACTIONS.find(actionId => ACTIONS[actionId].keyboardSlot === slot);
}
