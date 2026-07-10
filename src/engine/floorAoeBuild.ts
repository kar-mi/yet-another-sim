// Reconstructs the render-facing FloorAoe from the legacy showTelegraph/telegraphMode/
// flashBeforeResolve authoring fields, preserving the exact visibility windows those fields used to
// produce (see TelegraphLayer's old inFlash/visible filter) without raid content needing to change.
// Shared by every construction site that promotes a pending mechanic into an active one (or
// re-anchors its shape mid-lifetime) so the mapping only lives in one place.

import type { AOEShape, TelegraphMode, FlashBeforeResolve } from "@shared/types";
import { FloorAoe, DEFAULT_DANGER_COLOR } from "@shared/floorAoe";
import { AOE_RESOLVE_LINGER } from "@shared/constants";

export function buildFloorAoe(params: {
  id: string;
  shape: AOEShape;
  color?: string;
  showTelegraph: boolean;
  telegraphMode?: TelegraphMode;
  flashBeforeResolve?: FlashBeforeResolve;
  resolveAt: number;
}): FloorAoe | undefined {
  const { id, shape, resolveAt } = params;
  const color = params.color ?? params.flashBeforeResolve?.color ?? DEFAULT_DANGER_COLOR;

  if (params.flashBeforeResolve) {
    // A cast-mode mechanic (not hidden by telegraphMode "resolve") is already shown for its whole
    // cast, so the pre-hit flash window is a strict subset of that visibility.
    if (params.showTelegraph && params.telegraphMode !== "resolve") {
      return new FloorAoe({ id, shape, color, resolveMode: { kind: "active" }, resolveAt });
    }
    // Hidden until the pre-hit lead window; telegraphMode "resolve" additionally lingers after impact.
    const trail = params.telegraphMode === "resolve" ? AOE_RESOLVE_LINGER : 0;
    return new FloorAoe({
      id, shape, color,
      resolveMode: { kind: "resolve", lead: params.flashBeforeResolve.lead, trail },
      resolveAt,
    });
  }
  if (!params.showTelegraph) return undefined;
  if (params.telegraphMode === "resolve") {
    return new FloorAoe({
      id, shape, color,
      resolveMode: { kind: "resolve", lead: 0, trail: AOE_RESOLVE_LINGER },
      resolveAt,
    });
  }
  return new FloorAoe({ id, shape, color, resolveMode: { kind: "active" }, resolveAt });
}
