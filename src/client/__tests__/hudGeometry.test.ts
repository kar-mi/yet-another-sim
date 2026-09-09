import { describe, expect, test } from "bun:test";
import {
  HUD_HANDLES,
  anchorPoint,
  clampCenter,
  fitPlacement,
  fitScale,
  groupRect,
  handlePoint,
  moveGroup,
  resizeGroup,
  snapPoint,
  type HudHandle,
  type HudMeasure,
} from "../ui/hudGeometry";

const VIEWPORT = { width: 1000, height: 800 };
// A 200x100 group centred on its element, i.e. no protruding controls.
const PLAIN: HudMeasure = { natural: { width: 200, height: 100 }, offset: { x: 0, y: 0 } };
const LIMITS = { min: 0.5, max: 2 };

function place(x: number, y: number, scale = 1) {
  return { center: { x, y }, scale };
}

describe("handle and anchor points", () => {
  const rect = { left: 100, top: 200, width: 200, height: 100 };
  const expected: Record<HudHandle, [number, number]> = {
    nw: [100, 200], n: [200, 200], ne: [300, 200], e: [300, 250],
    se: [300, 300], s: [200, 300], sw: [100, 300], w: [100, 250],
  };

  test("handles sit on the corners and edge midpoints", () => {
    for (const handle of HUD_HANDLES) {
      const point = handlePoint(rect, handle);
      expect([point.x, point.y]).toEqual(expected[handle]);
    }
  });

  test("anchors are the opposite corner or edge midpoint", () => {
    const opposite: Record<HudHandle, HudHandle> = {
      nw: "se", n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e",
    };
    for (const handle of HUD_HANDLES) {
      expect(anchorPoint(rect, handle)).toEqual(handlePoint(rect, opposite[handle]));
    }
  });
});

describe("clamping", () => {
  test("pulls a box back inside the viewport", () => {
    expect(clampCenter({ x: -50, y: 900 }, { width: 200, height: 100 }, VIEWPORT)).toEqual({ x: 100, y: 750 });
  });

  test("leaves a box that already fits alone", () => {
    expect(clampCenter({ x: 500, y: 400 }, { width: 200, height: 100 }, VIEWPORT)).toEqual({ x: 500, y: 400 });
  });

  test("centres a box that is larger than the viewport", () => {
    expect(clampCenter({ x: 10, y: 10 }, { width: 2000, height: 900 }, VIEWPORT)).toEqual({ x: 500, y: 400 });
  });
});

describe("fitting", () => {
  test("keeps the preferred scale when the group fits", () => {
    expect(fitScale({ width: 200, height: 100 }, VIEWPORT, 2)).toBe(2);
  });

  test("shrinks below the minimum scale when the group cannot fit", () => {
    expect(fitScale({ width: 4000, height: 100 }, VIEWPORT, 1)).toBe(0.25);
  });

  test("clamps the whole measured rectangle, protruding controls included", () => {
    // The group sticks out 50px to the right of the element centre at scale 1.
    const measure: HudMeasure = { natural: { width: 200, height: 100 }, offset: { x: 50, y: 0 } };
    const fitted = fitPlacement({ x: 990, y: 400 }, 1, measure, VIEWPORT);
    expect(groupRect(fitted, measure).left + groupRect(fitted, measure).width).toBeCloseTo(1000);
    expect(fitted.center.x).toBeCloseTo(850);
  });

  test("shrinks an oversized group and centres it", () => {
    const measure: HudMeasure = { natural: { width: 2000, height: 400 }, offset: { x: 0, y: 0 } };
    const fitted = fitPlacement({ x: 100, y: 100 }, 1, measure, VIEWPORT);
    expect(fitted.scale).toBe(0.5);
    // Too wide even shrunk, so it centres horizontally; vertically it just stays inside.
    expect(fitted.center).toEqual({ x: 500, y: 100 });
  });
});

