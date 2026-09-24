import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { applyAlphaTest } from "./billboards";

const TEXTURE_SIZE = 128;
const SPIKE_PX = 12;
const SPIKE_BASE_PX = 12;
const EDGE_PX = 4;
const PIE_RADIUS_PX = TEXTURE_SIZE / 2 - EDGE_PX - SPIKE_PX;
const PIE_COLOR = "#ff9a1f";
const PIE_ROTATION_DEG = 10;

export const COUNTDOWN_PIE_PLANE_RATIO = (TEXTURE_SIZE / 2 - EDGE_PX) / PIE_RADIUS_PX;

export type CountdownPie = {
  plane: Mesh;
  draw(left: number, slices: number): void;
  dispose(): void;
};

export function createCountdownPie(scene: Scene, name: string, size: number): CountdownPie {
  const texture = new DynamicTexture(`${name}-tex`, { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
  texture.hasAlpha = true;
  const material = new StandardMaterial(`${name}-mat`, scene);
  applyAlphaTest(material, texture);
  const plane = CreatePlane(name, { size }, scene);
  plane.material = material;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.setEnabled(false);

  let drawn = "";
  const draw = (left: number, slices: number) => {
    if (`${left}/${slices}` === drawn) return;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const c = TEXTURE_SIZE / 2;
    const outer = PIE_RADIUS_PX;
    const step = (Math.PI * 2) / slices;
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
    ctx.beginPath();
    ctx.arc(c, c, outer * 0.3, 0, Math.PI * 2);
    ctx.fill();
    texture.update();
    drawn = `${left}/${slices}`;
  };

  return {
    plane,
    draw,
    dispose: () => {
      plane.dispose(false, true);
      texture.dispose();
    },
  };
}
