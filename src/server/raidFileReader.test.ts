import { expect, test, describe } from "bun:test";
import { parseRaidFile, readRaidObject } from "./raidFileReader";
import { loadBotPatterns, loadRaid } from "../engine/raidLoader";
import { join } from "path";

const RAIDS_DIR = join(import.meta.dir, "..", "..", "raids");

// --- Bun.YAML capability probes ---

describe("Bun.YAML", () => {
  test("parses basic YAML", () => {
    const result = Bun.YAML.parse("name: hello\nvalue: 42") as Record<string, unknown>;
    expect(result).toEqual({ name: "hello", value: 42 });
  });

  test("supports anchors and aliases", () => {
    const yaml = `
baseVal: &base 99
copy: *base
`;
    const result = Bun.YAML.parse(yaml) as Record<string, unknown>;
    expect(result.copy).toBe(99);
  });

  test("merge keys (<<:) expand inline", () => {
    const yaml = `
defaults: &defaults
  radius: 3
  damage: 30

event:
  <<: *defaults
  name: Tower
`;
    const result = Bun.YAML.parse(yaml) as { event: Record<string, unknown> };
    // Merge keys are part of YAML 1.1 — document whether Bun supports them.
    // If this fails, use plain anchors/aliases only (no merge keys).
    expect(result.event.radius).toBe(3);
    expect(result.event.damage).toBe(30);
    expect(result.event.name).toBe("Tower");
  });
});

// --- readRaidObject ---

describe("readRaidObject", () => {
  test("tower-test.yaml parses and passes loadRaid", async () => {
    const obj = await readRaidObject(join(RAIDS_DIR, "debug/tower-test"));
    const raid = loadRaid(obj);
    expect(raid.name).toBe("Tower Test");
    expect(raid.events).toHaveLength(3);
    expect(raid.events[0].type).toBe("tower");
    expect(raid.events[1].type).toBe("tower");
    expect(raid.events[2].type).toBe("tower");
  });

  test("throws when no file exists", async () => {
    await expect(readRaidObject(join(RAIDS_DIR, "debug/nonexistent"))).rejects.toThrow();
  });

  test("all raid example YAML files pass schema validation", async () => {
    for await (const file of new Bun.Glob("**/*.yaml").scan(RAIDS_DIR)) {
      const normalized = file.replaceAll("\\", "/");
      if (normalized.endsWith("/raid_info.yaml")) continue;

      const obj = await parseRaidFile(join(RAIDS_DIR, file));
      if (normalized.endsWith("-bots.yaml")) {
        loadBotPatterns(obj);
      } else {
        loadRaid(obj);
      }
    }
  });
});
