import { BOSS_MODEL_FILE, BOSS_MODEL_ROOT } from "./BossLayer";
import { DEFAULT_PLAYER_MODEL_FILE, PLAYER_MODEL_FILES, PLAYER_MODEL_ROOT } from "./PlayerLayer";
import { FLOOR_PLAN_IMAGES } from "./meshes/arenaMeshes";
import { STATIC_ROOT } from "../staticBase";

// Above-head marker icons (PlayerLayer.syncMarkers) and HUD debuff icons (effectChips) load lazily
// the first time a mechanic applies them mid-pull. Keep these lists in sync with static/head_markers/
// and static/debuffs/ so new icons are warmed too.
const HEAD_MARKER_ICONS = [
  "cone_processed.png",
  "defam_processed.png",
  "stack_processed.png",
].map(file => `${STATIC_ROOT}/head_markers/${file}`);

const DEBUFF_ICONS = [
  "bind.png",
  "confuse.png",
  "double-trouble.png",
  "dynamic_fluid.png",
  "entropy.png",
  "sleep.png",
  "stun.png",
  "teleportent_down.png",
  "teleportent_left.png",
  "teleportent_right.png",
  "teleportent_up.png",
].map(file => `${STATIC_ROOT}/debuffs/${file}`);

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

  // Floor plans, markers and debuff icons load through the browser's image cache (<img> / Babylon
  // DOM-image textures), which an Image() request warms directly.
  for (const url of [...Object.values(FLOOR_PLAN_IMAGES), ...HEAD_MARKER_ICONS, ...DEBUFF_ICONS]) {
    new Image().src = url;
  }
}
