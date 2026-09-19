import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveSpreadStack, Boss, Player } from "@shared/types";
import {
  createGroundCircle,
  createQuestionRing,
  disposeGroundCircle,
  QUESTION_RING_DEFAULT_Y,
  spreadMarkerMaterial,
  stackMarkerMaterial,
  updateQuestionRing,
  type GroundCircle,
  type QuestionRingMeshes,
} from "@effects/babylon";

// The fire "?" ring mirrors the inverse mechanic's ring: one ring per mechanic identifies it
// (fire colour), and two orbs encode real (dark blue) vs a lying "?" (reddish-orange + yellow "?").
const DEFAULT_RING_COLOR = "#f97316";

const HEAD_Y = 2.4;        // downward spread triangle floating over a player
const STACK_MARKER_Y = 2.6; // stack "ring with triangles in" flat disc, raised above the marked head
const AREA_Y = 0.02;

type Handle = {
  mech: ActiveSpreadStack;
  questionRing: QuestionRingMeshes;
  spread: Map<string, Mesh>;       // playerId -> downward head triangle
  stackMarkers: Map<string, Mesh>; // marked playerId (one per group) -> "ring with triangles in" disc
  spreadAreas: Map<string, GroundCircle>;
  stackAreas: Map<string, GroundCircle>;
};

export class SpreadStackLayer {
  private handles = new Map<string, Handle>();
  private headMat: StandardMaterial | null = null;
  private stackMarkerMat: StandardMaterial | null = null;

  constructor(private scene: Scene) {}

