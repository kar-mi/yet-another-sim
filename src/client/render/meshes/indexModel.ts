import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { logger } from "@shared/logger";
import { STATIC_ROOT } from "../../staticBase";
import { applyAlphaTest } from "./billboardMaterials";

// Extrude the Index’s body and weapons from their image silhouettes.
const INDEX_IMAGE_ROOT = `${STATIC_ROOT}/model/boss/index/`;

const BODY_HEIGHT = 8;
const BODY_DEPTH = 0.6;
// Image aspect ratios and hem positions, used to align the robe with the floor.
const FRONT = { aspect: 1024 / 834, hem: 740 / 834 };
const BACK = { aspect: 1024 / 838, hem: 772 / 838 };

// Weapon drawings share one pixel scale so their relative sizes match the source art.
const WEAPON_UNITS_PER_PX = 3.5 / 789;
const WEAPON_DEPTH = 0.3;
const WEAPON_HEIGHT_ABOVE_GROUND = 3;
// Place weapons ahead of the body’s front face (+Z).
const WEAPON_FORWARD = 1.5;
const OUTLINE_PX = 40;
const OUTLINE_COLOR = "#8fd14f"; // the implement aoe color in omni-elements-1.yaml
// Emissive above 1 brightens the outline past the aoe color without changing its hue.
const OUTLINE_BRIGHTNESS = 1.4;
// Pulse the highlighted weapon’s glow.
const GLOW_COLOR = new Color4(0.35, 1, 0.25, 1);
const GLOW_INTENSITY = { min: 0.9, max: 1.6 };
const GLOW_PULSE_SECONDS = 1.2;
// Translucent sphere of light around the highlighted weapon, sized from its longest side.
const HALO_COLOR = new Color3(0.55, 1, 0.4);
const HALO_SIZE = 1.5;
const HALO_ALPHA = { min: 0.45, max: 0.8 };

// Sample the silhouette every CELL_PX pixels.
const CELL_PX = 4;
const WALL_SHADE = { up: 0.9, side: 0.75, down: 0.55 };

// Weapon offsets in boss-local space (+X right, +Z forward).
const WEAPONS = [
  { name: "bow", width: 648, height: 789, x: 5.45 },
  { name: "bell", width: 266, height: 440, x: 3.05, scale: 1.5 },
  { name: "harp", width: 424, height: 789, x: -2.68 },
  { name: "sword", width: 341, height: 789, x: -4.65 },
] as const;

export type IndexWeapon = (typeof WEAPONS)[number]["name"];

export type IndexModel = {
  root: Mesh;
  height: number;
  // Call each frame to highlight and pulse one weapon; time is sim seconds.
  highlight(weapon: IndexWeapon | null, time: number): void;
  dispose(): void;
};

// One face of a slab: its art, size and center height in the slab's space.
type Face = { url: string; width: number; height: number; y: number };

