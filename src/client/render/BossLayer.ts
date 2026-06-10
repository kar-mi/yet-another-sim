import { Color3 } from "@babylonjs/core/Maths/math.color";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "../../shared/logger";
import type { Boss } from "../../shared/types";

const BOSS_MODEL_ROOT = "/static/model/";
const BOSS_MODEL_FILE = "necromancer.glb";
const BOSS_MODEL_SCALE = 2;
const BOSS_MODEL_RAISE = 0.2;
const BOSS_MODEL_YAW_OFFSET = Math.PI;

export class BossLayer {
  private mesh?: Mesh;
  private faceMarker?: Mesh;
  private modelRoots?: AbstractMesh[];

  constructor(private scene: Scene) {}

  private height = 0;
  private static readonly VERTICAL_STRETCH = 1.25;
  private static readonly HORIZONTAL_SCALE = 0.7;

  init(boss: Boss): void {
    const diameter = boss.radius * 2;
    this.height = diameter * BossLayer.VERTICAL_STRETCH;
    const mesh = CreateSphere(`boss-${boss.id}`, {
      diameter,
      segments: 32,
    }, this.scene);
    // Shorter, thinner vertical oval (prolate spheroid): taller than wide, narrowed footprint.
    mesh.scaling.y = BossLayer.VERTICAL_STRETCH;
    mesh.scaling.x = BossLayer.HORIZONTAL_SCALE;
    mesh.scaling.z = BossLayer.HORIZONTAL_SCALE;
    const mat = new StandardMaterial(`boss-mat-${boss.id}`, this.scene);
    const color = new Color3(0.4, 0.03, 0.03); // dark red
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.18);
    mat.specularColor = new Color3(0.05, 0.02, 0.02);
    mesh.material = mat;
    mesh.position.set(boss.pos.x, this.height / 2, boss.pos.z);
    this.mesh = mesh;

    // TEMP: light-orange smiley "face" on the front (+Z local) to make rotation visible.
    const face = CreatePlane(`boss-face-${boss.id}`, { size: boss.radius }, this.scene);
    const faceMat = new StandardMaterial(`boss-face-mat-${boss.id}`, this.scene);
    const tex = this.makeSmileyTexture(`boss-face-tex-${boss.id}`);
    faceMat.diffuseTexture = tex;
    faceMat.emissiveTexture = tex;
    faceMat.useAlphaFromDiffuseTexture = true;
    faceMat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; // discard transparent pixels
    faceMat.alphaCutOff = 0.4;
    faceMat.disableLighting = true;
    faceMat.backFaceCulling = false;
    face.material = faceMat;
    this.faceMarker = face;

    void this.loadModel(mesh);
  }

  private makeSmileyTexture(name: string): DynamicTexture {
    const tex = new DynamicTexture(name, { width: 256, height: 256 }, this.scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 256); // start fully transparent
    ctx.fillStyle = "#ffb259"; // light orange
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a1500";
    ctx.beginPath(); ctx.arc(92, 102, 17, 0, Math.PI * 2); ctx.fill();  // left eye
    ctx.beginPath(); ctx.arc(164, 102, 17, 0, Math.PI * 2); ctx.fill(); // right eye
    ctx.strokeStyle = "#3a1500";
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.arc(128, 138, 58, 0.15 * Math.PI, 0.85 * Math.PI); // smile
    ctx.stroke();
    tex.update();
    return tex;
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
      for (const root of roots) {
        root.position.y -= minY - BOSS_MODEL_RAISE;
      }
      const idleGroup = result.animationGroups.find(group => group.name.toLowerCase().includes("idle"));
      (idleGroup ?? result.animationGroups[0])?.start(true);

      this.modelRoots = roots;
      anchor.isVisible = false;
      if (this.faceMarker) this.faceMarker.isVisible = false;
    } catch (err) {
      logger.warn("render", "failed to load boss model", { file: BOSS_MODEL_FILE, err });
    }
  }

  sync(boss: Boss): void {
    if (!this.mesh) return;
    this.mesh.position.set(boss.pos.x, this.height / 2, boss.pos.z);
    this.mesh.rotation.y = boss.facing;
    this.mesh.isVisible = boss.hp > 0 && !this.modelRoots;

    // TEMP: keep the face square on the front surface, facing outward along boss.facing (0 = +Z).
    if (this.faceMarker && !this.modelRoots) {
      const dist = boss.radius * BossLayer.HORIZONTAL_SCALE;
      this.faceMarker.position.set(
        boss.pos.x + Math.sin(boss.facing) * dist,
        this.height * 0.65,
        boss.pos.z + Math.cos(boss.facing) * dist,
      );
      this.faceMarker.rotation.y = boss.facing;
      this.faceMarker.isVisible = boss.hp > 0;
    }
    if (this.modelRoots) {
      for (const root of this.modelRoots) root.setEnabled(boss.hp > 0);
    }
  }

  getMesh(): Mesh | undefined {
    return this.mesh;
  }
}
