import { BOSS_MODEL_FILE, BOSS_MODEL_ROOT } from "./BossLayer";
import { DEFAULT_PLAYER_MODEL_FILE, PLAYER_MODEL_FILES, PLAYER_MODEL_ROOT } from "./PlayerLayer";
import { HAND_IMAGE_URL } from "./meshes/handMeshes";
import { CLEANSING_ORB_RUNE_URL } from "./meshes/cleansingOrbMeshes";
import { ARENA_IMAGE_ROOT, STATUS_ICON_ROOT } from "../staticBase";
import { statusAssetManifest } from "@status";

// Warm the browser cache for every static asset up front so a later raid change / first session entry
// renders models and icons from cache instead of downloading after the pull has already started.
// (Paired with the Cache-Control header on /static so the warmed bytes are reused without revalidation.)
export function preloadAssets(): void {
  // GLB models are loaded by Babylon via fetch/XHR, so warm them the same way; an Image can't decode glb.
  const modelUrls = [
    `${BOSS_MODEL_ROOT}${BOSS_MODEL_FILE}`,
    `${PLAYER_MODEL_ROOT}${DEFAULT_PLAYER_MODEL_FILE}`,
    ...Object.values(PLAYER_MODEL_FILES).map(file => `${PLAYER_MODEL_ROOT}${file}`),
  ];
  for (const url of modelUrls) {
    void fetch(url).then(res => res.blob()).catch(() => {});
  }

  // Arena images and the complete status asset manifest load through the browser's image cache
  // (<img> / Babylon DOM-image textures), which an Image() request warms directly.
  const statusAssets = statusAssetManifest().map(file => `${STATUS_ICON_ROOT}/${file}`);
  const arenaAssets = arenaAssetManifest().map(file => `${ARENA_IMAGE_ROOT}/${file}`);
  for (const url of [...arenaAssets, ...statusAssets, HAND_IMAGE_URL, CLEANSING_ORB_RUNE_URL]) {
    new Image().src = url;
  }
}
import { arenaAssetManifest } from "@arena";
