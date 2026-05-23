import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "../../shared/types";

export class BossLayer {
  private mesh?: Mesh;

  constructor(private scene: Scene) {}

  init(boss: Boss): void {
    const mesh = CreateSphere(`boss-${boss.id}`, {
      diameter: boss.radius * 2,
      segments: 32,
    }, this.scene);
    const mat = new StandardMaterial(`boss-mat-${boss.id}`, this.scene);
    const color = new Color3(0.65, 0.08, 0.08);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.18);
    mat.specularColor = new Color3(0.05, 0.02, 0.02);
    mesh.material = mat;
    mesh.position.set(boss.pos.x, boss.radius, boss.pos.z);
    this.mesh = mesh;
  }

  sync(boss: Boss): void {
    if (!this.mesh) return;
    this.mesh.position.set(boss.pos.x, boss.radius, boss.pos.z);
    this.mesh.isVisible = boss.hp > 0;
  }

  getMesh(): Mesh | undefined {
    return this.mesh;
  }
}
