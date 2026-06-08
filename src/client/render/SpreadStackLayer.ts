import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveSpreadStack, Boss, Player } from "../../shared/types";

// The fire "?" ring mirrors the inverse mechanic's ring: one ring per mechanic identifies it
// (fire colour), and two orbs encode real (dark blue) vs a lying "?" (reddish-orange + yellow "?").
const RING_RADIUS = 6;
const RING_THICKNESS = 0.5;
const ORBS_PER_RING = 2;
const ORB_SIZE = 2.6;
const DEFAULT_RING_Y = 2;
const DEFAULT_RING_COLOR = "#f97316";
const REAL_ORB = "#1e3a8f";
const FAKE_ORB = "#ff5a1f";
const QUESTION = "#ffdd33";

const HEAD_Y = 3.2;     // downward spread triangle floating over each player
const GROUND_Y = 0.02;  // reticle / stack circle just above the floor
const STACK_ICON = "❖";

type SpreadMarker = { reticle: Mesh; head: Mesh };

type Handle = {
  mech: ActiveSpreadStack;
  ring: Mesh;
  orbs: Mesh[];
  ringMats: StandardMaterial[];
  spread: Map<string, SpreadMarker>; // playerId -> per-player spread markers
  stackIcon?: Mesh;
  stackCircle?: Mesh;
};

// Alpha-test billboard recipe (transparent DynamicTextures render a black square under alpha-blend).
function applyAlphaTest(mat: StandardMaterial, tex: DynamicTexture): void {
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.4;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
}

