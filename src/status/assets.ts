import { BEHAVIORS } from "./behaviors";
import { STATUS_CATALOG } from "./catalog";

const GENERATED_MARKER_ICONS = Array.from({ length: 8 }, (_, index) => `limit${index + 1}_head.png`);

export function statusAssetManifest(): string[] {
  const assets = new Set(GENERATED_MARKER_ICONS);
  for (const template of Object.values(STATUS_CATALOG)) {
    for (const asset of [template.icon, template.markerIcon, template.ring?.icon]) {
      if (asset) assets.add(asset);
    }
    for (const asset of BEHAVIORS[template.behavior.kind].assetFiles ?? []) assets.add(asset);
  }
  return [...assets];
}
