import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { createShapeMesh } from "./meshes/telegraphMeshes";
import { glyphBillboardMaterial } from "./meshes/billboardMaterials";
import { createFloorMaterial } from "./floorAoeSync";

// Pre-compile the shader effects for the material families that first appear mid-fight, so the
// initial AOE telegraph / head marker doesn't trigger a synchronous shader compile on the main
// thread (a visible hitch). Babylon caches compiled effects by their defines until the engine is
// disposed, so warming one representative of each family covers every later instance. Runs once at
// init off the gameplay path; the temp mesh + material are disposed after compilation (the cached
// effect persists). Add a family by appending one factory to `warmups`.
export function prewarmShaders(scene: Scene): void {
  const warmups: Array<() => Mesh | null> = [
    // Floor AOE telegraph (two-sided lighting). Every shape and the outline fill share its defines.
    () => {
      const mesh = createShapeMesh(scene, "__prewarm_floor", { kind: "circle", center: { x: 0, z: 0 }, radius: 1 });
      if (mesh) mesh.material = createFloorMaterial(scene, "__prewarm_floor_mat");
      return mesh;
    },
    // Lit translucent color material (element glyphs, mover orbs).
    () => {
      const plane = CreatePlane("__prewarm_lit", { size: 1 }, scene);
      const mat = new StandardMaterial("__prewarm_lit_mat", scene);
      mat.alpha = 0.9;
      plane.material = mat;
      return plane;
    },
    // Unlit color material (element ring tube, player effect ring torus).
    () => {
      const plane = CreatePlane("__prewarm_unlit", { size: 1 }, scene);
      const mat = new StandardMaterial("__prewarm_unlit_mat", scene);
      mat.disableLighting = true;
      plane.material = mat;
      return plane;
    },
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
