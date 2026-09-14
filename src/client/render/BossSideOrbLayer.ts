import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@shared/types";
import type { BossSideOrbColors } from "./bossSideOrbs";

const SIDE_ORB_DIAMETER = 1.6;
const SIDE_ORB_OFFSET = 2.4;
const SIDE_ORB_HEIGHT = 2;

export class BossSideOrbLayer {
  private node?: TransformNode;
  private orbs?: { left: Mesh; right: Mesh };
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(private scene: Scene) {}

  sync(boss: Boss, colors?: BossSideOrbColors): void {
    const shown = boss.hp > 0 && !boss.hidden;
    if (!shown || (!colors?.leftColor && !colors?.rightColor)) {
      this.node?.setEnabled(false);
      return;
    }
    if (!this.orbs) this.build();
    this.node!.position.set(boss.pos.x, SIDE_ORB_HEIGHT, boss.pos.z);
    this.node!.rotation.y = boss.facing;
    this.node!.setEnabled(true);
    for (const [side, color] of [["left", colors.leftColor], ["right", colors.rightColor]] as const) {
      const orb = this.orbs![side];
      if (color === undefined) {
        orb.setEnabled(false);
        continue;
      }
      orb.material = this.material(color);
      orb.setEnabled(true);
    }
  }

  private build(): void {
    this.node = new TransformNode("boss-side-orbs", this.scene);
    const make = (side: "left" | "right"): Mesh => {
      const orb = CreateSphere(`boss-side-orb-${side}`, { diameter: SIDE_ORB_DIAMETER, segments: 16 }, this.scene);
      orb.parent = this.node!;
      orb.position.x = side === "left" ? -SIDE_ORB_OFFSET : SIDE_ORB_OFFSET;
      orb.isPickable = false;
      return orb;
    };
    this.orbs = { left: make("left"), right: make("right") };
  }

  private material(color: string): StandardMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const material = new StandardMaterial(`boss-side-orb-mat-${color}`, this.scene);
    const tint = Color3.FromHexString(color);
    material.diffuseColor = tint;
    material.emissiveColor = tint;
    material.specularColor = new Color3(0, 0, 0);
    material.disableLighting = true;
    this.materials.set(color, material);
    return material;
  }

  dispose(): void {
    this.orbs?.left.dispose();
    this.orbs?.right.dispose();
    this.orbs = undefined;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.node?.dispose();
    this.node = undefined;
  }
}