// Built with its feet at y=0 of `root`; the caller places and scales the root.
export function buildIndexModel(scene: Scene, name: string): IndexModel {
  const root = new Mesh(`${name}-root`, scene);
  root.isPickable = false;

  const bodyFace = (file: string, art: { aspect: number; hem: number }): Face => ({
    url: `${INDEX_IMAGE_ROOT}${file}`,
    width: BODY_HEIGHT * art.aspect,
    height: BODY_HEIGHT,
    y: BODY_HEIGHT * (art.hem - 0.5),
  });
  slab(scene, `${name}-body`, bodyFace("front.png", FRONT), bodyFace("back.png", BACK), BODY_DEPTH).parent = root;

  const weaponNodes = new Map<IndexWeapon, Mesh>();
  const outlines = new Map<IndexWeapon, Mesh>();
  for (const weapon of WEAPONS) {
    const url = `${INDEX_IMAGE_ROOT}${weapon.name}.png`;
    const face: Face = { url, width: weapon.width * WEAPON_UNITS_PER_PX, height: weapon.height * WEAPON_UNITS_PER_PX, y: 0 };
    const node = slab(scene, `${name}-weapon-${weapon.name}`, face, null, WEAPON_DEPTH);
    node.position.set(weapon.x, WEAPON_HEIGHT_ABOVE_GROUND, WEAPON_FORWARD);
    if ("scale" in weapon) node.scaling.setAll(weapon.scale);
    node.parent = root;

    // The slab hides the outline except beyond its silhouette.
    const outline = CreatePlane(`${name}-weapon-${weapon.name}-outline`, {
      width: (weapon.width + 2 * OUTLINE_PX) * WEAPON_UNITS_PER_PX,
      height: (weapon.height + 2 * OUTLINE_PX) * WEAPON_UNITS_PER_PX,
    }, scene);
    outline.material = outlineMaterial(scene, `${name}-weapon-${weapon.name}-outline`, url, weapon.width, weapon.height);
    outline.rotation.y = Math.PI;
    outline.isPickable = false;
    outline.parent = node;
    outline.setEnabled(false);
    outlines.set(weapon.name, outline);
    weaponNodes.set(weapon.name, node);
  }

  // Parented to the root, not a weapon, so the glow layer (which takes the weapon's child meshes)
  // doesn't blur it into a solid blob.
  const halo = CreatePlane(`${name}-halo`, { size: 1 }, scene);
  halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
  halo.material = haloMaterial(scene, `${name}-halo`);
  halo.isPickable = false;
  halo.parent = root;
  halo.setEnabled(false);
  halo.material.forceCompilation(halo);

  // Disable an empty glow layer: an empty include list would glow everything.
  const glow = new GlowLayer(`${name}-glow`, scene, { blurKernelSize: 96 });
  glow.customEmissiveColorSelector = (_mesh, _subMesh, _material, result) => result.copyFrom(GLOW_COLOR);
  glow.isEnabled = false;
  let glowing: Mesh[] = [];
  let glowWeapon: IndexWeapon | null = null;
  // Compile each weapon mesh's glow shaders once its art has loaded, so the first highlight doesn't
  // stall on a synchronous compile.
  const glowWarmed = new Set<AbstractMesh>();
  const warmGlow = () => {
    if (glowWarmed.size === 0) glow.isLayerReady(); // creates the merge effect
    for (const node of weaponNodes.values()) {
      for (const mesh of node.getChildMeshes()) {
        if (glowWarmed.has(mesh) || !mesh.material || !mesh.subMeshes) continue;
        glowWarmed.add(mesh);
        for (const subMesh of mesh.subMeshes) glow.isReady(subMesh, false);
      }
    }
  };

  const highlight = (weapon: IndexWeapon | null, time: number) => {
    if (!weapon) warmGlow();
    for (const [name, outline] of outlines) outline.setEnabled(name === weapon);
    // Refresh as the weapon art loads.
    const meshes = weapon ? weaponNodes.get(weapon)!.getChildMeshes() : [];
    if (weapon !== glowWeapon || meshes.length !== glowing.length) {
      for (const mesh of glowing) glow.removeIncludedOnlyMesh(mesh);
      for (const mesh of meshes) glow.addIncludedOnlyMesh(mesh as Mesh);
      glowing = meshes as Mesh[];
      glowWeapon = weapon;
    }
    glow.isEnabled = weapon !== null;
    halo.setEnabled(weapon !== null);
    if (weapon) {
      const pulse = (1 - Math.cos((time / GLOW_PULSE_SECONDS) * Math.PI * 2)) / 2;
      glow.intensity = GLOW_INTENSITY.min + (GLOW_INTENSITY.max - GLOW_INTENSITY.min) * pulse;
      const spec = WEAPONS.find(w => w.name === weapon)!;
      const node = weaponNodes.get(weapon)!;
      halo.position.copyFrom(node.position);
      halo.scaling.setAll(Math.max(spec.width, spec.height) * WEAPON_UNITS_PER_PX * node.scaling.x * HALO_SIZE);
      halo.material!.alpha = HALO_ALPHA.min + (HALO_ALPHA.max - HALO_ALPHA.min) * pulse;
    }
  };

  return { root, height: BODY_HEIGHT, highlight, dispose: () => {
    glow.dispose();
    root.dispose(false, true);
  } };
}

// Faces point along ±Z; a missing back uses mirrored front art. Load meshes asynchronously.
function slab(scene: Scene, name: string, front: Face, back: Face | null, depth: number): Mesh {
  const node = new Mesh(name, scene);
  node.isPickable = false;
  void Promise.all([loadImage(front.url), back ? loadImage(back.url) : null]).then(([frontImage, backImage]) => {
    if (!node.isDisposed()) buildSlab(scene, node, front, frontImage, back && backImage ? { face: back, image: backImage } : null, depth);
  }, err => logger.warn("render", "failed to load Index art", { name, err }));
  return node;
}

