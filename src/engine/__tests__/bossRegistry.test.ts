import { expect, test } from "bun:test";
import { baseRaid, loadRaid } from "./helpers";

test("boss registry: single boss id resolves the matching preset", () => {
  const raid = loadRaid({ ...baseRaid, boss: { id: "chaos" }, events: [] });

  expect(raid.bosses[0]!.model).toBe("chaos");
  expect(raid.bosses[0]!.modelScale).toBe(20);
});

test("boss registry: omitted boss block keeps kefka defaults", () => {
  const raid = loadRaid({ ...baseRaid, events: [] });

  expect(raid.bosses[0]!.model).toBe("kefka");
  expect(raid.bosses[0]!.modelScale).toBe(30);
  expect(raid.bosses[0]!.radius).toBe(3);
  expect(raid.bosses[0]!.ring).toEqual({ scale: 2, color: "#e62120" });
});

test("boss registry: explicit non-scale fields override the preset", () => {
  const raid = loadRaid({ ...baseRaid, boss: { id: "chaos", radius: 5 }, events: [] });

  expect(raid.bosses[0]!.model).toBe("chaos");
  expect(raid.bosses[0]!.modelScale).toBe(20);
  expect(raid.bosses[0]!.radius).toBe(5);
});

test("boss registry: multi-boss slugs use presets when available and kefka otherwise", () => {
  const raid = loadRaid({
    ...baseRaid,
    bosses: [
      { id: "exdeath" },
      { id: "clone1" },
    ],
    events: [],
  });

  expect(raid.bosses[0]!.model).toBe("exdeath");
  expect(raid.bosses[0]!.modelScale).toBe(20);
  expect(raid.bosses[1]!.id).toBe("clone1");
  expect(raid.bosses[1]!.model).toBe("kefka");
  expect(raid.bosses[1]!.modelScale).toBe(30);
});

test("boss registry: invalid single-boss registry id is rejected", () => {
  expect(() => loadRaid({ ...baseRaid, boss: { id: "clone1" }, events: [] })).toThrow(/Invalid option/);
});

test("boss registry: modelScale is rejected as an authored boss parameter", () => {
  expect(() => loadRaid({ ...baseRaid, boss: { id: "chaos", modelScale: 5 }, events: [] })).toThrow(/modelScale/);
});
