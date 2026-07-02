import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { TetherSource, Player } from "@shared/types";

export class TetherLayer {
  private spheres = new Map<string, Mesh>();
  private lines = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  sync(tetherSources: TetherSource[], players: Player[], time: number): void {
    const activeIds = new Set(tetherSources.map(ts => ts.id));

    for (const [id, mesh] of this.spheres) {
      if (!activeIds.has(id)) { mesh.dispose(false, true); this.spheres.delete(id); }
    }
    for (const [id, line] of this.lines) {
      if (!activeIds.has(id)) {
        line.dispose(false, true);
        this.lines.delete(id);
      }
    }

    const playerMap = new Map(players.map(p => [p.id, p]));

    for (const ts of tetherSources) {
      // Sphere mesh for the tether source entity
      if (!ts.showSource) {
        const existing = this.spheres.get(ts.id);
        if (existing) {
          existing.dispose(false, true);
          this.spheres.delete(ts.id);
        }
      } else if (!this.spheres.has(ts.id)) {
        const sphere = CreateSphere(ts.id, { diameter: 1.5, segments: 8 }, this.scene);
        const mat = new StandardMaterial(`mat-${ts.id}`, this.scene);
        const color = ts.tetherKind === "buff" ? new Color3(0.2, 0.9, 0.3) : new Color3(0.9, 0.15, 0.15);
        mat.diffuseColor = color;
        mat.emissiveColor = color.scale(0.4);
        sphere.material = mat;
        this.spheres.set(ts.id, sphere);
      }

      const sphere = this.spheres.get(ts.id);
      if (sphere) {
        sphere.position.set(ts.pos.x, 0.75, ts.pos.z);
        const mat = sphere.material as StandardMaterial;
        if (ts.finalized) {
          mat.alpha = Math.max(0, 1 - (time - ts.finalizeAt) / 2);
        } else {
          mat.alpha = 1;
        }
      }

      const tethered = ts.tetheredPlayerId ? playerMap.get(ts.tetheredPlayerId) : null;
      const oldLine = this.lines.get(ts.id);
      if (!tethered?.alive || ts.finalized) {
        if (oldLine) {
          oldLine.dispose(false, true);
          this.lines.delete(ts.id);
        }
        continue;
      }

      const points = [
        new Vector3(ts.pos.x, 0.75, ts.pos.z),
        new Vector3(tethered.pos.x, 0.75, tethered.pos.z),
      ];
      if (oldLine) {
        CreateTube(`${ts.id}-line`, { path: points, instance: oldLine });
      } else {
        const color = ts.tetherKind === "buff" ? new Color3(0.2, 1.0, 0.4) : new Color3(1.0, 0.2, 0.2);
        const mat = new StandardMaterial(`mat-${ts.id}-line`, this.scene);
        mat.diffuseColor = color;
        mat.emissiveColor = color.scale(0.6);
        mat.specularColor = new Color3(0.05, 0.05, 0.05);
        const line = CreateTube(`${ts.id}-line`, {
          updatable: true,
          path: points,
          radius: 0.09,
          tessellation: 8,
          cap: BabylonMesh.CAP_ALL,
        }, this.scene);
        line.material = mat;
        this.lines.set(ts.id, line);
      }
    }
  }
}