function buildSlab(
  scene: Scene,
  node: Mesh,
  front: Face,
  frontImage: HTMLImageElement,
  back: { face: Face; image: HTMLImageElement } | null,
  depth: number,
): void {
  const w = frontImage.width;
  const h = frontImage.height;
  const alpha = canvasOf(frontImage).getContext("2d")!.getImageData(0, 0, w, h).data;
  const frontArt = bleed(frontImage);
  const color = frontArt.getContext("2d")!.getImageData(0, 0, w, h).data;

  const cols = Math.ceil(w / CELL_PX);
  const rows = Math.ceil(h / CELL_PX);
  const sample = (c: number, r: number) =>
    (Math.min(r * CELL_PX + CELL_PX / 2, h - 1) * w + Math.min(c * CELL_PX + CELL_PX / 2, w - 1)) * 4;
  const solid = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && alpha[sample(c, r) + 3]! > 102;

  // The front face is turned to +Z, so the art's left edge sits at +X.
  const toX = (px: number) => (0.5 - Math.min(px, w) / w) * front.width;
  const toY = (py: number) => front.y + (0.5 - Math.min(py, h) / h) * front.height;
  const frontUV = (x: number, y: number) => [0.5 - x / front.width, 0.5 + (y - front.y) / front.height];
  const backUV = back
    ? (x: number, y: number) => [0.5 + x / back.face.width, 0.5 + (y - back.face.y) / back.face.height]
    : frontUV;

  // Faces: one quad per horizontal run of solid cells, at both ends of the slab.
  const frontQuads = new QuadBuilder();
  const backQuads = new QuadBuilder();
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!solid(c, r)) { c++; continue; }
      const start = c;
      while (c < cols && solid(c, r)) c++;
      const x0 = toX(start * CELL_PX), x1 = toX(c * CELL_PX);
      const y0 = toY(r * CELL_PX), y1 = toY((r + 1) * CELL_PX);
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const;
      frontQuads.add(corners.map(([x, y]) => [x, y, depth / 2]), corners.map(([x, y]) => frontUV(x, y)));
      backQuads.add(corners.map(([x, y]) => [x, y, -depth / 2]), corners.map(([x, y]) => backUV(x, y)));
    }
  }

  // Walls: a quad on every cell edge that borders empty space, colored from the art at that cell.
  const walls = new QuadBuilder();
  const edges = [
    { dc: -1, dr: 0, shade: WALL_SHADE.side, a: [0, 0], b: [0, 1] },
    { dc: 1, dr: 0, shade: WALL_SHADE.side, a: [1, 0], b: [1, 1] },
    { dc: 0, dr: -1, shade: WALL_SHADE.up, a: [0, 0], b: [1, 0] },
    { dc: 0, dr: 1, shade: WALL_SHADE.down, a: [0, 1], b: [1, 1] },
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid(c, r)) continue;
      const i = sample(c, r);
      for (const edge of edges) {
        if (solid(c + edge.dc, r + edge.dr)) continue;
        const x0 = toX((c + edge.a[0]!) * CELL_PX), y0 = toY((r + edge.a[1]!) * CELL_PX);
        const x1 = toX((c + edge.b[0]!) * CELL_PX), y1 = toY((r + edge.b[1]!) * CELL_PX);
        const rgba = [color[i]! / 255 * edge.shade, color[i + 1]! / 255 * edge.shade, color[i + 2]! / 255 * edge.shade, 1];
        walls.add([[x0, y0, depth / 2], [x1, y1, depth / 2], [x1, y1, -depth / 2], [x0, y0, -depth / 2]], undefined, rgba);
      }
    }
  }

  const name = node.name;
  const frontMat = unlitMaterial(scene, `${name}-front-mat`, frontArt);
  const backMat = back ? unlitMaterial(scene, `${name}-back-mat`, backCanvas(frontArt, front, back.image, back.face)) : frontMat;
  frontQuads.mesh(scene, `${name}-front`, frontMat, node);
  backQuads.mesh(scene, `${name}-back`, backMat, node);
  walls.mesh(scene, `${name}-walls`, unlitMaterial(scene, `${name}-walls-mat`, null), node);
}

