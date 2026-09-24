import { expect, test } from "bun:test";
import { arenaAssetManifest } from "@arena";
import { FLOOR_PLAN_IMAGE_FILES, ZONE_IMAGE_FILES } from "../assets";

test("the arena asset manifest is exhaustive and duplicate-free", () => {
  const expected = [...Object.values(FLOOR_PLAN_IMAGE_FILES), ...Object.values(ZONE_IMAGE_FILES)];
  const manifest = arenaAssetManifest();
  expect(manifest).toEqual(expected);
  expect(new Set(manifest).size).toBe(manifest.length);
});

test("every registered arena image exists in the package", async () => {
  const missing: string[] = [];
  for (const file of arenaAssetManifest()) {
    if (!(await Bun.file(`${import.meta.dir}/../images/${file}`).exists())) missing.push(file);
  }
  expect(missing).toEqual([]);
});
