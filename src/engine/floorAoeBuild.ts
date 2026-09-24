import type { AOEShape, TelegraphMode, FlashBeforeResolve, ElementGlyphKind } from "@model/types";
import { FloorAoe, DEFAULT_DANGER_COLOR, type FloorAoeVfx } from "@effects";
import { AOE_RESOLVE_LINGER } from "@shared/constants";

export function buildFloorAoe(params: {
  id: string;
  shape: AOEShape;
  color?: string;
  alpha?: number;
  showTelegraph: boolean;
  telegraphMode?: TelegraphMode;
  linger?: number;
  flashBeforeResolve?: FlashBeforeResolve;
  outline?: boolean;
  element?: ElementGlyphKind;
  vfx?: FloorAoeVfx;
  resolveAt: number;
}): FloorAoe | undefined {
  const { id, shape, resolveAt } = params;
  const vfx = params.vfx?.floor || params.vfx?.burst
    ? { floor: params.vfx.floor, burst: params.vfx.burst }
    : undefined;
  const style = { ...(params.outline ? { style: "outline" as const } : {}), ...(params.alpha !== undefined ? { alpha: params.alpha } : {}), ...(params.element ? { element: params.element } : {}), ...(vfx ? { vfx } : {}) };
  const color = params.color ?? params.flashBeforeResolve?.color ?? DEFAULT_DANGER_COLOR;
  const linger = params.linger ?? AOE_RESOLVE_LINGER;

  if (params.flashBeforeResolve) {
    if (params.showTelegraph && params.telegraphMode !== "resolve") {
      return new FloorAoe({ id, shape, color, ...style, resolveMode: { kind: "active" }, resolveAt });
    }
    const trail = params.telegraphMode === "resolve" ? linger : 0;
    return new FloorAoe({
      id, shape, color, ...style,
      resolveMode: { kind: "resolve", lead: params.flashBeforeResolve.lead, trail },
      resolveAt,
    });
  }
  if (!params.showTelegraph) return undefined;
  if (params.telegraphMode === "resolve") {
    return new FloorAoe({
      id, shape, color, ...style,
      resolveMode: { kind: "resolve", lead: 0, trail: linger },
      resolveAt,
    });
  }
  return new FloorAoe({ id, shape, color, ...style, resolveMode: { kind: "active" }, resolveAt });
}
