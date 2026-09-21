export const FLOOR_PLAN_IMAGE_FILES = {
  "dmu-p1": "dmu/p1-cropped.webp",
  "dmu-p2": "dmu/p2-cropped.webp",
} as const;

export const ZONE_IMAGE_FILES = {
  "index-trapezoid": "index/trapezoid.webp",
  "index-square": "index/square.webp",
} as const;

export type FloorPlanImage = keyof typeof FLOOR_PLAN_IMAGE_FILES;
export type ZoneImage = keyof typeof ZONE_IMAGE_FILES;

export const FLOOR_PLAN_IMAGE_IDS = Object.keys(FLOOR_PLAN_IMAGE_FILES) as [FloorPlanImage, ...FloorPlanImage[]];
export const ZONE_IMAGE_IDS = Object.keys(ZONE_IMAGE_FILES) as [ZoneImage, ...ZoneImage[]];

export function arenaAssetManifest(): string[] {
  return [...Object.values(FLOOR_PLAN_IMAGE_FILES), ...Object.values(ZONE_IMAGE_FILES)];
}
