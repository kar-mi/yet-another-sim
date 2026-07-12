import type { Player, World } from "@shared/types";
import {
  ACTIONS,
  CONTROLLER_BUTTON_POSITION,
  actionForKeyboardSlot,
  type ControllerButtonId,
} from "../actions";

const PARTY_SLOT_ORDER = ["mt", "ot", "h1", "h2", "m1", "m2", "r1", "r2"] as const;
const PARTY_SLOT_INDEX = new Map<string, number>(PARTY_SLOT_ORDER.map((id, index) => [id, index]));

export type CastCandidate = { name: string; telegraphStart: number; resolveAt: number; bossId: string };

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function setWidth(el: HTMLElement, value: string): void {
  if (el.style.width !== value) el.style.width = value;
}

export function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function setBackground(el: HTMLElement, value: string): void {
  if (el.style.background !== value) el.style.background = value;
}

export function buildCastCandidates(world: World): CastCandidate[] {
  const defaultBossId = world.bosses[0]?.id ?? "";
  const candidates: CastCandidate[] = [];
  for (const mechanics of [world.active, world.chains, world.groupMechanics, world.gazes, world.spreadStacks]) {
    for (const mechanic of mechanics) {
      if (!mechanic.resolved && mechanic.showCastBar) candidates.push({
        name: mechanic.name,
        telegraphStart: mechanic.telegraphStart,
        resolveAt: mechanic.resolveAt,
        bossId: "bossId" in mechanic ? mechanic.bossId ?? defaultBossId : defaultBossId,
      });
    }
  }
  return candidates;
}

export function castForBoss(bossId: string, candidates: CastCandidate[]): CastCandidate | null {
  return candidates.find(candidate => candidate.bossId === bossId) ?? null;
}

export function orderedPartyPlayers(players: Player[], localPlayerId: string | null): Player[] {
  return [...players].sort((a, b) => {
    if (a.id === localPlayerId) return -1;
    if (b.id === localPlayerId) return 1;
    const orderDelta = (PARTY_SLOT_INDEX.get(a.id) ?? PARTY_SLOT_ORDER.length)
      - (PARTY_SLOT_INDEX.get(b.id) ?? PARTY_SLOT_ORDER.length);
    return orderDelta || a.id.localeCompare(b.id);
  });
}

export function renderKeyboardSlot(slot: number): string {
  const actionId = actionForKeyboardSlot(slot);
  if (!actionId) return `<div class="yas-slot" data-slot="${slot}"><span class="yas-keybind"></span></div>`;
  const action = ACTIONS[actionId];
  return `
    <div class="yas-slot" data-slot="${slot}">
      <span class="yas-keybind"></span>
      <span class="yas-slot-icon">${action.icon}</span>
      <span class="yas-slot-name">${action.label}</span>
      <div class="yas-cd-overlay"></div>
      <div class="yas-cd-text"></div>
    </div>`;
}

export function renderControllerSlot(button: ControllerButtonId): string {
  return `
    <div class="yas-slot yas-ctrl-${CONTROLLER_BUTTON_POSITION[button]}" data-ctrl-btn="${button}">
      <span class="yas-keybind"></span>
      <span class="yas-slot-icon"></span>
      <span class="yas-slot-name"></span>
      <div class="yas-cd-overlay"></div>
      <div class="yas-cd-text"></div>
    </div>`;
}

