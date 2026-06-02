import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGroupMechanic, Player } from "../../shared/types";

const ICON_Y = 3.2; // height of the stack marker above the marked player

export class StackLayer {
  private icons = new Map<string, Mesh>(); // group id -> billboard plane over the marked player
  private iconMaterial: StandardMaterial | null = null;

  constructor(private scene: Scene) {}

  sync(groups: ActiveGroupMechanic[], players: Player[], time: number): void {
    const playerMap = new Map(players.map(p => [p.id, p]));

    // Marker shows only while the cast is in progress (before it resolves).
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
      let icon = this.icons.get(group.id);
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

  private getIconMaterial(): StandardMaterial {
    if (this.iconMaterial) return this.iconMaterial;
    const tex = new DynamicTexture("stack-icon-tex", { width: 128, height: 128 }, this.scene, false);
    tex.hasAlpha = true;
    // null x centers the stack glyph horizontally; clear to transparent.
    tex.drawText("❖", null, 96, "bold 96px sans-serif", "#ffd24a", "transparent", true, true);
    const mat = new StandardMaterial("stack-icon-mat", this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    this.iconMaterial = mat;
    return mat;
  }

  dispose(): void {
    for (const mesh of this.icons.values()) mesh.dispose();
    this.icons.clear();
    this.iconMaterial?.dispose();
    this.iconMaterial = null;
  }
}
