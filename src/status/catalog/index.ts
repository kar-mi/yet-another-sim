import type { StatusClass, StatusTemplate } from "../types";
import { BUFF_TEMPLATES } from "./buffs";
import { DEBUFF_TEMPLATES } from "./debuffs";

function combine(...sources: Readonly<Record<string, StatusTemplate>>[]): Readonly<Record<string, StatusTemplate>> {
  const combined: Record<string, StatusTemplate> = {};
  for (const source of sources) {
    for (const [id, template] of Object.entries(source)) {
      if (id in combined) throw new Error(`duplicate status template id "${id}"`);
      combined[id] = template;
    }
  }
  return deepFreeze(combined);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const STATUS_CATALOG = combine(BUFF_TEMPLATES, DEBUFF_TEMPLATES);

export function statusIds(kind?: StatusClass): string[] {
  return Object.keys(STATUS_CATALOG).filter(id => kind === undefined || STATUS_CATALOG[id]!.kind === kind);
}

export function statusTemplate(id: string): StatusTemplate | undefined {
  return Object.hasOwn(STATUS_CATALOG, id) ? STATUS_CATALOG[id] : undefined;
}