describe("moving", () => {
  test("follows the pointer and clamps at the viewport edge", () => {
    const moved = moveGroup(place(500, 400), { x: 600, y: -600 }, PLAIN, VIEWPORT, null);
    expect(moved.center).toEqual({ x: 900, y: 50 });
  });

  test("snaps to the grid before clamping", () => {
    const grid = { width: 10, height: 10 };
    expect(moveGroup(place(500, 400), { x: 13, y: 4 }, PLAIN, VIEWPORT, grid).center).toEqual({ x: 510, y: 400 });
    // A snap that would leave the viewport still ends up inside it.
    expect(moveGroup(place(500, 400), { x: 496, y: 0 }, PLAIN, VIEWPORT, grid).center).toEqual({ x: 900, y: 400 });
  });
});

describe("resizing", () => {
  test("a corner drag scales proportionally and pins the opposite corner", () => {
    const start = place(500, 400);
    const before = groupRect(start, PLAIN);
    // Drag the SE handle out along the diagonal by half the box.
    const resized = resizeGroup(start, "se", { x: 100, y: 50 }, PLAIN, VIEWPORT, LIMITS);
    expect(resized.scale).toBeCloseTo(1.5);
    const after = groupRect(resized, PLAIN);
    expect(after.left).toBeCloseTo(before.left);
    expect(after.top).toBeCloseTo(before.top);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height);
  });

  test("every handle grows the group away from its anchor", () => {
    const start = place(500, 400);
    for (const handle of HUD_HANDLES) {
      const axis = { x: handle.includes("e") ? 40 : handle.includes("w") ? -40 : 0, y: handle.includes("s") ? 20 : handle.includes("n") ? -20 : 0 };
      const resized = resizeGroup(start, handle, axis, PLAIN, VIEWPORT, LIMITS);
      expect(resized.scale).toBeGreaterThan(1);
      const anchor = anchorPoint(groupRect(start, PLAIN), handle);
      const after = groupRect(resized, PLAIN);
      expect(anchorPoint(after, handle).x).toBeCloseTo(anchor.x);
      expect(anchorPoint(after, handle).y).toBeCloseTo(anchor.y);
    }
  });

  test("an edge handle ignores the off-axis part of the drag", () => {
    const start = place(500, 400);
    const east = resizeGroup(start, "e", { x: 100, y: 400 }, PLAIN, VIEWPORT, LIMITS);
    expect(east.scale).toBeCloseTo(1.5);
    const south = resizeGroup(start, "s", { x: 400, y: 50 }, PLAIN, VIEWPORT, LIMITS);
    expect(south.scale).toBeCloseTo(1.5);
  });

  test("dragging inwards shrinks, dragging past the far side stops at the minimum", () => {
    const start = place(500, 400);
    expect(resizeGroup(start, "se", { x: -100, y: -50 }, PLAIN, VIEWPORT, LIMITS).scale).toBeCloseTo(0.5);
    expect(resizeGroup(start, "se", { x: -1000, y: -1000 }, PLAIN, VIEWPORT, LIMITS).scale).toBeCloseTo(0.5);
  });

  test("stops at the maximum scale", () => {
    expect(resizeGroup(place(500, 400), "se", { x: 1000, y: 500 }, PLAIN, VIEWPORT, LIMITS).scale).toBeCloseTo(2);
  });

  test("stops at the viewport edge before the maximum scale", () => {
    // Anchored 200px from the left edge, this 600px-wide group runs out of room at 4/3 scale.
    const wide: HudMeasure = { natural: { width: 600, height: 100 }, offset: { x: 0, y: 0 } };
    const start = place(500, 400);
    const resized = resizeGroup(start, "e", { x: 5000, y: 0 }, wide, VIEWPORT, LIMITS);
    const after = groupRect(resized, wide);
    expect(after.left).toBeCloseTo(200);
    expect(after.left + after.width).toBeLessThanOrEqual(1000.001);
    expect(resized.scale).toBeLessThan(2);
  });
});

describe("snapping", () => {
  test("rounds each axis to its own step", () => {
    expect(snapPoint({ x: 47, y: 92 }, { width: 10, height: 25 })).toEqual({ x: 50, y: 100 });
  });
});