class QuadBuilder {
  private positions: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  add(corners: readonly (readonly number[])[], uvs?: readonly number[][], rgba?: number[]): void {
    const base = this.positions.length / 3;
    for (let k = 0; k < 4; k++) {
      this.positions.push(...corners[k]!);
      if (uvs) this.uvs.push(...uvs[k]!);
      if (rgba) this.colors.push(...rgba);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  mesh(scene: Scene, name: string, material: StandardMaterial, parent: Mesh): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    if (this.uvs.length > 0) data.uvs = this.uvs;
    if (this.colors.length > 0) data.colors = this.colors;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.parent = parent;
    return mesh;
  }
}

// Flat-colored: shows the texture (or vertex colors when there is none) without lighting.
function unlitMaterial(scene: Scene, name: string, art: HTMLCanvasElement | null): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  if (art) {
    const tex = new DynamicTexture(`${name}-tex`, art, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    tex.update();
    mat.diffuseTexture = tex;
  } else {
    mat.diffuseColor = new Color3(0, 0, 0);
  }
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  return mat;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasOf(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}

// Extend edge colors by one cell to prevent black texels along the silhouette.
function bleed(image: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  for (let step = CELL_PX; step > 0; step--) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.drawImage(image, Math.round(Math.cos(angle) * step), Math.round(Math.sin(angle) * step));
    }
  }
  ctx.drawImage(image, 0, 0);
  return canvas;
}

// Fill gaps in the back silhouette with mirrored front art.
function backCanvas(frontArt: HTMLCanvasElement, front: Face, backImage: HTMLImageElement, back: Face): HTMLCanvasElement {
  const wb = backImage.width, hb = backImage.height;
  const canvas = document.createElement("canvas");
  canvas.width = wb;
  canvas.height = hb;
  const ctx = canvas.getContext("2d")!;
  // Map front pixels to back pixels, reversing x.
  const sx = (wb * front.width) / (frontArt.width * back.width);
  const sy = (hb * front.height) / (frontArt.height * back.height);
  ctx.setTransform(-sx, 0, 0, sy, wb * (0.5 + (0.5 * front.width) / back.width), hb * (0.5 - (front.y - back.y) / back.height - (0.5 * front.height) / back.height));
  ctx.drawImage(frontArt, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bleed(backImage), 0, 0);
  return canvas;
}

// A solid silhouette of the drawing grown by OUTLINE_PX.
function outlineMaterial(scene: Scene, name: string, url: string, width: number, height: number): StandardMaterial {
  const tex = new DynamicTexture(name, { width: width + 2 * OUTLINE_PX, height: height + 2 * OUTLINE_PX }, scene, false);
  tex.hasAlpha = true;
  void loadImage(url).then(image => {
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    if (!ctx) return; // The model may have been disposed while the image loaded.
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.drawImage(image, OUTLINE_PX + Math.cos(angle) * OUTLINE_PX, OUTLINE_PX + Math.sin(angle) * OUTLINE_PX);
    }
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = OUTLINE_COLOR;
    ctx.fillRect(0, 0, width + 2 * OUTLINE_PX, height + 2 * OUTLINE_PX);
    ctx.globalCompositeOperation = "source-over";
    tex.update();
  });

  const mat = new StandardMaterial(`${name}-mat`, scene);
  applyAlphaTest(mat, tex);
  mat.emissiveColor = new Color3(OUTLINE_BRIGHTNESS, OUTLINE_BRIGHTNESS, OUTLINE_BRIGHTNESS);
  return mat;
}

// A soft sphere: faint in the middle so the weapon shows through, brightest toward the rim.
function haloMaterial(scene: Scene, name: string): StandardMaterial {
  const tex = new DynamicTexture(`${name}-tex`, { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.2)");
  g.addColorStop(0.6, "rgba(255,255,255,0.6)");
  g.addColorStop(0.8, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.hasAlpha = true;
  tex.update();

  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = HALO_COLOR;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.disableDepthWrite = true;
  // The camera-facing plane cuts through the weapon slab; depth testing would clip it along a seam.
  mat.depthFunction = Constants.ALWAYS;
  mat.backFaceCulling = false;
  mat.alphaMode = Constants.ALPHA_ADD;
  return mat;
}
