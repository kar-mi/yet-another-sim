// Screen-space geometry for the HUD layout editor. Outlines, dragging, resizing and viewport
// clamping all go through these pure helpers so the editor and its tests share one set of rules.
//
// An element is drawn with `translate(-50%, -50%) scale(total)` around its centre, so a placement is
// a centre point plus a total scale factor (the UI scale times the group's own scale). The measured
// group box — the element plus any protruding controls — is described relative to that placement by
// its unit size (`natural`, the box at scale 1) and `offset` (group centre minus element centre,
// also at scale 1).

export interface HudPoint { x: number; y: number }
export interface HudSize { width: number; height: number }
export interface HudRect { left: number; top: number; width: number; height: number }
export interface HudMeasure { natural: HudSize; offset: HudPoint }
export interface HudPlacement { center: HudPoint; scale: number }

export const HUD_MIN_SCALE = 0.5;
export const HUD_MAX_SCALE = 2;
export const HUD_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type HudHandle = (typeof HUD_HANDLES)[number];

/** -1 = west/north side, 0 = centre, 1 = east/south side. */
function handleAxis(handle: HudHandle): HudPoint {
  return {
    x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
    y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
  };
}

function edgePoint(rect: HudRect, axis: HudPoint): HudPoint {
  return {
    x: rect.left + (rect.width * (1 + axis.x)) / 2,
    y: rect.top + (rect.height * (1 + axis.y)) / 2,
  };
}

/** The point the handle sits on: a corner, or the midpoint of an edge. */
export function handlePoint(rect: HudRect, handle: HudHandle): HudPoint {
  return edgePoint(rect, handleAxis(handle));
}

/** The point a resize keeps fixed: the opposite corner, or the opposite edge's midpoint. */
export function anchorPoint(rect: HudRect, handle: HudHandle): HudPoint {
  const axis = handleAxis(handle);
  return edgePoint(rect, { x: -axis.x, y: -axis.y });
}

export function centeredRect(center: HudPoint, size: HudSize): HudRect {
  return { left: center.x - size.width / 2, top: center.y - size.height / 2, width: size.width, height: size.height };
}

/** The measured group box for a placement. */
export function groupRect(placement: HudPlacement, measure: HudMeasure): HudRect {
  const { center, scale } = placement;
  return centeredRect(
    { x: center.x + measure.offset.x * scale, y: center.y + measure.offset.y * scale },
    { width: measure.natural.width * scale, height: measure.natural.height * scale },
  );
}

function clampAxis(center: number, size: number, extent: number): number {
  if (size >= extent) return extent / 2;
  return Math.min(Math.max(center, size / 2), extent - size / 2);
}

/** Keeps a box of `size` fully inside the viewport; an oversized box is centred. */
export function clampCenter(center: HudPoint, size: HudSize, viewport: HudSize): HudPoint {
  return {
    x: clampAxis(center.x, size.width, viewport.width),
    y: clampAxis(center.y, size.height, viewport.height),
  };
}

export function snapPoint(point: HudPoint, step: HudSize): HudPoint {
  return {
    x: step.width > 0 ? Math.round(point.x / step.width) * step.width : point.x,
    y: step.height > 0 ? Math.round(point.y / step.height) * step.height : point.y,
  };
}

/**
 * The scale to actually render at: the preferred one, shrunk further — below the minimum if it has
 * to be — only when the group cannot otherwise fit the viewport.
 */
export function fitScale(natural: HudSize, viewport: HudSize, preferred: number): number {
  if (natural.width <= 0 || natural.height <= 0) return preferred;
  return Math.min(preferred, viewport.width / natural.width, viewport.height / natural.height);
}

/** Places a group at its preferred scale where it fits, shrinking and pulling it inside where it doesn't. */
export function fitPlacement(center: HudPoint, preferredScale: number, measure: HudMeasure, viewport: HudSize): HudPlacement {
  const scale = fitScale(measure.natural, viewport, preferredScale);
  const placed = { center, scale };
  const rect = groupRect(placed, measure);
  const clamped = clampCenter({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, rect, viewport);
  return {
    center: { x: center.x + clamped.x - (rect.left + rect.width / 2), y: center.y + clamped.y - (rect.top + rect.height / 2) },
    scale,
  };
}

/** Drags a group by `delta`, snapping its centre to the grid (when given) before clamping. */
export function moveGroup(
  start: HudPlacement,
  delta: HudPoint,
  measure: HudMeasure,
  viewport: HudSize,
  grid: HudSize | null,
): HudPlacement {
  const moved = { x: start.center.x + delta.x, y: start.center.y + delta.y };
  const center = grid ? snapPoint(moved, grid) : moved;
  return fitPlacement(center, start.scale, measure, viewport);
}

/** How far a resize about `anchor` can grow before the group leaves the viewport. */
function maxRatioInViewport(rect: HudRect, anchor: HudPoint, viewport: HudSize): number {
  const spans: [number, number][] = [
    [anchor.x - rect.left, anchor.x],
    [rect.left + rect.width - anchor.x, viewport.width - anchor.x],
    [anchor.y - rect.top, anchor.y],
    [rect.top + rect.height - anchor.y, viewport.height - anchor.y],
  ];
  let max = Infinity;
  for (const [reach, room] of spans) {
    if (reach > 0) max = Math.min(max, Math.max(0, room) / reach);
  }
  return max;
}

/**
 * Scales a group proportionally by dragging `handle`, keeping the opposite corner (or opposite
 * edge's midpoint) pinned. `limits` are total-scale bounds, i.e. already multiplied by the UI scale.
 */
export function resizeGroup(
  start: HudPlacement,
  handle: HudHandle,
  delta: HudPoint,
  measure: HudMeasure,
  viewport: HudSize,
  limits: { min: number; max: number },
): HudPlacement {
  const rect = groupRect(start, measure);
  const anchor = anchorPoint(rect, handle);
  const grip = handlePoint(rect, handle);
  const vx = grip.x - anchor.x;
  const vy = grip.y - anchor.y;
  const lengthSq = vx * vx + vy * vy;
  const desired = lengthSq > 0 ? 1 + (delta.x * vx + delta.y * vy) / lengthSq : 1;
  const max = Math.min(limits.max / start.scale, maxRatioInViewport(rect, anchor, viewport));
  const ratio = Math.max(Math.min(limits.min / start.scale, max), Math.min(desired, max));
  return {
    center: { x: anchor.x + (start.center.x - anchor.x) * ratio, y: anchor.y + (start.center.y - anchor.y) * ratio },
    scale: start.scale * ratio,
  };
}
