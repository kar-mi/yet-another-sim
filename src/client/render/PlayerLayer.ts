import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import type { Player } from "../../shared/types";

export class PlayerLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  init(players: Player[]): void {
    for (const player of players) {
      const mesh = MeshBuilder.CreateCapsule(`player-${player.id}`, { radius: 0.5, height: 2 }, this.scene);
      const mat = new StandardMaterial(`pmat-${player.id}`, this.scene);
      mat.diffuseColor =
        player.role === "tank" ? new Color3(0.3, 0.5, 1) :
        player.role === "healer" ? new Color3(0.3, 1, 0.5) :
        new Color3(1, 0.4, 0.4);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mesh.material = mat;
      mesh.position.set(player.pos.x, 1, player.pos.z);
      this.meshes.set(player.id, mesh);
    }
  }

  sync(players: Player[]): void {
    for (const player of players) {
      const mesh = this.meshes.get(player.id);
      if (!mesh) continue;
      mesh.position.x = player.pos.x;
      mesh.position.z = player.pos.z;
      mesh.isVisible = player.alive;
    }
  }
}
