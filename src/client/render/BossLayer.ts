import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "../../shared/types";

export class BossLayer {
  private mesh?: Mesh;

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
    const color = new Color3(0.65, 0.08, 0.08);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.18);
    mat.specularColor = new Color3(0.05, 0.02, 0.02);
    mesh.material = mat;
    mesh.position.set(boss.pos.x, this.height / 2, boss.pos.z);
    this.mesh = mesh;
  }

  sync(boss: Boss): void {
    if (!this.mesh) return;
    this.mesh.position.set(boss.pos.x, this.height / 2, boss.pos.z);
    this.mesh.isVisible = boss.hp > 0;
  }

  getMesh(): Mesh | undefined {
    return this.mesh;
  }
}
