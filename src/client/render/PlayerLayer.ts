import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import type { Player } from "../../shared/types";

const PLAYER_RADIUS = 0.6;
const PLAYER_HEIGHT = 2.4;
const PLAYER_CENTER_Y = PLAYER_HEIGHT / 2;

export class PlayerLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  init(players: Player[]): void {
    for (const player of players) {
      const mesh = MeshBuilder.CreateCapsule(`player-${player.id}`, {
        radius: PLAYER_RADIUS,
        height: PLAYER_HEIGHT,
        subdivisions: 2,
        tessellation: 16,
        capSubdivisions: 6,
      }, this.scene);
      const mat = new StandardMaterial(`pmat-${player.id}`, this.scene);
      const color =
        player.role === "tank" ? new Color3(0.3, 0.5, 1) :
        player.role === "healer" ? new Color3(0.3, 1, 0.5) :
        new Color3(1, 0.4, 0.4);
      mat.diffuseColor = color;
      mat.emissiveColor = color.scale(0.25);
      mat.backFaceCulling = false;
      mat.twoSidedLighting = true;
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mesh.material = mat;
      mesh.position.set(player.pos.x, PLAYER_CENTER_Y + player.y, player.pos.z);
      this.meshes.set(player.id, mesh);
    }
  }

  sync(players: Player[]): void {
    for (const player of players) {
      const mesh = this.meshes.get(player.id);
      if (!mesh) continue;
      mesh.position.x = player.pos.x;
      mesh.position.y = PLAYER_CENTER_Y + player.y;
      mesh.position.z = player.pos.z;
      mesh.isVisible = player.alive;
    }
  }
}
