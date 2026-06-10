import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "../../shared/logger";
import type { Player } from "../../shared/types";

const PLAYER_CENTER_Y = 0.4;
const PLAYER_MODEL_ROOT = "/static/model/";
const DEFAULT_PLAYER_MODEL_FILE = "DefaultHermit.glb";
const TANK_PLAYER_MODEL_FILE = "TankHermit.glb";
const HEALER_PLAYER_MODEL_FILE = "HealHermit.glb";
const DPS_PLAYER_MODEL_FILE = "DPSHermit.glb";
const PLAYER_MODEL_SCALE = 3;

function modelFileForPlayer(player: Player): string {
  switch (player.role) {
    case "tank":
      return TANK_PLAYER_MODEL_FILE;
    case "healer":
      return HEALER_PLAYER_MODEL_FILE;
    case "dps":
      return DPS_PLAYER_MODEL_FILE;
  }
}


export class PlayerLayer {
  private meshes = new Map<string, Mesh>();
  private modelRoots = new Map<string, AbstractMesh[]>();

  constructor(private scene: Scene) {}

  init(players: Player[]): void {
    for (const player of players) {
      const mesh = new Mesh(`player-${player.id}`, this.scene);
      mesh.position.set(player.pos.x, PLAYER_CENTER_Y + player.y, player.pos.z);
      mesh.rotation.y = player.facing;
      this.meshes.set(player.id, mesh);
      void this.loadModel(player.id, mesh, modelFileForPlayer(player));
    }
  }

  private async loadModel(playerId: string, anchor: Mesh, modelFile: string): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync("", PLAYER_MODEL_ROOT, modelFile, this.scene);
      if (anchor.isDisposed()) {
        for (const mesh of result.meshes) mesh.dispose();
        for (const group of result.animationGroups) group.dispose();
        return;
      }

      for (const mesh of result.meshes) mesh.isPickable = false;
      const roots = result.meshes.filter(mesh => !mesh.parent);
      for (const root of roots) {
        root.parent = anchor;
        root.position.y -= PLAYER_CENTER_Y;
        root.scaling.scaleInPlace(PLAYER_MODEL_SCALE);
      }
      for (const group of result.animationGroups) group.start(true);

      this.modelRoots.set(playerId, roots);
    } catch (err) {
      logger.warn("render", "failed to load player model", { file: modelFile, err });
      if (modelFile !== DEFAULT_PLAYER_MODEL_FILE) {
        await this.loadModel(playerId, anchor, DEFAULT_PLAYER_MODEL_FILE);
      }
    }
  }

  sync(players: Player[]): void {
    for (const player of players) {
      const mesh = this.meshes.get(player.id);
      if (!mesh) continue;
      mesh.position.x = player.pos.x;
      mesh.position.y = PLAYER_CENTER_Y + player.y;
      mesh.position.z = player.pos.z;
      mesh.rotation.y = player.facing;
      const modelRoots = this.modelRoots.get(player.id);
      if (modelRoots) {
        for (const root of modelRoots) root.setEnabled(player.alive);
      }
    }
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }
}
