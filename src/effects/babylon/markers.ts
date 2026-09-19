import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import { applyAlphaTest } from "./billboards";

const SIZE = 256;

function markerTexture(scene: Scene, name: string, draw: (ctx: CanvasRenderingContext2D) => void): StandardMaterial {
  const tex = new DynamicTexture(`${name}-tex`, { width: SIZE, height: SIZE }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, SIZE, SIZE);
  draw(ctx);
  tex.update();
  const mat = new StandardMaterial(`${name}-mat`, scene);
  applyAlphaTest(mat, tex);
  return mat;
}

// Downward-pointing triangle (apex at the bottom), worn over a spread target's head.
export function spreadMarkerMaterial(scene: Scene, name: string): StandardMaterial {
  return markerTexture(scene, name, ctx => {
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
  });
}

// Ring with four triangles pointing inward: the "stack on me" marker.
export function stackMarkerMaterial(scene: Scene, name: string): StandardMaterial {
  return markerTexture(scene, name, ctx => {
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
  });
}
