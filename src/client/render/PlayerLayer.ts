import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import type { LogEntry, Player } from "@model/types";
import { hasActiveStatus } from "@status";
import { length, sub } from "@shared/math";
import { STATIC_ROOT, STATUS_ICON_ROOT } from "../staticBase";
import { glyphBillboardMaterial, imageBillboardMaterial } from "@effects/babylon";
import { computeVisiblePlayerIds } from "./playerVisibility";
import { deathTimeOf } from "../pov";
import { BURST_DURATION, burstSeed, readBurstData, VoxelBurst, type BurstData } from "./voxelBurst";

const PLAYER_CENTER_Y = 0.4;
export const PLAYER_MODEL_ROOT = `${STATIC_ROOT}/model/player/`;
export const DEFAULT_PLAYER_MODEL_FILE = "mt-voxel.glb";
export const PLAYER_MODEL_FILES: Record<string, string> = {
  mt: "mt-voxel.glb",
  ot: "ot-voxel.glb",
  h1: "h1-voxel.glb",
  h2: "h2-voxel.glb",
  m1: "m1-voxel.glb",
  m2: "m2-voxel.glb",
  r1: "r1-voxel.glb",
  r2: "r2-voxel.glb",
};
const PLAYER_MODEL_SCALE = 0.3;
const MARKER_Y = 2.6;
const MARKER_SIZE = 0.65;
const MARKER_ICON_SCALE = 4;
const MARKER_SPACING = 0.7;

const AIRBORNE_EPS = 0.01;
const MOVING_EPS = 0.15;

const CLIP_IDLE = "Idle";
const CLIP_WALKING = "Walk";
const CLIP_RUNNING = "Sprint";
const CLIP_JUMP = "Jump";

type MarkerState = {
  key: string;
  meshes: Mesh[];
};

export type DeathSource = { seed: number; log: readonly LogEntry[] };

function modelFileForPlayer(player: Player): string {
  return PLAYER_MODEL_FILES[player.id] ?? DEFAULT_PLAYER_MODEL_FILE;
}


export class PlayerLayer {
  private meshes = new Map<string, Mesh>();
  private modelRoots = new Map<string, AbstractMesh[]>();
  private markers = new Map<string, MarkerState>();
  private clips = new Map<string, Map<string, AnimationGroup>>();
  private activeClip = new Map<string, string>();
  private deathTime = new Map<string, number>();
  private burstData = new Map<string, { data: BurstData; frame: TransformNode }>();
  private bursts = new Map<string, VoxelBurst>();
  private prevPos = new Map<string, { x: number; z: number; time: number }>();
  private visiblePlayerIds = new Set<string>();

  constructor(private scene: Scene) {}

