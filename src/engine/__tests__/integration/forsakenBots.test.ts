import { expect, test } from "bun:test";
import { createWorld } from "../../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";

test("forsaken raid and bot companion content load", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken-bots.yaml").text());
  const raid = loadRaid(raidData);
  const bots = loadBotPatterns(botData);
  const world = createWorld(applyBotPatterns(raid, bots), 1);
  const byEventId = (id: string) => raid.events.find(event => event.id === id);
  const effectResolverById = (id: string) => raid.events.find(event => event.type === "effect_resolver" && event.id === id);

  expect(raid.name).toContain("Forsaken");
  expect(byEventId("forsaken-raidwide")).toBeDefined();
  expect(byEventId("forsaken-charges")).toMatchObject({ initial: "plan" });
  const lastTowerResolve = Math.max(...raid.events.filter(e => e.type === "tower").map(e => e.t + e.telegraph));
  const endRaidwide = byEventId("forsaken-end-raidwide");
  expect(endRaidwide && "t" in endRaidwide && endRaidwide.t > lastTowerResolve).toBe(true);
  expect(effectResolverById("forsaken-stack-resolve")).toMatchObject({ effectName: "Stack Charge" });
  expect(effectResolverById("forsaken-cone-resolve")).toMatchObject({ effectName: "Cone Charge" });
  expect(effectResolverById("forsaken-defamation-resolve")).toMatchObject({ effectName: "Defamation Charge" });
  expect(world.partners.h1).toBe("mt");
  expect(Object.keys(world.initialCharges)).toHaveLength(8);
  expect(world.botSolvers?.generic?.length).toBeGreaterThan(0);

  const towerEvents = raid.events.filter(event => event.type === "tower");
  const distances = towerEvents.map(e => Math.hypot(e.pos[0], e.pos[1]));
  expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.1);

  const counts = new Map<string, number>();
  for (const key of towerEvents.map(e => `${e.pos[0]},${e.pos[1]}`)) counts.set(key, (counts.get(key) ?? 0) + 1);
  expect([...counts.values()].every(n => n === 2)).toBe(true);
  expect(towerEvents.some(event => event.requiredRoles !== undefined)).toBe(false);
  expect(towerEvents.every(e => e.radius === towerEvents[0].radius)).toBe(true);
  expect(towerEvents.every(e => e.failureDamage === towerEvents[0].failureDamage)).toBe(true);
  expect(raid.events.filter(event => event.type === "heal")).toHaveLength(new Set(towerEvents.map(e => e.t)).size);
});
