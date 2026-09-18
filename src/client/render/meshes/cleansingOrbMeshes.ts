import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import { STATIC_ROOT } from "../../staticBase";

const TEX = 256;
const C = TEX / 2;
const ORB_SIZE = 3;
const ORB_Y = 2;
const INDICATOR_SIZE = 2.6;
const INDICATOR_Y = 4.6;
const RUNE_FILL = 0.62; // rune's longer side as a fraction of the texture
export const CLEANSING_ORB_RUNE_URL = `${STATIC_ROOT}/model/raid/orb_centera.png`;

type Ctx = CanvasRenderingContext2D;

// Fixed-seed LCG so the mottled rings look the same every time.
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function spots(ctx: Ctx, seed: number, inner: number, outer: number, count: number, colors: string[]): void {
  const next = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = next() * Math.PI * 2;
    const r = inner + next() * (outer - inner);
    ctx.fillStyle = colors[Math.floor(next() * colors.length)]!;
    ctx.globalAlpha = 0.35 + next() * 0.5;
    ctx.beginPath();
    ctx.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, 2 + next() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Dark navy disc with a glowing blue rim; the rune image is drawn over it once loaded.
function drawOrb(ctx: Ctx): void {
  const disc = ctx.createRadialGradient(C, C, 0, C, C, C);
  disc.addColorStop(0, "#0b1f45");
  disc.addColorStop(0.62, "#081634");
  disc.addColorStop(0.76, "#1d5fc4");
  disc.addColorStop(0.84, "#8fd4ff");
  disc.addColorStop(0.9, "rgba(58,160,255,0.6)");
  disc.addColorStop(1, "rgba(58,160,255,0)");
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, TEX, TEX);
}

// The rune, scaled to fit inside the disc's dark face with a soft blue glow.
function drawRune(ctx: Ctx, image: HTMLImageElement): void {
  const scale = (TEX * RUNE_FILL) / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.shadowColor = "#5ab8ff";
  ctx.shadowBlur = 12;
  ctx.drawImage(image, C - w / 2, C - h / 2, w, h);
  ctx.shadowBlur = 0;
}

let runeImage: Promise<HTMLImageElement> | null = null;
function loadRune(): Promise<HTMLImageElement> {
  runeImage ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = CLEANSING_ORB_RUNE_URL;
  });
  return runeImage;
}

// Gold glowing ring with a mottled edge, a thin pale inner ring and a black center (circle AoE).
function drawCircleIndicator(ctx: Ctx): void {
  const g = ctx.createRadialGradient(C, C, 0, C, C, C);
  g.addColorStop(0, "rgba(10,6,2,0.9)");
  g.addColorStop(0.44, "rgba(20,10,4,0.9)");
  g.addColorStop(0.48, "#f7ecd6");
  g.addColorStop(0.52, "#3a1e08");
  g.addColorStop(0.62, "#d98612");
  g.addColorStop(0.74, "#ffd35a");
  g.addColorStop(0.84, "#ff9a1a");
  g.addColorStop(0.92, "rgba(255,150,30,0.45)");
  g.addColorStop(1, "rgba(255,150,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX, TEX);
  spots(ctx, 7, C * 0.56, C * 0.8, 70, ["#3a1a04", "#7a3a06", "#fff0a0"]);
}

// Dark red/black speckled ring with a red glowing outer edge and an open center (donut).
function drawDonutIndicator(ctx: Ctx): void {
  const g = ctx.createRadialGradient(C, C, 0, C, C, C);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.46, "rgba(0,0,0,0)");
  g.addColorStop(0.5, "rgba(120,10,20,0.9)");
  g.addColorStop(0.56, "#120306");
  g.addColorStop(0.78, "#1c0408");
  g.addColorStop(0.86, "#e0203a");
  g.addColorStop(0.92, "rgba(255,40,70,0.5)");
  g.addColorStop(1, "rgba(255,40,70,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX, TEX);
  spots(ctx, 13, C * 0.54, C * 0.8, 90, ["#ff3050", "#8a0c1c", "#000000"]);
}

function spritePlane(scene: Scene, name: string, size: number, y: number, draw: (ctx: Ctx) => void): { plane: Mesh; tex: DynamicTexture } {
  const tex = new DynamicTexture(`${name}-tex`, { width: TEX, height: TEX }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as Ctx;
  ctx.clearRect(0, 0, TEX, TEX);
  draw(ctx);
  tex.update();

  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;

  const plane = CreatePlane(name, { size }, scene);
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.position.y = y;
  return { plane, tex };
}

// Index Cleansing orb: a camera-facing rune orb with its AoE type (gold ring = circle, red ring =
// donut) floating above it. The root sits on the floor; the sprites' heights are baked in.
export function createCleansingOrb(scene: Scene, id: string, kind: "circle" | "donut"): TransformNode {
  const root = new TransformNode(`cleansing-orb-${id}`, scene);
  const orb = spritePlane(scene, `cleansing-orb-${id}-orb`, ORB_SIZE, ORB_Y, drawOrb);
  orb.plane.parent = root;
  spritePlane(scene, `cleansing-orb-${id}-kind`, INDICATOR_SIZE, INDICATOR_Y, kind === "donut" ? drawDonutIndicator : drawCircleIndicator).plane.parent = root;
  void loadRune().then(image => {
    if (orb.plane.isDisposed()) return;
    drawRune(orb.tex.getContext() as unknown as Ctx, image);
    orb.tex.update();
  }, () => {});
  return root;
}
