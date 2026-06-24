import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import type { Player } from "@shared/types";
import { STATIC_ROOT } from "../staticBase";
import { glyphBillboardMaterial, imageBillboardMaterial } from "./meshes/billboardMaterials";

const PLAYER_CENTER_Y = 0.4;
export const PLAYER_MODEL_ROOT = `${STATIC_ROOT}/model/`;
export const DEFAULT_PLAYER_MODEL_FILE = "DefaultHermit.glb";
export const PLAYER_MODEL_FILES: Record<string, string> = {
  mt: "MTHermit.glb",
  ot: "OTHermit.glb",
  h1: "H1Hermit.glb",
  h2: "H2Hermit.glb",
  m1: "M1DPSHermit.glb",
  m2: "M2DPSHermit.glb",
  r1: "R1DPSHermit.glb",
  r2: "R2DPSHermit.glb",
};
const PLAYER_MODEL_SCALE = 1.7;
const MARKER_Y = 2.6;
const MARKER_SIZE = 0.65;
const MARKER_ICON_SCALE = 4;
const MARKER_SPACING = 0.7;

type MarkerState = {
  key: string;
  meshes: Mesh[];
};

function modelFileForPlayer(player: Player): string {
  return PLAYER_MODEL_FILES[player.id] ?? DEFAULT_PLAYER_MODEL_FILE;
}


export class PlayerLayer {
  private meshes = new Map<string, Mesh>();
  private modelRoots = new Map<string, AbstractMesh[]>();
  private markers = new Map<string, MarkerState>();

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

  sync(players: Player[], time: number): void {
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
      this.syncMarkers(player, mesh, time);
    }
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }

  private syncMarkers(player: Player, anchor: Mesh, time: number): void {
    const effects = player.alive
      ? player.effects.filter(effect => (effect.marker || effect.markerIcon) && effect.appliedAt + effect.duration > time)
      : [];
    const key = effects.map(effect => `${effect.id}:${effect.kind}:${effect.marker ?? ""}:${effect.markerIcon ?? ""}`).join("|");
    const current = this.markers.get(player.id);
    if (current?.key === key) return;
    if (current) {
      for (const mesh of current.meshes) mesh.dispose(false, true);
      this.markers.delete(player.id);
    }
    if (effects.length === 0) return;

    const meshes: Mesh[] = [];
    const startX = -((effects.length - 1) * MARKER_SPACING) / 2;
    effects.forEach((effect, index) => {
      const marker = effect.marker ?? "";
      const markerIcon = effect.markerIcon;
      const plane = CreatePlane(
        `player-marker-${player.id}-${effect.id}`,
        { size: markerIcon ? MARKER_SIZE * (effect.markerIconScale ?? MARKER_ICON_SCALE) : MARKER_SIZE },
        this.scene,
      );
      plane.parent = anchor;
      plane.position.set(startX + index * MARKER_SPACING, MARKER_Y, 0);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.material = markerIcon
        ? imageBillboardMaterial(
          this.scene,
          `player-marker-mat-${player.id}-${effect.id}`,
          `${STATIC_ROOT}/head_markers/${markerIcon}`,
        )
        : glyphBillboardMaterial(
          this.scene,
          `player-marker-mat-${player.id}-${effect.id}`,
          `player-marker-tex-${player.id}-${effect.id}`,
          marker,
          effect.kind === "buff" ? "#79d7ff" : "#ff6b6b",
        );
      meshes.push(plane);
    });
    this.markers.set(player.id, { key, meshes });
  }
}
