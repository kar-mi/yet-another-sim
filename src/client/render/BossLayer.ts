import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import type { Boss } from "@shared/types";

export const BOSS_MODEL_ROOT = "/static/model/";
export const BOSS_MODEL_FILE = "skeith.glb";
const BOSS_MODEL_SCALE = 0.08;
const BOSS_MODEL_RAISE = 0.2;
const BOSS_MODEL_YAW_OFFSET = Math.PI;

export class BossLayer {
  private mesh: Mesh | null = null;
  private modelRoots: AbstractMesh[] | null = null;
  private modelTopY = 0;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  init(boss: Boss): void {
    const mesh = new Mesh(`boss-${boss.id}`, this.scene);
    this.mesh = mesh;
    void this.loadModel(mesh);
  }

  private async loadModel(anchor: Mesh): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync("", BOSS_MODEL_ROOT, BOSS_MODEL_FILE, this.scene);
      if (anchor.isDisposed()) {
        for (const mesh of result.meshes) mesh.dispose();
        for (const group of result.animationGroups) group.dispose();
        return;
      }

      for (const mesh of result.meshes) mesh.isPickable = false;
      const roots = result.meshes.filter(mesh => !mesh.parent);
      for (const root of roots) {
        root.parent = anchor;
        root.scaling.scaleInPlace(BOSS_MODEL_SCALE);
        root.rotate(Vector3.Up(), BOSS_MODEL_YAW_OFFSET, Space.LOCAL);
      }
      const bounds = roots.map(root => root.getHierarchyBoundingVectors(true));
      const minY = bounds.length > 0 ? Math.min(...bounds.map(b => b.min.y)) : 0;
      const maxY = bounds.length > 0 ? Math.max(...bounds.map(b => b.max.y)) : 0;
      const modelTop = BOSS_MODEL_RAISE + (maxY - minY);
      for (const root of roots) {
        root.position.y -= minY - BOSS_MODEL_RAISE + modelTop;
      }
      anchor.position.y = modelTop;
      this.modelTopY = modelTop;

      for (const group of result.animationGroups) group.dispose();

      this.modelRoots = roots;
    } catch (err) {
      logger.warn("render", "failed to load boss model", { file: BOSS_MODEL_FILE, err });
    }
  }

  sync(boss: Boss): void {
    if (!this.mesh) return;
    this.mesh.position.set(boss.pos.x, this.modelTopY, boss.pos.z);
    this.mesh.rotation.y = boss.facing;
    if (this.modelRoots) {
      for (const root of this.modelRoots) root.setEnabled(boss.hp > 0);
    }
  }

  getMesh(): Mesh | null {
    return this.mesh;
  }
}
