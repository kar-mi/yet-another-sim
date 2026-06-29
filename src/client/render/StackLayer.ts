import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGroupMechanic, Player } from "@shared/types";
import { glyphBillboardMaterial } from "./meshes/billboardMaterials";

const ICON_Y = 3.2;    // height of the stack marker above the marked player
const CIRCLE_Y = 0.02; // ground circle just above the floor

export class StackLayer {
  private icons = new Map<string, Mesh>();   // group id -> billboard plane over the marked player
  private circles = new Map<string, Mesh>(); // group id -> ground stack circle
  private iconMaterial: StandardMaterial | null = null;

  constructor(private scene: Scene) {}

  sync(groups: ActiveGroupMechanic[], players: Player[], time: number): void {
    const playerMap = new Map(players.map(p => [p.id, p]));

    // The marker + circle show only while the cast is in progress (before it resolves).
    const want = new Set<string>();
    for (const group of groups) {
      if (!group.resolved && playerMap.get(group.markedPlayerId)?.alive) want.add(group.id);
    }

    for (const [id, mesh] of this.icons) {
      if (!want.has(id)) { mesh.dispose(); this.icons.delete(id); }
    }
    for (const [id, mesh] of this.circles) {
      if (!want.has(id)) { mesh.dispose(false, true); this.circles.delete(id); }
    }

    for (const group of groups) {
      if (!want.has(group.id)) continue;
      const player = playerMap.get(group.markedPlayerId);
      if (!player) continue;

      const existingIcon = this.icons.get(group.id);
      if (!group.showMarker) {
        existingIcon?.dispose();
        this.icons.delete(group.id);
      } else {
        let icon = existingIcon;
        if (!icon) {
          icon = CreatePlane(`stack-icon-${group.id}`, { size: 1.3 }, this.scene);
          icon.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
          icon.isPickable = false;
          icon.material = this.getIconMaterial();
          this.icons.set(group.id, icon);
        }
        icon.position.set(player.pos.x, ICON_Y, player.pos.z);
      }

      let circle = this.circles.get(group.id);
      if (!circle) {
        circle = CreateDisc(`stack-circle-${group.id}`, { radius: group.radius, tessellation: 64 }, this.scene);
        circle.rotation.x = Math.PI / 2;
        circle.isPickable = false;
        const mat = new StandardMaterial(`stack-circle-mat-${group.id}`, this.scene);
        mat.diffuseColor = new Color3(0.3, 0.7, 1.0); // blue = "stack here"
        mat.specularColor = new Color3(0, 0, 0);
        mat.backFaceCulling = false;
        circle.material = mat;
        this.circles.set(group.id, circle);
      }
      circle.position.set(player.pos.x, CIRCLE_Y, player.pos.z);
      const span = group.resolveAt - group.telegraphStart;
      const progress = span > 0 ? Math.min(1, (time - group.telegraphStart) / span) : 1;
      (circle.material as StandardMaterial).alpha = 0.25 + progress * 0.45;
    }
  }

  private getIconMaterial(): StandardMaterial {
    if (this.iconMaterial) return this.iconMaterial;
    this.iconMaterial = glyphBillboardMaterial(this.scene, "stack-icon-mat", "stack-icon-tex", "❖", "#66ccff");
    return this.iconMaterial;
  }

  dispose(): void {
    for (const mesh of this.icons.values()) mesh.dispose();
    for (const mesh of this.circles.values()) mesh.dispose(false, true);
    this.icons.clear();
    this.circles.clear();
    this.iconMaterial?.dispose();
    this.iconMaterial = null;
  }
}
