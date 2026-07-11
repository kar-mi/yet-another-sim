import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import type { Player } from "@shared/types";
import { length, sub } from "@shared/math";
import { STATIC_ROOT } from "../staticBase";
import { glyphBillboardMaterial, imageBillboardMaterial } from "./meshes/billboardMaterials";

const PLAYER_CENTER_Y = 0.4;
export const PLAYER_MODEL_ROOT = `${STATIC_ROOT}/model/player/`;
export const DEFAULT_PLAYER_MODEL_FILE = "mt.glb";
export const PLAYER_MODEL_FILES: Record<string, string> = {
  mt: "mt.glb",
  ot: "ot.glb",
  h1: "h1.glb",
  h2: "h2.glb",
  m1: "m1.glb",
  m2: "m2.glb",
  r1: "r1.glb",
  r2: "r2.glb",
};
const PLAYER_MODEL_SCALE = 0.3;
const MARKER_Y = 2.6;
const MARKER_SIZE = 0.65;
const MARKER_ICON_SCALE = 4;
const MARKER_SPACING = 0.7;

const AIRBORNE_EPS = 0.01;
const MOVING_EPS = 0.15; // units/sec; well below MOVE_SPEED (6) to ignore jitter

const CLIP_IDLE = "Robot_Idle";
const CLIP_WALKING = "Robot_Walking";
const CLIP_RUNNING = "Robot_Running";
const CLIP_JUMP = "Robot_Jump";
const CLIP_DEATH = "Robot_Death";

type MarkerState = {
  key: string;
  meshes: Mesh[];
};

type DeathState = "alive" | "dying" | "dead";

function modelFileForPlayer(player: Player): string {
  return PLAYER_MODEL_FILES[player.id] ?? DEFAULT_PLAYER_MODEL_FILE;
}


export class PlayerLayer {
  private meshes = new Map<string, Mesh>();
  private modelRoots = new Map<string, AbstractMesh[]>();
  private markers = new Map<string, MarkerState>();
  private clips = new Map<string, Map<string, AnimationGroup>>();
  private activeClip = new Map<string, string>();
  private deathState = new Map<string, DeathState>();
  private prevPos = new Map<string, { x: number; z: number; time: number }>();

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
      for (const group of result.animationGroups) group.stop();
      const clipsByName = new Map(result.animationGroups.map(group => [group.name, group]));
      this.clips.set(playerId, clipsByName);
      clipsByName.get(CLIP_IDLE)?.start(true);
      this.activeClip.set(playerId, CLIP_IDLE);

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
      if (modelRoots) this.syncAnimation(player, modelRoots, time);
      this.syncMarkers(player, mesh, time);
    }
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }

  private syncAnimation(player: Player, roots: AbstractMesh[], time: number): void {
    const clipsByName = this.clips.get(player.id);
    const previous = this.prevPos.get(player.id);

    // A new pull restarts world time at zero.  Unlike a pause (same time), this must discard the
    // prior pull's death/locomotion clip before choosing the new state's animation.
    if (previous && time < previous.time) {
      for (const clip of clipsByName?.values() ?? []) clip.stop();
      this.activeClip.delete(player.id);
      this.deathState.set(player.id, "alive");
      this.prevPos.delete(player.id);
      for (const root of roots) root.setEnabled(true);
    }

    const state = this.deathState.get(player.id) ?? "alive";

    if (!player.alive) {
      if (state === "dead") {
        for (const root of roots) root.setEnabled(false);
      } else if (state === "alive") {
        this.deathState.set(player.id, "dying");
        for (const root of roots) root.setEnabled(true);
        const current = this.activeClip.get(player.id);
        if (current) clipsByName?.get(current)?.stop();
        const deathClip = clipsByName?.get(CLIP_DEATH);
        if (deathClip) {
          this.activeClip.set(player.id, CLIP_DEATH);
          deathClip.onAnimationGroupEndObservable.addOnce(() => {
            this.deathState.set(player.id, "dead");
            for (const root of roots) root.setEnabled(false);
          });
          deathClip.start(false);
        } else {
          this.deathState.set(player.id, "dead");
          for (const root of roots) root.setEnabled(false);
        }
      }
      // "dying": let the death clip play out untouched.
      return;
    }

    if (state !== "alive") {
      this.deathState.set(player.id, "alive");
      for (const root of roots) root.setEnabled(true);
    }
    if (!clipsByName) return;

    const prev = this.prevPos.get(player.id);
    if (prev && time <= prev.time) return; // paused/rewound; keep current clip

    const dt = prev ? time - prev.time : 0;
    const speed = prev && dt > 0 ? length(sub(player.pos, prev)) / dt : 0;
    this.prevPos.set(player.id, { x: player.pos.x, z: player.pos.z, time });

    const airborne = player.y > AIRBORNE_EPS;
    const moving = speed > MOVING_EPS;
    const desired = airborne
      ? CLIP_JUMP
      : moving
        ? player.sprintActive > 0 ? CLIP_RUNNING : CLIP_WALKING
        : CLIP_IDLE;

    if (this.activeClip.get(player.id) !== desired) {
      const current = this.activeClip.get(player.id);
      if (current) clipsByName.get(current)?.stop();
      clipsByName.get(desired)?.start(true);
      this.activeClip.set(player.id, desired);
    }
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
