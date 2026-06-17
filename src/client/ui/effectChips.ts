// Status-effect chip rendering for the HUD (party rows + the local debuff tracker). Pure DOM
// builders with no HudOverlay state: a caller holds an EffectRenderState per chip container and
// calls syncEffectChips each frame, which rebuilds chips only when the active effect set changes and
// otherwise just ticks the countdown timers. Extracted from HudOverlay.

import type { Player } from "@shared/types";

const EFFECT_TIMER_STEP = 0.25;

type EffectKind = Player["effects"][number]["kind"];
type EffectChipHandle = { expiresAt: number; timerEl: HTMLSpanElement };
export type EffectRenderState = { ids: string[]; timerBucket: number; chips: EffectChipHandle[] };

export function createEffectRenderState(): EffectRenderState {
  return { ids: [], timerBucket: -1, chips: [] };
}

function teleportentIcon([x, z]: [number, number]): string {
  if (Math.abs(x) > Math.abs(z)) {
    return x >= 0 ? "teleportent_right.png" : "teleportent_left.png";
  }
  return z >= 0 ? "teleportent_up.png" : "teleportent_down.png";
}

// Map a status effect to a compact image or glyph. Static debuff images are preferred for
// raid-specific statuses; generic effects keep the old glyph fallback.
function effectIcon(effect: Player["effects"][number]): { glyph?: string; src?: string; rotate?: number } {
  switch (effect.behavior.kind) {
    case "plant": {
      return { src: `/static/debuffs/${teleportentIcon(effect.behavior.direction)}` };
    }
    case "sleep": return { src: "/static/debuffs/sleep.png" };
    case "confusion": return { src: "/static/debuffs/confuse.png" };
    case "doubleTrouble": return { src: "/static/debuffs/double-trouble.png" };
    case "directionalKnockback":
      return { src: `/static/debuffs/${effect.behavior.requiredFacing === "toward" ? "headwind" : "tailwind"}.png` };
    case "vuln": return { glyph: "▼" };
    case "dot": {
      const c = effect.behavior.condition;
      return { glyph: c === "moving" ? "🔥" : c === "idle" ? "❄" : "🩸" };
    }
    default: return { glyph: effect.kind === "buff" ? "▲" : "●" };
  }
}

function isActiveVisibleEffect(effect: Player["effects"][number], time: number, kind: EffectKind | null = null): boolean {
  return effect.visibility !== "invisible"
    && effect.appliedAt + effect.duration > time
    && (kind === null || effect.kind === kind);
}

function hasSameActiveEffects(
  player: Player,
  time: number,
  ids: string[],
  kind: EffectKind | null = null,
): boolean {
  let index = 0;
  for (const effect of player.effects) {
    if (!isActiveVisibleEffect(effect, time, kind)) continue;
    if (ids[index] !== effect.id) return false;
    index++;
  }
  return index === ids.length;
}

function activeEffectIds(player: Player, time: number, kind: EffectKind | null = null): string[] {
  const ids: string[] = [];
  for (const effect of player.effects) {
    if (isActiveVisibleEffect(effect, time, kind)) ids.push(effect.id);
  }
  return ids;
}

function sortedActiveVisibleEffects(player: Player, time: number, kind: EffectKind | null = null): Player["effects"] {
  const effects: Array<{ effect: Player["effects"][number]; index: number }> = [];
  for (let index = 0; index < player.effects.length; index++) {
    const effect = player.effects[index];
    if (isActiveVisibleEffect(effect, time, kind)) effects.push({ effect, index });
  }
  effects.sort((a, b) => {
    const aPlant = a.effect.behavior.kind === "plant";
    const bPlant = b.effect.behavior.kind === "plant";
    if (aPlant && bPlant) return (a.effect.plantSlot ?? a.index) - (b.effect.plantSlot ?? b.index);
    return a.index - b.index;
  });
  return effects.map(entry => entry.effect);
}

function effectTimerBucket(time: number): number {
  return Math.floor(time / EFFECT_TIMER_STEP);
}

function formatEffectTime(expiresAt: number, time: number): string {
  return `${Math.ceil(Math.max(0, expiresAt - time))}s`;
}

function buildEffectChip(
  effect: Player["effects"][number],
  time: number,
  className: string,
): { element: HTMLSpanElement; handle: EffectChipHandle } {
  const effectEl = document.createElement("span");
  effectEl.className = `${className} ${className}-${effect.kind}`;
  effectEl.title = effect.name;
  const icon = effectIcon(effect);
  let iconEl: HTMLElement;
  if (effect.icon) {
    const img = document.createElement("img");
    img.src = `/static/effects/${effect.icon}`;
    img.alt = effect.name;
    iconEl = img;
  } else if (icon.src) {
    const img = document.createElement("img");
    img.src = icon.src;
    img.alt = effect.name;
    iconEl = img;
  } else {
    iconEl = document.createElement("span");
    iconEl.textContent = icon.glyph ?? "";
  }
  iconEl.className = `${className}-icon`;
  if (icon.rotate !== undefined) iconEl.style.transform = `rotate(${icon.rotate}deg)`;
  const timerEl = document.createElement("span");
  timerEl.className = `${className}-timer`;
  const expiresAt = effect.appliedAt + effect.duration;
  timerEl.textContent = formatEffectTime(expiresAt, time);
  effectEl.append(iconEl, timerEl);
  return { element: effectEl, handle: { expiresAt, timerEl } };
}

export function syncEffectChips(
  container: HTMLElement,
  state: EffectRenderState,
  player: Player,
  time: number,
  className: string,
  kind: EffectKind | null = null,
): void {
  const bucket = effectTimerBucket(time);
  if (!hasSameActiveEffects(player, time, state.ids, kind)) {
    const elements: HTMLSpanElement[] = [];
    const chips: EffectChipHandle[] = [];
    for (const effect of sortedActiveVisibleEffects(player, time, kind)) {
      const chip = buildEffectChip(effect, time, className);
      elements.push(chip.element);
      chips.push(chip.handle);
    }
    container.replaceChildren(...elements);
    state.ids = activeEffectIds(player, time, kind);
    state.chips = chips;
    state.timerBucket = bucket;
    return;
  }
  if (state.timerBucket === bucket) return;
  state.timerBucket = bucket;
  for (const chip of state.chips) {
    chip.timerEl.textContent = formatEffectTime(chip.expiresAt, time);
  }
}