function orbTexture(scene: Scene, id: string, inverted: boolean): DynamicTexture {
  const tex = new DynamicTexture(id, { width: 128, height: 128 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = inverted ? FAKE_ORB : REAL_ORB;
  ctx.fill();
  if (inverted) {
    tex.drawText("?", null, 92, "bold 90px sans-serif", QUESTION, "", true, true);
  } else {
    tex.update();
  }
  return tex;
}

export class SpreadStackLayer {
  private handles = new Map<string, Handle>();
  private reticleMat: StandardMaterial | null = null;
  private headMat: StandardMaterial | null = null;
  private stackIconMat: StandardMaterial | null = null;

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
      const y = mech.ringHeight ?? DEFAULT_RING_Y;
      handle.ring.position.set(boss.pos.x, y, boss.pos.z);
      const spin = time * 0.7;
      for (let i = 0; i < handle.orbs.length; i++) {
        const a = (i / handle.orbs.length) * Math.PI * 2 + spin;
        handle.orbs[i].position.set(boss.pos.x + Math.cos(a) * RING_RADIUS, y, boss.pos.z + Math.sin(a) * RING_RADIUS);
      }

      // Player markers only while the cast is unresolved; the shown mode decides which.
      const showSpread = !mech.resolved && mech.shown === "spread";
      const showStack = !mech.resolved && mech.shown === "stack";
      this.syncSpreadMarkers(handle, showSpread ? players : [], playerMap);
      this.syncStackMarker(handle, showStack ? (playerMap.get(mech.markedPlayerId) ?? null) : null, mech.stack.radius);
    }
  }

  private syncSpreadMarkers(handle: Handle, players: Player[], playerMap: Map<string, Player>): void {
    const want = new Set(players.filter(p => p.alive).map(p => p.id));
    for (const [id, marker] of handle.spread) {
      if (!want.has(id)) { marker.reticle.dispose(); marker.head.dispose(); handle.spread.delete(id); }
    }
    for (const id of want) {
      const player = playerMap.get(id)!;
      let marker = handle.spread.get(id);
      if (!marker) {
        const reticle = CreateDisc(`ss-reticle-${handle.mech.id}-${id}`, { radius: handle.mech.spread.radius, tessellation: 48 }, this.scene);
        reticle.rotation.x = Math.PI / 2;
        reticle.isPickable = false;
        reticle.material = this.getReticleMaterial();
        const head = CreatePlane(`ss-head-${handle.mech.id}-${id}`, { size: 1.1 }, this.scene);
        head.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
        head.isPickable = false;
        head.material = this.getHeadMaterial();
        marker = { reticle, head };
        handle.spread.set(id, marker);
      }
      marker.reticle.position.set(player.pos.x, GROUND_Y, player.pos.z);
      marker.head.position.set(player.pos.x, HEAD_Y, player.pos.z);
    }
  }

  private syncStackMarker(handle: Handle, marked: Player | null, radius: number): void {
    if (!marked) {
      handle.stackIcon?.dispose(); handle.stackIcon = undefined;
      handle.stackCircle?.dispose(); handle.stackCircle = undefined;
      return;
    }
    if (!handle.stackIcon) {
      handle.stackIcon = CreatePlane(`ss-stack-icon-${handle.mech.id}`, { size: 1.3 }, this.scene);
      handle.stackIcon.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
      handle.stackIcon.isPickable = false;
      handle.stackIcon.material = this.getStackIconMaterial();
    }
    if (!handle.stackCircle) {
      handle.stackCircle = CreateDisc(`ss-stack-circle-${handle.mech.id}`, { radius, tessellation: 64 }, this.scene);
      handle.stackCircle.rotation.x = Math.PI / 2;
      handle.stackCircle.isPickable = false;
      const mat = new StandardMaterial(`ss-stack-circle-mat-${handle.mech.id}`, this.scene);
      mat.diffuseColor = new Color3(0.3, 0.7, 1.0); // blue = "stack here"
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.5;
      mat.backFaceCulling = false;
      handle.stackCircle.material = mat;
    }
    handle.stackIcon.position.set(marked.pos.x, HEAD_Y, marked.pos.z);
    handle.stackCircle.position.set(marked.pos.x, GROUND_Y, marked.pos.z);
  }

  private createHandle(mech: ActiveSpreadStack): Handle {
    const ringMats: StandardMaterial[] = [];
    const ring = CreateTorus(`ss-ring-${mech.id}`, { diameter: RING_RADIUS * 2, thickness: RING_THICKNESS, tessellation: 48 }, this.scene);
    ring.isPickable = false;
    const ringColor = Color3.FromHexString(mech.ringColor ?? DEFAULT_RING_COLOR);
    const ringMat = new StandardMaterial(`ss-ring-mat-${mech.id}`, this.scene);
    ringMat.diffuseColor = ringColor;
    ringMat.emissiveColor = ringColor;
    ringMat.specularColor = new Color3(0, 0, 0);
    ringMat.disableLighting = true;
    ring.material = ringMat;
    ringMats.push(ringMat);

    const orbs: Mesh[] = [];
    for (let i = 0; i < ORBS_PER_RING; i++) {
      const orb = CreatePlane(`ss-orb-${mech.id}-${i}`, { size: ORB_SIZE }, this.scene);
      orb.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
      orb.isPickable = false;
      const tex = orbTexture(this.scene, `ss-orb-tex-${mech.id}-${i}`, mech.inverted);
      const mat = new StandardMaterial(`ss-orb-mat-${mech.id}-${i}`, this.scene);
      applyAlphaTest(mat, tex);
      orb.material = mat;
      orbs.push(orb);
      ringMats.push(mat);
    }

    return { mech, ring, orbs, ringMats, spread: new Map() };
  }

  private getReticleMaterial(): StandardMaterial {
    if (this.reticleMat) return this.reticleMat;
    const tex = new DynamicTexture("ss-reticle-tex", { width: 256, height: 256 }, this.scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 256);
    const cx = 128, cy = 128, R = 118;
    ctx.strokeStyle = "#ffae42";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // Four triangles inside the ring, tips pointing toward the center (the "circle with triangles in").
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
    const mat = new StandardMaterial("ss-reticle-mat", this.scene);
    applyAlphaTest(mat, tex);
    mat.alpha = 0.85;
    this.reticleMat = mat;
    return mat;
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

  private getStackIconMaterial(): StandardMaterial {
    if (this.stackIconMat) return this.stackIconMat;
    const tex = new DynamicTexture("ss-stack-icon-tex", { width: 128, height: 128 }, this.scene, false);
    tex.hasAlpha = true;
    tex.drawText(STACK_ICON, null, 96, "bold 96px sans-serif", "#66ccff", "transparent", true, true);
    const mat = new StandardMaterial("ss-stack-icon-mat", this.scene);
    applyAlphaTest(mat, tex);
    this.stackIconMat = mat;
    return mat;
  }

  private disposeHandle(handle: Handle): void {
    handle.ring.dispose();
    for (const orb of handle.orbs) orb.dispose();
    for (const mat of handle.ringMats) { mat.diffuseTexture?.dispose(); mat.dispose(); }
    for (const marker of handle.spread.values()) { marker.reticle.dispose(); marker.head.dispose(); }
    handle.spread.clear();
    handle.stackIcon?.dispose();
    handle.stackCircle?.dispose();
  }

  dispose(): void {
    for (const handle of this.handles.values()) this.disposeHandle(handle);
    this.handles.clear();
    this.reticleMat?.diffuseTexture?.dispose(); this.reticleMat?.dispose(); this.reticleMat = null;
    this.headMat?.diffuseTexture?.dispose(); this.headMat?.dispose(); this.headMat = null;
    this.stackIconMat?.diffuseTexture?.dispose(); this.stackIconMat?.dispose(); this.stackIconMat = null;
  }
}
