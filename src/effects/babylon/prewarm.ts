import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { createShapeMesh } from "./shapeGeometry";
import { glyphBillboardMaterial } from "./billboards";
import { createElementFloorMaterial, prewarmElementBurst } from "./elementVfx";
import { createFloorTelegraphMaterial } from "./floorTelegraphs";

export function prewarmShaders(scene: Scene): void {
  const warmups: Array<() => Mesh | null> = [
    () => {
      const mesh = createShapeMesh(scene, "__prewarm_floor", { kind: "circle", center: { x: 0, z: 0 }, radius: 1 });
      if (mesh) mesh.material = createFloorTelegraphMaterial(scene, "__prewarm_floor_mat");
      return mesh;
    },
    () => {
      const plane = CreatePlane("__prewarm_lit", { size: 1 }, scene);
      const mat = new StandardMaterial("__prewarm_lit_mat", scene);
      mat.alpha = 0.9;
      plane.material = mat;
      return plane;
    },
    () => {
      const plane = CreatePlane("__prewarm_unlit", { size: 1 }, scene);
      const mat = new StandardMaterial("__prewarm_unlit_mat", scene);
      mat.disableLighting = true;
      plane.material = mat;
      return plane;
    },
    () => {
      const plane = CreatePlane("__prewarm_marker", { size: 1 }, scene);
      plane.material = glyphBillboardMaterial(scene, "__prewarm_marker_mat", "__prewarm_marker_tex", "!", "#ffffff");
      return plane;
    },
    () => {
      const plane = CreatePlane("__prewarm_element_floor", { size: 1 }, scene);
      plane.material = createElementFloorMaterial(scene, "__prewarm_element_floor_mat");
      return plane;
    },
  ];

  for (const make of warmups) {
    const mesh = make();
    const mat = mesh?.material as StandardMaterial | null | undefined;
    if (mesh && mat) mat.forceCompilation(mesh, () => mesh.dispose(false, true));
    else mesh?.dispose(false, true);
  }
  prewarmElementBurst(scene);
}
