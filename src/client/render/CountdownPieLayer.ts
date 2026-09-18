import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "@shared/types";
import { countdownSlicesLeft } from "@shared/countdown";
import { applyAlphaTest } from "./meshes/billboardMaterials";

// The pie's bottom edge sits this high above the player's feet, just over the head.
const PIE_BOTTOM = 2.3;
const PIE_SIZE = 2;
const TEXTURE_SIZE = 128;
const PIE_COLOR = "#ff9a1f";
// The top slice boundary sits this far clockwise of north.
const PIE_ROTATION_DEG = 10;
// Slice k spans clockwise from boundary k to k + 1. The slice just clockwise of the top boundary
// empties first, then the rest empty going clockwise around the pie.
const DRAIN_ORDER = [0, 1, 2, 3, 4];

// Draws the POV player's own countdown pie above their head (see EffectCountdown). Nobody else's
// pie is drawn.
export class CountdownPieLayer {
  private plane: Mesh;
  private texture: DynamicTexture;
  private drawn = -1;

  constructor(scene: Scene) {
    this.texture = new DynamicTexture("countdown-pie-tex", { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
    this.texture.hasAlpha = true;
    const material = new StandardMaterial("countdown-pie-mat", scene);
    applyAlphaTest(material, this.texture);
    this.plane = CreatePlane("countdown-pie", { size: PIE_SIZE }, scene);
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
    if (left !== this.drawn) this.draw(left, effect.countdown!.slices);
    this.plane.position.set(pov.pos.x, PIE_BOTTOM + PIE_SIZE / 2 + pov.y, pov.pos.z);
    this.plane.setEnabled(true);
  }

  private draw(left: number, slices: number): void {
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const c = TEXTURE_SIZE / 2;
    const outer = c - 4;
    const step = (Math.PI * 2) / slices;
    // Bearing clockwise from north -> canvas angle (0 = east, clockwise on screen).
    const angle = (k: number) => (PIE_ROTATION_DEG * Math.PI) / 180 + k * step - Math.PI / 2;
    const order = slices === DRAIN_ORDER.length ? DRAIN_ORDER : Array.from({ length: slices }, (_, i) => i);
    const gone = new Set(order.slice(0, slices - left));

    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.fillStyle = PIE_COLOR;
    for (let k = 0; k < slices; k++) {
      if (gone.has(k)) continue;
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
    ctx.beginPath();
    ctx.arc(c, c, outer * 0.3, 0, Math.PI * 2);
    ctx.fill();
    this.texture.update();
    this.drawn = left;
  }

  dispose(): void {
    this.plane.dispose(false, true);
    this.texture.dispose();
  }
}