  sync(mechs: ActiveSpreadStack[], boss: Boss, players: Player[], time: number): void {
    const playerMap = new Map(players.map(p => [p.id, p]));
    const active = new Set(mechs.map(m => m.id));
    for (const [id, handle] of this.handles) {
      if (!active.has(id)) { this.disposeHandle(handle); this.handles.delete(id); }
    }

    for (const mech of mechs) {
      let handle = this.handles.get(mech.id);
      if (!handle) { handle = this.createHandle(mech); this.handles.set(mech.id, handle); }

      // Ring + orbs orbit the boss at this mechanic's authored height (fire above lightning).
      const y = mech.ringHeight ?? QUESTION_RING_DEFAULT_Y;
      updateQuestionRing(handle.questionRing, boss.pos.x, boss.pos.z, y, time);

      // Player markers only while the cast is unresolved; the shown mode decides which.
      const visible = !mech.resolved;
      const showSpread = visible && mech.shown === "spread";
      const showStack = visible && mech.shown === "stack";
      const paired = mech.spreadPlayerIds !== undefined;
      const spreadIds = !visible ? [] : paired
        ? (mech.inverted ? mech.markedPlayerIds : mech.spreadPlayerIds!)
        : showSpread ? players.map(player => player.id) : [];
      const stackIds = !visible ? [] : paired
        ? (mech.inverted ? mech.spreadPlayerIds! : mech.markedPlayerIds)
        : showStack ? mech.markedPlayerIds : [];
      this.syncSpreadMarkers(handle, spreadIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p && p.alive), playerMap);
      this.syncStackMarkers(handle, stackIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p && p.alive));
      this.syncAreas(handle.spreadAreas, spreadIds, playerMap, mech.spread.radius, "spread", mech.id);
      this.syncAreas(handle.stackAreas, stackIds, playerMap, mech.stack.radius, "stack", mech.id);
    }
  }

  private syncSpreadMarkers(handle: Handle, players: Player[], playerMap: Map<string, Player>): void {
    const want = new Set(players.filter(p => p.alive).map(p => p.id));
    for (const [id, head] of handle.spread) {
      if (!want.has(id)) { head.dispose(); handle.spread.delete(id); }
    }
    for (const id of want) {
      const player = playerMap.get(id)!;
      let head = handle.spread.get(id);
      if (!head) {
        head = CreatePlane(`ss-head-${handle.mech.id}-${id}`, { size: 1.1 }, this.scene);
        head.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
        head.isPickable = false;
        head.material = this.getHeadMaterial();
        handle.spread.set(id, head);
      }
      head.position.set(player.pos.x, HEAD_Y, player.pos.z);
    }
  }

  private syncStackMarkers(handle: Handle, marked: Player[]): void {
    const want = new Set(marked.map(p => p.id));
    for (const [id, mesh] of handle.stackMarkers) {
      if (!want.has(id)) { mesh.dispose(); handle.stackMarkers.delete(id); }
    }
    for (const player of marked) {
      let mesh = handle.stackMarkers.get(player.id);
      if (!mesh) {
        // A flat floor-style ring laid horizontally, raised up above the marked character's head.
        mesh = CreateDisc(`ss-stack-marker-${handle.mech.id}-${player.id}`, { radius: 2.1, tessellation: 48 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.isPickable = false;
        mesh.material = this.getStackMarkerMaterial();
        handle.stackMarkers.set(player.id, mesh);
      }
      mesh.position.set(player.pos.x, STACK_MARKER_Y, player.pos.z);
    }
  }

  private createHandle(mech: ActiveSpreadStack): Handle {
    const questionRing = createQuestionRing(this.scene, "ss", mech.id, mech.ringColor ?? DEFAULT_RING_COLOR, mech.inverted);
    return { mech, questionRing, spread: new Map(), stackMarkers: new Map(), spreadAreas: new Map(), stackAreas: new Map() };
  }

  private syncAreas(areas: Map<string, GroundCircle>, ids: string[], playerMap: Map<string, Player>, radius: number, kind: "spread" | "stack", mechanicId: string): void {
    const want = new Set(ids);
    for (const [id, circle] of areas) {
      if (!want.has(id)) { disposeGroundCircle(circle); areas.delete(id); }
    }
    for (const id of want) {
      const player = playerMap.get(id);
      if (!player) continue;
      let circle = areas.get(id);
      if (!circle) {
        const color = kind === "spread" ? new Color3(1, 0.25, 0.1) : new Color3(0.3, 0.7, 1);
        circle = createGroundCircle(this.scene, `ss-${kind}-area-${mechanicId}-${id}`, {
          radius,
          y: AREA_Y,
          color,
          emissive: color,
          alpha: 0.35,
        });
        areas.set(id, circle);
      }
      circle.mesh.position.set(player.pos.x, AREA_Y, player.pos.z);
    }
  }

  private getHeadMaterial(): StandardMaterial {
    this.headMat ??= spreadMarkerMaterial(this.scene, "ss-head");
    return this.headMat;
  }

  private getStackMarkerMaterial(): StandardMaterial {
    this.stackMarkerMat ??= stackMarkerMaterial(this.scene, "ss-stack-marker");
    return this.stackMarkerMat;
  }

  private disposeHandle(handle: Handle): void {
    for (const mesh of handle.questionRing.all) mesh.dispose();
    for (const mat of handle.questionRing.materials) { mat.diffuseTexture?.dispose(); mat.dispose(); }
    for (const head of handle.spread.values()) head.dispose();
    handle.spread.clear();
    for (const mesh of handle.stackMarkers.values()) mesh.dispose();
    handle.stackMarkers.clear();
    for (const circle of handle.spreadAreas.values()) disposeGroundCircle(circle);
    handle.spreadAreas.clear();
    for (const circle of handle.stackAreas.values()) disposeGroundCircle(circle);
    handle.stackAreas.clear();
  }

  dispose(): void {
    for (const handle of this.handles.values()) this.disposeHandle(handle);
    this.handles.clear();
    this.headMat?.diffuseTexture?.dispose(); this.headMat?.dispose(); this.headMat = null;
    this.stackMarkerMat?.diffuseTexture?.dispose(); this.stackMarkerMat?.dispose(); this.stackMarkerMat = null;
  }
}
