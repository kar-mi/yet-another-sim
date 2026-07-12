import { expect, test } from "bun:test";
import { SimulationReplica } from "../simulationReplica";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";
import type { Frame } from "@shared/protocol";

const frame: Frame = { intents: {}, botsInvincible: false };

test("SimulationReplica adopts a base tick and replays its tail", () => {
  const replica = new SimulationReplica();
  const world = createWorld(createEmptyRaid(), 123);
  replica.adopt(world, 10, [frame, frame]);
  expect(replica.appliedTick).toBe(12);
  expect(replica.world?.time).toBeGreaterThan(world.time);
});

test("SimulationReplica drops duplicate frames and identifies gaps", () => {
  const replica = new SimulationReplica();
  replica.adopt(createWorld(createEmptyRaid(), 123), 0, []);
  expect(replica.apply(0, [frame, frame])).toMatchObject({ kind: "applied", applied: 2 });
  expect(replica.apply(0, [frame, frame])).toMatchObject({ kind: "applied", applied: 0 });
  expect(replica.apply(3, [frame])).toEqual({ kind: "gap" });
});
