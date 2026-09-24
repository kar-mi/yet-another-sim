import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGroupMechanic, Player } from "@model/types";
import { glyphBillboardMaterial } from "@effects/babylon";
import { syncFloorTelegraphs, disposeFloorTelegraphs, type FloorTelegraphMap } from "@effects/babylon";

const ICON_Y = 3.2;

export class StackLayer {
  private icons = new Map<string, Mesh>();
  private circles: FloorTelegraphMap = new Map();
  private iconMaterial: StandardMaterial | null = null;

  constructor(private scene: Scene) {}

  sync(groups: ActiveGroupMechanic[], players: Player[], time: number): void {
    const playerMap = new Map(players.map(p => [p.id, p]));

    const want = new Set<string>();
    for (const group of groups) {
      if (!group.resolved && playerMap.get(group.markedPlayerId)?.alive) want.add(group.id);
    }

    for (const [id, mesh] of this.icons) {
      if (!want.has(id)) { mesh.dispose(); this.icons.delete(id); }
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
    }

    const aoes = groups.filter(g => g.floorAoe).map(g => g.floorAoe!);
    const resolvedIds = new Set(groups.filter(g => g.resolved).map(g => g.id));
    syncFloorTelegraphs(this.scene, this.circles, aoes, time, resolvedIds);
  }

  private getIconMaterial(): StandardMaterial {
    if (this.iconMaterial) return this.iconMaterial;
    this.iconMaterial = glyphBillboardMaterial(this.scene, "stack-icon-mat", "stack-icon-tex", "❖", "#66ccff");
    return this.iconMaterial;
  }

  dispose(): void {
    for (const mesh of this.icons.values()) mesh.dispose();
    this.icons.clear();
    disposeFloorTelegraphs(this.circles);
    this.iconMaterial?.dispose();
    this.iconMaterial = null;
  }
}
