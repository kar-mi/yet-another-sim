import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BURST_DURATION, BURST_STEP, BurstSim, burstScale, burstSeed, launchBurst, readBurstData } from "../render/voxelBurst";

const data = { cell: 0.5, positions: [0, 1, 0, 1, 3, 0], colors: [0xff0000, 0x00ff00] };

test("burst data is read from glTF extras metadata and rejects malformed data", () => {
  expect(readBurstData({ gltf: { extras: { voxelBurst: data } } })).toEqual(data);
  expect(readBurstData(null)).toBeNull();
  expect(readBurstData({ gltf: { extras: { voxelBurst: { cell: 1, positions: [0, 0], colors: [1] } } } })).toBeNull();
});

test("pixels fly apart, then come to rest on the floor", () => {
  const launch = launchBurst(data, 1234);
  for (let i = 1; i < launch.vel.length; i += 3) expect(launch.vel[i]!).toBeGreaterThan(0); // all thrown upward first
  const state = new BurstSim(data, 1234).at(3);
  for (let i = 1; i < state.pos.length; i += 3) expect(state.pos[i]).toBeCloseTo(data.cell / 2, 1);
  const dx = state.pos[3]! - state.pos[0]!, dz = state.pos[5]! - state.pos[2]!;
  expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(1);
});

// Lockstep: every client and replay must draw the same burst at the same sim time.
test("a burst is a pure function of seed and sim time", () => {
  const seed = burstSeed(987654321, "mt");
  expect(burstSeed(987654321, "mt")).toBe(seed);
  expect(burstSeed(987654321, "ot")).not.toBe(seed);
  expect(burstSeed(1, "mt")).not.toBe(seed);

  const direct = Array.from(new BurstSim(data, seed).at(1.0).pos);
  const stepped = new BurstSim(data, seed);
  for (let t = 0; t <= 1.0; t += 1 / 61) stepped.at(t); // uneven render frames
  expect(Array.from(stepped.at(1.0).pos)).toEqual(direct);

  const rewound = new BurstSim(data, seed);
  rewound.at(1.3);
  expect(Array.from(rewound.at(1.0).pos)).toEqual(direct); // replay seek backwards
  expect(Array.from(new BurstSim(data, burstSeed(987654321, "ot")).at(1.0).pos)).not.toEqual(direct);
});

test("a burst advances in fixed steps, so a paused frame never moves", () => {
  const sim = new BurstSim(data, 7);
  const step = sim.at(0.5).step;
  expect(sim.at(0.5 + BURST_STEP / 3).step).toBe(step);
  expect(Array.from(sim.at(0.5).pos)).toEqual(Array.from(new BurstSim(data, 7).at(0.5).pos));
});

// Same banned list as the engine's noTranscendentals guard, plus the render frame delta.
test("the burst uses only deterministic math and sim time", () => {
  const source = readFileSync(join(import.meta.dir, "../render/voxelBurst.ts"), "utf8")
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith("//"));
  const forbidden = /\bMath\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|log|hypot|cbrt|random)\b|\b(?:Date|performance)\.now\b|getDeltaTime|onBeforeRenderObservable/;
  expect(source.filter(line => forbidden.test(line))).toEqual([]);
});

test("pixels shrink away by the end of the burst", () => {
  expect(burstScale(0)).toBe(1);
  expect(burstScale(BURST_DURATION)).toBe(0);
});

test("every player model file has the clips PlayerLayer plays and burst data", async () => {
  // PlayerLayer resolves its static root from document.baseURI at import time.
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://localhost/" } });
  const { PLAYER_MODEL_FILES } = await import("../render/PlayerLayer").finally(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete (globalThis as { document?: unknown }).document;
  });
  for (const file of new Set(Object.values(PLAYER_MODEL_FILES))) {
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, "../../../static/model/player", file)).arrayBuffer());
    const jsonLength = new DataView(bytes.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    expect(json.animations.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(["Idle", "Walk", "Sprint", "Jump"]));
    expect(readBurstData({ gltf: { extras: json.nodes[0].extras } })).not.toBeNull();
  }
});
