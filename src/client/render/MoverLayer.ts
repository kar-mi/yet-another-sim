import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@model/types";
import { moverPosition } from "@model/mover";
import { createCleansingOrb } from "./meshes/cleansingOrbMeshes";

const MOVER_Y = 1.5;
const DEFAULT_COLOR = "#ffffff";

export class MoverLayer {
  private movers = new Map<string, TransformNode>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    const wanted = new Map<string, ActiveMechanic>();
    for (const m of mechanics) {
      if (m.resolved || !m.mover || m.glyph || (m.shape.kind !== "circle" && m.shape.kind !== "donut")) continue;
      wanted.set(`${m.id}|${m.shape.kind}|${m.color ?? DEFAULT_COLOR}`, m);
    }

    for (const [key, mesh] of this.movers) {
      if (!wanted.has(key)) {
        mesh.dispose(false, true);
        this.movers.delete(key);
      }
    }

    for (const [key, m] of wanted) {
      if (m.shape.kind !== "circle" && m.shape.kind !== "donut") continue;
      let mesh = this.movers.get(key);
      if (!mesh) {
        mesh = m.mover!.sprite ? createCleansingOrb(this.scene, m.id, m.shape.kind) : this.createOrb(m);
        mesh.scaling.setAll(m.mover!.scale ?? 1);
        this.movers.set(key, mesh);
      }
      const pos = moverPosition(m.mover!, m.shape.center, m.resolveAt, time);
      mesh.position.set(pos.x, m.mover!.sprite ? 0 : MOVER_Y, pos.z);
    }
  }

  private createOrb(m: ActiveMechanic): Mesh {
    const mesh = m.shape.kind === "donut"
      ? CreateTorus(`mover-${m.id}`, { diameter: 2.4, thickness: 0.7, tessellation: 32 }, this.scene)
      : CreateSphere(`mover-${m.id}`, { diameter: 2.4, segments: 16 }, this.scene);
    const mat = new StandardMaterial(`mover-mat-${m.id}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(m.color ?? DEFAULT_COLOR);
    mat.emissiveColor = mat.diffuseColor.scale(0.5);
    mat.specularColor = Color3.White().scale(0.2);
    mat.alpha = 0.9;
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.movers.values()) mesh.dispose(false, true);
    this.movers.clear();
  }
}
