import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@shared/types";

const RING_Y = 0.04;         // just above the floor (slightly higher than BossRingLayer at 0.03)
const RING_THICKNESS = 0.07; // tube diameter
const COLOR = new Color3(0, 0.9, 1); // cyan

export class TargetRingLayer {
  private mesh?: ReturnType<typeof CreateTorus>;
  private material?: StandardMaterial;

  constructor(private scene: Scene) {}

  sync(boss: Boss, isTargeted: boolean): void {
    if (!this.mesh) this.build(boss);
    this.mesh!.position.set(boss.pos.x, RING_Y, boss.pos.z);
    this.mesh!.setEnabled(boss.hp > 0 && isTargeted);
  }

  private build(boss: Boss): void {
    const radius = boss.radius * boss.ringScale;
    this.mesh = CreateTorus("target-ring", {
      diameter: radius * 2,
      thickness: RING_THICKNESS,
      tessellation: 48,
    }, this.scene);
    this.mesh.rotation.x = Math.PI / 2; // lay flat on the XZ plane
    this.mesh.isPickable = false;

    this.material = new StandardMaterial("target-ring-mat", this.scene);
    this.material.diffuseColor = COLOR;
    this.material.emissiveColor = COLOR;
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.mesh.material = this.material;
  }

  dispose(): void {
    this.mesh?.dispose();
    this.mesh = undefined;
    this.material?.dispose();
    this.material = undefined;
  }
}
