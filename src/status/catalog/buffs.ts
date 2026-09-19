import type { StatusTemplate } from "../types";

export const BUFF_TEMPLATES: Readonly<Record<string, StatusTemplate>> = {
  tank_limit_break: {
    name: "Tank Limit Break",
    kind: "buff",
    duration: 10,
    behavior: { kind: "mitigation", multiplier: 0.1 },
  },
  sprint: {
    name: "Sprint",
    kind: "buff",
    duration: 10,
    visibility: "invisible",
    group: "sprint",
    icon: "sprint.png",
    behavior: { kind: "movementSpeed", multiplier: 1.3 },
  },
  arms_length: {
    name: "Arm's Length",
    kind: "buff",
    duration: 5,
    visibility: "invisible",
    group: "arms_length",
    icon: "armslength.png",
    behavior: { kind: "knockbackImmunity" },
  },
  regen: {
    name: "Regen",
    kind: "buff",
    duration: 15,
    behavior: { kind: "none" },
  },
};
