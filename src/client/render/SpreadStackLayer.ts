import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveSpreadStack, Boss, Player } from "@shared/types";
import { applyAlphaTest } from "./meshes/billboardMaterials";
import {
  createQuestionRing,
  QUESTION_RING_DEFAULT_Y,
  updateQuestionRing,
  type QuestionRingMeshes,
} from "./meshes/questionRingMeshes";

// The fire "?" ring mirrors the inverse mechanic's ring: one ring per mechanic identifies it
// (fire colour), and two orbs encode real (dark blue) vs a lying "?" (reddish-orange + yellow "?").
const DEFAULT_RING_COLOR = "#f97316";

const HEAD_Y = 2.4;        // downward spread triangle floating over a player
const STACK_MARKER_Y = 2.6; // stack "ring with triangles in" flat disc, raised above the marked head

type Handle = {
  mech: ActiveSpreadStack;
  questionRing: QuestionRingMeshes;
  spread: Map<string, Mesh>;       // playerId -> downward head triangle
  stackMarkers: Map<string, Mesh>; // marked playerId (one per group) -> "ring with triangles in" disc
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
      const showSpread = !mech.resolved && mech.shown === "spread";
      const showStack = !mech.resolved && mech.shown === "stack";
      this.syncSpreadMarkers(handle, showSpread ? players : [], playerMap);
      const marked = showStack
        ? mech.markedPlayerIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p && p.alive)
        : [];
      this.syncStackMarkers(handle, marked);
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
    return { mech, questionRing, spread: new Map(), stackMarkers: new Map() };
  }

  private getHeadMaterial(): StandardMaterial {
    if (this.headMat) return this.headMat;
    const tex = new DynamicTexture("ss-head-tex", { width: 256, height: 256 }, this.scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 256);
    // Downward-pointing triangle (apex at the bottom).
    ctx.fillStyle = "#ff7a1f";
    ctx.strokeStyle = "#ffd9a0";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(28, 40);
    ctx.lineTo(228, 40);
    ctx.lineTo(128, 220);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    tex.update();
    const mat = new StandardMaterial("ss-head-mat", this.scene);
    applyAlphaTest(mat, tex);
    this.headMat = mat;
    return mat;
  }

  private getStackMarkerMaterial(): StandardMaterial {
    if (this.stackMarkerMat) return this.stackMarkerMat;
    // An orange "ring with triangles pointing in", drawn as a billboard over the head.
    const tex = new DynamicTexture("ss-stack-marker-tex", { width: 256, height: 256 }, this.scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 256);
    const cx = 128, cy = 128, R = 118;
    ctx.strokeStyle = "#ffae42";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff7a1f";
    const n = 4, baseR = R - 6, tipR = R - 60, halfW = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const perp = a + Math.PI / 2;
      const tx = cx + Math.cos(a) * tipR, ty = cy + Math.sin(a) * tipR;
      const b1x = cx + Math.cos(a) * baseR + Math.cos(perp) * halfW;
      const b1y = cy + Math.sin(a) * baseR + Math.sin(perp) * halfW;
      const b2x = cx + Math.cos(a) * baseR - Math.cos(perp) * halfW;
      const b2y = cy + Math.sin(a) * baseR - Math.sin(perp) * halfW;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b1x, b1y);
      ctx.lineTo(b2x, b2y);
      ctx.closePath();
      ctx.fill();
    }
    tex.update();
    const mat = new StandardMaterial("ss-stack-marker-mat", this.scene);
    applyAlphaTest(mat, tex);
    this.stackMarkerMat = mat;
    return mat;
  }

  private disposeHandle(handle: Handle): void {
    for (const mesh of handle.questionRing.all) mesh.dispose();
    for (const mat of handle.questionRing.materials) { mat.diffuseTexture?.dispose(); mat.dispose(); }
    for (const head of handle.spread.values()) head.dispose();
    handle.spread.clear();
    for (const mesh of handle.stackMarkers.values()) mesh.dispose();
    handle.stackMarkers.clear();
  }

  dispose(): void {
    for (const handle of this.handles.values()) this.disposeHandle(handle);
    this.handles.clear();
    this.headMat?.diffuseTexture?.dispose(); this.headMat?.dispose(); this.headMat = null;
    this.stackMarkerMat?.diffuseTexture?.dispose(); this.stackMarkerMat?.dispose(); this.stackMarkerMat = null;
  }
}
