import { expect, test } from "bun:test";
import { DEBUFF_REGISTRY } from "../status/debuffs";

const pairs = [
  ["entropy", "fake_entropy"],
  ["dynamic_fluid", "fake_dynamic_fluid"],
  ["compressed_water", "fake_compressed_water"],
  ["forked_lightning", "fake_forked_lightning"],
  ["cursed_shriek", "fake_cursed_shriek"],
  ["acceleration_bomb", "fake_acceleration_bomb"],
] as const;

test("P4 fake debuffs have distinct names and share their real debuff icons", () => {
  for (const [realKey, fakeKey] of pairs) {
    const real = DEBUFF_REGISTRY[realKey];
    const fake = DEBUFF_REGISTRY[fakeKey];
    expect(fake.name).toBe(`Fake ${real.name}`);
    expect(fake.icon).toBe(real.icon);
  }
});

test("P4 fake debuffs encode the inverse outcome directly", () => {
  expect(DEBUFF_REGISTRY.entropy.behavior).toMatchObject({ kind: "effectBurst", shape: "circle" });
  expect(DEBUFF_REGISTRY.fake_entropy.behavior).toMatchObject({ kind: "effectBurst", shape: "donut" });
  expect(DEBUFF_REGISTRY.dynamic_fluid.behavior).toMatchObject({ kind: "effectBurst", shape: "donut" });
  expect(DEBUFF_REGISTRY.fake_dynamic_fluid.behavior).toMatchObject({ kind: "effectBurst", shape: "circle" });
  expect(DEBUFF_REGISTRY.compressed_water.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "stack" });
  expect(DEBUFF_REGISTRY.fake_compressed_water.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "spread" });
  expect(DEBUFF_REGISTRY.forked_lightning.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "spread" });
  expect(DEBUFF_REGISTRY.fake_forked_lightning.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "stack" });
  expect(DEBUFF_REGISTRY.cursed_shriek.behavior.kind).toBe("carrierGaze");
  expect(DEBUFF_REGISTRY.fake_cursed_shriek.behavior.kind).toBe("reverseCarrierGaze");
  expect(DEBUFF_REGISTRY.acceleration_bomb.behavior).toMatchObject({ kind: "motionCheck", required: "still" });
  expect(DEBUFF_REGISTRY.fake_acceleration_bomb.behavior).toMatchObject({ kind: "motionCheck", required: "move" });
});
