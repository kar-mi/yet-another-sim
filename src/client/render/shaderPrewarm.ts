import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { ActiveMechanic } from "@shared/types";
import { createTelegraphMesh } from "./meshes/telegraphMeshes";
import { glyphBillboardMaterial } from "./meshes/billboardMaterials";

// Pre-compile the shader effects for the material families that first appear mid-fight, so the
// initial AOE telegraph / head marker doesn't trigger a synchronous shader compile on the main
// thread (a visible hitch). Babylon caches compiled effects by their defines until the engine is
// disposed, so warming one representative of each family covers every later instance. Runs once at
// init off the gameplay path; the temp mesh + material are disposed after compilation (the cached
// effect persists). Add a family by appending one factory to `warmups`.
export function prewarmShaders(scene: Scene): void {
  const warmups: Array<() => Mesh | null> = [
    // AOE telegraph ground shape. The circle representative shares material defines with the
    // cone/rect/donut variants, so one compile warms them all.
    () => createTelegraphMesh(scene, {
      id: "__prewarm_telegraph",
      shape: { kind: "circle", center: { x: 0, z: 0 }, radius: 1 },
    } as unknown as ActiveMechanic),
    // Head-marker billboard (alpha-test + emissive + unlit). The glyph and image variants share the
    // same StandardMaterial defines, so the glyph (no network fetch) warms both.
    () => {
      const plane = CreatePlane("__prewarm_marker", { size: 1 }, scene);
      plane.material = glyphBillboardMaterial(scene, "__prewarm_marker_mat", "__prewarm_marker_tex", "!", "#ffffff");
      return plane;
    },
  ];

  for (const make of warmups) {
    const mesh = make();
    const mat = mesh?.material as StandardMaterial | null | undefined;
    // dispose(doNotRecurse=false, disposeMaterialAndTextures=true): also frees the temp material +
    // texture without force-disposing the now-cached engine effect.
    if (mesh && mat) mat.forceCompilation(mesh, () => mesh.dispose(false, true));
    else mesh?.dispose(false, true);
  }
}
