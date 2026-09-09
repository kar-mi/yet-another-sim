import { expect, test } from "bun:test";
import { LocalPredictor } from "../predictor";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";
import { MOVE_SPEED, SPRINT_DURATION, SPRINT_MULTIPLIER } from "@shared/constants";

test("sprint prediction clears an existing cooldown and supports recasts until disabled", () => {
  const predictor = new LocalPredictor();
  let player = { ...createWorld(createEmptyRaid()).players[0]!, pos: { x: 0, z: 0 }, sprintCooldown: 60 };
  const zones = [{ kind: "circle" as const, center: { x: 0, z: 0 }, radius: 100 }];
  const cast = { move: { x: 1, z: 0 }, sprint: true };
  const dt = 0.1;
  player = predictor.predict(player, zones, 0, cast, dt);
  expect(player.pos.x).toBeCloseTo(MOVE_SPEED * dt);
  player.cooldownsDisabled = true;
  for (let i = 0; i < 2; i++) {
    const before = player.pos.x;
    player = predictor.predict(player, zones, 0, cast, dt);
    expect(player.pos.x - before).toBeCloseTo(MOVE_SPEED * SPRINT_MULTIPLIER * dt);
    player = predictor.predict(player, zones, 0, { move: { x: 0, z: 0 } }, SPRINT_DURATION + 1);
  }
  player.cooldownsDisabled = false;
  player = predictor.predict(player, zones, 0, cast, dt);
  player = predictor.predict(player, zones, 0, { move: { x: 0, z: 0 } }, SPRINT_DURATION + 1);
  const before = player.pos.x;
  player = predictor.predict(player, zones, 0, cast, dt);
  expect(player.pos.x - before).toBeCloseTo(MOVE_SPEED * dt);
});
