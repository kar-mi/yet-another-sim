import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "@shared/types";
import { countdownSlicesLeft } from "@shared/countdown";
import { applyAlphaTest } from "./meshes/billboardMaterials";

// Height above the player’s feet.
const PIE_BOTTOM = 2.3;
const PIE_SIZE = 2;
const TEXTURE_SIZE = 128;
// Reserve space for spikes without shrinking the pie.
const SPIKE_PX = 12;
const SPIKE_BASE_PX = 12;
const EDGE_PX = 4;
const PIE_RADIUS_PX = TEXTURE_SIZE / 2 - EDGE_PX - SPIKE_PX;
const PLANE_SIZE = PIE_SIZE * (TEXTURE_SIZE / 2 - EDGE_PX) / PIE_RADIUS_PX;
const PIE_COLOR = "#ff9a1f";
// Top boundary offset, clockwise from north.
const PIE_ROTATION_DEG = 10;

// Show the POV player’s countdown above their head.
export class CountdownPieLayer {
  private plane: Mesh;
  private texture: DynamicTexture;
  private drawn = "";

  constructor(scene: Scene) {
    this.texture = new DynamicTexture("countdown-pie-tex", { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
    this.texture.hasAlpha = true;
    const material = new StandardMaterial("countdown-pie-mat", scene);
    applyAlphaTest(material, this.texture);
    this.plane = CreatePlane("countdown-pie", { size: PLANE_SIZE }, scene);
    this.plane.material = material;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.setEnabled(false);
  }

  sync(pov: Player | undefined, time: number): void {
    const effect = pov?.alive
      ? pov.effects
        .filter(e => e.countdown && e.appliedAt + e.duration > time)
        .sort((a, b) => a.appliedAt + a.duration - (b.appliedAt + b.duration))[0]
      : undefined;
    const left = effect ? countdownSlicesLeft(effect, time) : 0;
    if (!pov || !effect || left === 0) {
      this.plane.setEnabled(false);
      return;
    }
    const slices = effect.countdown!.slices;
    if (`${left}/${slices}` !== this.drawn) this.draw(left, slices);
    this.plane.position.set(pov.pos.x, PIE_BOTTOM + PIE_SIZE / 2 + pov.y, pov.pos.z);
    this.plane.setEnabled(true);
  }

  private draw(left: number, slices: number): void {
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const c = TEXTURE_SIZE / 2;
    const outer = PIE_RADIUS_PX;
    const step = (Math.PI * 2) / slices;
    // Bearing clockwise from north -> canvas angle (0 = east, clockwise on screen).
    const angle = (k: number) => (PIE_ROTATION_DEG * Math.PI) / 180 + k * step - Math.PI / 2;

    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.fillStyle = PIE_COLOR;
    for (let k = slices - left; k < slices; k++) {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, outer, angle(k), angle(k + 1));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 4;
    for (let k = 0; k < slices; k++) {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(angle(k)) * outer, c + Math.sin(angle(k)) * outer);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c, c, outer, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    for (let k = 0; k < slices; k++) {
      const a = angle(k);
      const [dx, dy] = [Math.cos(a), Math.sin(a)];
      const half = SPIKE_BASE_PX / 2;
      ctx.beginPath();
      ctx.moveTo(c + dx * (outer - 1) - dy * half, c + dy * (outer - 1) + dx * half);
      ctx.lineTo(c + dx * (outer + SPIKE_PX), c + dy * (outer + SPIKE_PX));
      ctx.lineTo(c + dx * (outer - 1) + dy * half, c + dy * (outer - 1) - dx * half);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(c, c, outer * 0.3, 0, Math.PI * 2);
    ctx.fill();
    this.texture.update();
    this.drawn = `${left}/${slices}`;
  }

  dispose(): void {
    this.plane.dispose(false, true);
    this.texture.dispose();
  }
}
