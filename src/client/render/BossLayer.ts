import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import type { Boss } from "@model/types";
import { STATIC_ROOT } from "../staticBase";
import { buildIndexModel, type IndexModel } from "./meshes/indexModel";
import type { ImplementHighlight } from "./sealedImplement";

export const BOSS_MODEL_ROOT = `${STATIC_ROOT}/model/boss/`;
export const BOSS_MODEL_FILE = "chaos.glb"; // default model; kept for preloadAssets
const BOSS_MODEL_SCALE = 0.08;
const BOSS_MODEL_RAISE = 0.2;
const BOSS_MODEL_YAW_OFFSET = Math.PI;

export class BossLayer {
  private mesh: Mesh | null = null;
  private modelRoots: AbstractMesh[] | null = null;
  private modelTopY = 0;
  private modelScale = 1;
  private indexModel: IndexModel | null = null;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  init(boss: Boss): void {
    const mesh = new Mesh(`boss-${boss.id}`, this.scene);
    this.mesh = mesh;
    this.modelScale = boss.modelScale;
    if (boss.model === "index") this.buildIndex(mesh, boss.id);
    else void this.loadModel(mesh, `${boss.model}.glb`);
  }

  // Build the Index from drawings instead of a GLB.
  private buildIndex(anchor: Mesh, bossId: string): void {
    const model = buildIndexModel(this.scene, `boss-${bossId}-index`);
    const modelTop = BOSS_MODEL_RAISE + model.height * this.modelScale;
    model.root.scaling.setAll(this.modelScale);
    model.root.position.y = BOSS_MODEL_RAISE - modelTop;
    model.root.parent = anchor;
    anchor.position.y = modelTop;
    this.modelTopY = modelTop;
    this.modelRoots = [model.root];
    this.indexModel = model;
  }

  private async loadModel(anchor: Mesh, file: string): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync("", BOSS_MODEL_ROOT, file, this.scene);
      if (anchor.isDisposed()) {
        for (const mesh of result.meshes) mesh.dispose();
        for (const group of result.animationGroups) group.dispose();
        return;
      }

      for (const mesh of result.meshes) mesh.isPickable = false;
      const roots = result.meshes.filter(mesh => !mesh.parent);
      for (const root of roots) {
        root.scaling.scaleInPlace(BOSS_MODEL_SCALE * this.modelScale);
        root.rotate(Vector3.Up(), BOSS_MODEL_YAW_OFFSET, Space.LOCAL);
      }
      const bounds = roots.map(root => root.getHierarchyBoundingVectors(true));
      const extent = (axis: "x" | "y" | "z") => ({
        min: bounds.length > 0 ? Math.min(...bounds.map(b => b.min[axis])) : 0,
        max: bounds.length > 0 ? Math.max(...bounds.map(b => b.max[axis])) : 0,
      });
      const x = extent("x");
      const y = extent("y");
      const z = extent("z");
      const modelTop = BOSS_MODEL_RAISE + (y.max - y.min);
      for (const root of roots) {
        root.position.x -= (x.min + x.max) / 2;
        root.position.z -= (z.min + z.max) / 2;
        root.position.y -= y.min - BOSS_MODEL_RAISE + modelTop;
        root.parent = anchor;
      }
      anchor.position.y = modelTop;
      this.modelTopY = modelTop;

      for (const group of result.animationGroups) group.dispose();

      this.modelRoots = roots;
    } catch (err) {
      logger.warn("render", "failed to load boss model", { file, err });
    }
  }

  sync(boss: Boss, time: number, implement: ImplementHighlight | null = null): void {
    if (!this.mesh) return;
    const modelHeight = this.modelTopY - BOSS_MODEL_RAISE;
    this.mesh.position.set(boss.pos.x, this.modelTopY - boss.sinkFraction * modelHeight, boss.pos.z);
    this.mesh.rotation.y = boss.facing;
    if (this.modelRoots) {
      for (const root of this.modelRoots) root.setEnabled(boss.hp > 0 && !boss.hidden);
    }
    const visible = boss.hp > 0 && !boss.hidden ? implement : null;
    this.indexModel?.highlight(visible?.weapon ?? null, time, visible?.glow);
  }

  getMesh(): Mesh | null {
    return this.mesh;
  }

  dispose(): void {
    if (this.indexModel) {
      this.indexModel.dispose();
      this.indexModel = null;
    } else if (this.modelRoots) {
      for (const root of this.modelRoots) root.dispose();
    }
    this.modelRoots = null;
    this.mesh?.dispose();
    this.mesh = null;
  }
}
