import { expect, test } from "bun:test";
import { STATUS_CATALOG } from "@status";

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
    const real = STATUS_CATALOG[realKey];
    const fake = STATUS_CATALOG[fakeKey];
    expect(fake.name).toBe(`Fake ${real.name}`);
    expect(fake.icon).toBe(real.icon);
  }
});

test("P4 fake debuffs encode the inverse outcome directly", () => {
  expect(STATUS_CATALOG.entropy.behavior).toMatchObject({ kind: "effectBurst", shape: "circle" });
  expect(STATUS_CATALOG.fake_entropy.behavior).toMatchObject({ kind: "effectBurst", shape: "donut" });
  expect(STATUS_CATALOG.dynamic_fluid.behavior).toMatchObject({ kind: "effectBurst", shape: "donut" });
  expect(STATUS_CATALOG.fake_dynamic_fluid.behavior).toMatchObject({ kind: "effectBurst", shape: "circle" });
  expect(STATUS_CATALOG.compressed_water.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "stack" });
  expect(STATUS_CATALOG.fake_compressed_water.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "spread" });
  expect(STATUS_CATALOG.forked_lightning.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "spread" });
  expect(STATUS_CATALOG.fake_forked_lightning.behavior).toMatchObject({ kind: "pairedSpreadStack", role: "stack" });
  expect(STATUS_CATALOG.cursed_shriek.behavior.kind).toBe("carrierGaze");
  expect(STATUS_CATALOG.fake_cursed_shriek.behavior.kind).toBe("reverseCarrierGaze");
  expect(STATUS_CATALOG.acceleration_bomb.behavior).toMatchObject({ kind: "motionCheck", required: "still" });
  expect(STATUS_CATALOG.fake_acceleration_bomb.behavior).toMatchObject({ kind: "motionCheck", required: "move" });
});
