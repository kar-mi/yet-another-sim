import { BOSS_MODEL_FILE, BOSS_MODEL_ROOT } from "./BossLayer";
import { DEFAULT_PLAYER_MODEL_FILE, PLAYER_MODEL_FILES, PLAYER_MODEL_ROOT } from "./PlayerLayer";
import { HAND_IMAGE_URL } from "./meshes/handMeshes";
import { CLEANSING_ORB_RUNE_URL } from "./meshes/cleansingOrbMeshes";
import { ARENA_IMAGE_ROOT, STATUS_ICON_ROOT } from "../staticBase";
import { statusAssetManifest } from "@status";

export function preloadAssets(): void {
  const modelUrls = [
    `${BOSS_MODEL_ROOT}${BOSS_MODEL_FILE}`,
    `${PLAYER_MODEL_ROOT}${DEFAULT_PLAYER_MODEL_FILE}`,
    ...Object.values(PLAYER_MODEL_FILES).map(file => `${PLAYER_MODEL_ROOT}${file}`),
  ];
  for (const url of modelUrls) {
    void fetch(url).then(res => res.blob()).catch(() => {});
  }

  const statusAssets = statusAssetManifest().map(file => `${STATUS_ICON_ROOT}/${file}`);
  const arenaAssets = arenaAssetManifest().map(file => `${ARENA_IMAGE_ROOT}/${file}`);
  for (const url of [...arenaAssets, ...statusAssets, HAND_IMAGE_URL, CLEANSING_ORB_RUNE_URL]) {
    new Image().src = url;
  }
}
import { arenaAssetManifest } from "@arena";