  init(players: Player[]): void {
    this.visiblePlayerIds = computeVisiblePlayerIds(players);
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

      const touchedMaterials = new Set<PBRMaterial>();
      for (const mesh of result.meshes) {
        mesh.isPickable = false;
        if (mesh.material instanceof PBRMaterial) touchedMaterials.add(mesh.material);
      }
      for (const material of touchedMaterials) material.roughness = 1;
      const roots = result.meshes.filter(mesh => !mesh.parent);
      for (const root of roots) {
        root.parent = anchor;
        root.position.y -= PLAYER_CENTER_Y;
        root.scaling.scaleInPlace(PLAYER_MODEL_SCALE);
      }
      for (const group of result.animationGroups) group.stop();
      const clipsByName = new Map(result.animationGroups.map(group => [group.name, group]));
      this.clips.set(playerId, clipsByName);
      clipsByName.get(CLIP_IDLE)?.start(true);
      this.activeClip.set(playerId, CLIP_IDLE);

      const data = readBurstData(result.transformNodes.find(node => node.name === "root")?.metadata);
      if (data && roots[0]) this.burstData.set(playerId, { data, frame: roots[0] });

      this.modelRoots.set(playerId, roots);
    } catch (err) {
      logger.warn("render", "failed to load player model", { file: modelFile, err });
      if (modelFile !== DEFAULT_PLAYER_MODEL_FILE) {
        await this.loadModel(playerId, anchor, DEFAULT_PLAYER_MODEL_FILE);
      }
    }
  }

  sync(players: Player[], time: number, botsInvisible: boolean, deaths: DeathSource): void {
    this.visiblePlayerIds = computeVisiblePlayerIds(players);
    for (const player of players) {
      const mesh = this.meshes.get(player.id);
      if (!mesh) continue;
      mesh.setEnabled(this.visiblePlayerIds.has(player.id) && !(botsInvisible && player.control === "bot"));
      mesh.position.x = player.pos.x;
      mesh.position.y = PLAYER_CENTER_Y + player.y;
      mesh.position.z = player.pos.z;
      mesh.rotation.y = player.facing;
      const modelRoots = this.modelRoots.get(player.id);
      if (modelRoots) this.syncAnimation(player, modelRoots, time, deaths);
      this.syncMarkers(player, mesh, time);
    }
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }

  isVisible(id: string): boolean {
    return this.visiblePlayerIds.has(id);
  }

  private syncAnimation(player: Player, roots: AbstractMesh[], time: number, deaths: DeathSource): void {
    const clipsByName = this.clips.get(player.id);
    const previous = this.prevPos.get(player.id);

    if (previous && time < previous.time) {
      this.endBurst(player.id);
      this.deathTime.delete(player.id);
      for (const clip of clipsByName?.values() ?? []) clip.stop();
      this.activeClip.delete(player.id);
      this.prevPos.delete(player.id);
      for (const root of roots) root.setEnabled(true);
    }

    if (!player.alive) {
      let deathTime = this.deathTime.get(player.id);
      if (deathTime === undefined) {
        deathTime = deathTimeOf(deaths.log, player.id, time) ?? time;
        this.deathTime.set(player.id, deathTime);
        const current = this.activeClip.get(player.id);
        if (current) clipsByName?.get(current)?.stop();
        this.activeClip.delete(player.id);
        for (const root of roots) root.setEnabled(false);
      }
      const elapsed = time - deathTime;
      const data = this.burstData.get(player.id);
      const anchor = this.meshes.get(player.id);
      if (data && anchor && elapsed >= 0 && elapsed < BURST_DURATION) {
        let burst = this.bursts.get(player.id);
        if (!burst) {
          burst = new VoxelBurst(this.scene, data.frame, anchor, data.data, burstSeed(deaths.seed, player.id));
          this.bursts.set(player.id, burst);
        }
        burst.render(elapsed);
      } else {
        this.endBurst(player.id);
      }
      return;
    }

    if (this.deathTime.has(player.id)) {
      this.endBurst(player.id);
      this.deathTime.delete(player.id);
      for (const root of roots) root.setEnabled(true);
    }
    if (!clipsByName) return;

    const prev = this.prevPos.get(player.id);
    if (prev && time <= prev.time) return;

    const dt = prev ? time - prev.time : 0;
    const speed = prev && dt > 0 ? length(sub(player.pos, prev)) / dt : 0;
    this.prevPos.set(player.id, { x: player.pos.x, z: player.pos.z, time });

    const airborne = player.y > AIRBORNE_EPS;
    const moving = speed > MOVING_EPS;
    const desired = airborne
      ? CLIP_JUMP
      : moving
        ? hasActiveStatus(player, "sprint", time) ? CLIP_RUNNING : CLIP_WALKING
        : CLIP_IDLE;

    if (this.activeClip.get(player.id) !== desired) {
      const current = this.activeClip.get(player.id);
      if (current) clipsByName.get(current)?.stop();
      clipsByName.get(desired)?.start(true);
      this.activeClip.set(player.id, desired);
    }
  }

  dispose(): void {
    for (const burst of this.bursts.values()) burst.dispose();
    for (const clips of this.clips.values()) {
      for (const group of clips.values()) group.dispose();
    }
    for (const mesh of this.meshes.values()) mesh.dispose(false, true);
    this.bursts.clear();
    this.clips.clear();
    this.meshes.clear();
    this.modelRoots.clear();
    this.markers.clear();
    this.activeClip.clear();
    this.burstData.clear();
  }

  private endBurst(playerId: string): void {
    this.bursts.get(playerId)?.dispose();
    this.bursts.delete(playerId);
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
          `${STATUS_ICON_ROOT}/${markerIcon}`,
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
