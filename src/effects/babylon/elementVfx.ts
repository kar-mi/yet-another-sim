import type { Scene } from "@babylonjs/core/scene";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { AOEShape, ElementGlyphKind } from "../index";

// Element-themed floor telegraphs: an animated world-space noise shader (frost / crackle / flame)
// shared per (element, color, alpha), and a one-shot particle burst when an element AoE lands.
// Render-only; the sim never sees any of this.

const MODE: Record<ElementGlyphKind, number> = { ice: 0, lightning: 1, fire: 2 };

Effect.ShadersStore["elementFloorVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vXZ;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore["elementFloorFragmentShader"] = `
precision highp float;
varying vec2 vXZ;
uniform float time;
uniform float mode;
uniform vec3 color;
uniform float alpha;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void main() {
  vec3 tint;
  float glow;
  if (mode < 0.5) {
    // Ice: slow drifting frost with sparkles.
    float frost = smoothstep(0.45, 0.75, fbm(vXZ * 0.35 + vec2(time * 0.05, time * 0.03)));
    float sparkle = step(0.985, hash(floor(vXZ * 4.0) + floor(time * 3.0)));
    glow = 0.55 + 0.6 * frost + sparkle;
    tint = mix(color, vec3(1.0), 0.35 * frost + sparkle);
  } else if (mode < 1.5) {
    // Lightning: thin veins that crawl and flicker.
    float vein = 1.0 - smoothstep(0.0, 0.04, abs(fbm(vXZ * 0.4 + vec2(0.0, time * 0.8)) - 0.5));
    float flicker = 0.6 + 0.4 * step(0.5, hash(vec2(floor(time * 12.0), 1.0)));
    glow = 0.45 + 1.6 * vein * flicker;
    tint = mix(color, vec3(1.0), 0.6 * vein);
  } else {
    // Fire: two scrolling turbulence layers.
    float f = fbm(vXZ * 0.3 - vec2(0.0, time * 0.9)) * fbm(vXZ * 0.6 - vec2(time * 0.4, time * 1.3)) * 2.2;
    glow = 0.4 + 1.4 * f;
    tint = mix(color, vec3(1.0, 0.85, 0.3), smoothstep(0.35, 0.7, f));
  }
  gl_FragColor = vec4(tint * glow, alpha * clamp(glow, 0.4, 1.0));
}`;

type ElementVfxState = { materials: Map<string, ShaderMaterial>; dot?: DynamicTexture };
const states = new WeakMap<Scene, ElementVfxState>();

function stateFor(scene: Scene): ElementVfxState {
  let state = states.get(scene);
  if (!state) {
    const s: ElementVfxState = { materials: new Map() };
    // Wall-clock so the pattern animates smoothly at render rate and keeps moving while paused.
    scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const mat of s.materials.values()) mat.setFloat("time", t);
    });
    states.set(scene, s);
    state = s;
  }
  return state;
}

// Uncached; every instance shares one compiled effect since the element is a uniform, not a define.
export function createElementFloorMaterial(scene: Scene, name: string): ShaderMaterial {
  const mat = new ShaderMaterial(name, scene, "elementFloor", {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "time", "mode", "color", "alpha"],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false;
  return mat;
}

// Shared across every AoE with the same element/color/alpha; callers must not dispose it.
export function elementFloorMaterial(scene: Scene, kind: ElementGlyphKind, color: string, alpha: number): ShaderMaterial {
  const { materials } = stateFor(scene);
  const key = `${kind}|${color}|${alpha}`;
  let mat = materials.get(key);
  if (!mat) {
    mat = createElementFloorMaterial(scene, `element-floor-${key}`);
    mat.setFloat("mode", MODE[kind]);
    mat.setColor3("color", Color3.FromHexString(color));
    mat.setFloat("alpha", alpha);
    mat.setFloat("time", performance.now() / 1000);
    materials.set(key, mat);
  }
  return mat;
}

function dotTexture(scene: Scene): DynamicTexture {
  const state = stateFor(scene);
  if (!state.dot) {
    const tex = new DynamicTexture("element-burst-dot", { width: 32, height: 32 }, scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    tex.hasAlpha = true;
    tex.update();
    state.dot = tex;
  }
  return state.dot;
}

// Center and half-extents of the footprint the burst spawns over; null for shapes we don't burst.
function burstArea(shape: AOEShape): { x: number; z: number; ex: number; ez: number } | null {
  if (shape.kind === "circle") return { x: shape.center.x, z: shape.center.z, ex: shape.radius * 0.7, ez: shape.radius * 0.7 };
  if (shape.kind === "polygon") {
    const xs = shape.vertices.map(v => v.x), zs = shape.vertices.map(v => v.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, ex: (maxX - minX) / 3, ez: (maxZ - minZ) / 3 };
  }
  return null;
}

export function spawnElementBurst(scene: Scene, kind: ElementGlyphKind, shape: AOEShape, color: string): void {
  const area = burstArea(shape);
  if (!area) return;
  const base = Color3.FromHexString(color);
  const ps = new ParticleSystem(`element-burst-${kind}`, 120, scene);
  ps.particleTexture = dotTexture(scene);
  ps.emitter = new Vector3(area.x, 0.1, area.z);
  ps.minEmitBox = new Vector3(-area.ex, 0, -area.ez);
  ps.maxEmitBox = new Vector3(area.ex, 0, area.ez);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.color2 = new Color4(base.r, base.g, base.b, 1);
  ps.colorDead = new Color4(base.r, base.g, base.b, 0);
  ps.targetStopDuration = 0.1;
  // Not disposeOnStop: that frees particleTexture, which is the shared dot. Defer past the frame
  // because this fires mid-animate while the scene is iterating its particle systems.
  ps.onAnimationEnd = () => scene.onAfterRenderObservable.addOnce(() => ps.dispose(false));
  if (kind === "ice") {
    ps.manualEmitCount = 90;
    ps.color1 = new Color4(0.9, 0.97, 1, 1);
    ps.direction1 = new Vector3(-1, 2, -1);
    ps.direction2 = new Vector3(1, 3, 1);
    ps.gravity = new Vector3(0, -6, 0);
    ps.minEmitPower = 1.5; ps.maxEmitPower = 3;
    ps.minLifeTime = 0.2; ps.maxLifeTime = 0.35;
    ps.minSize = 0.2; ps.maxSize = 0.45;
  } else if (kind === "lightning") {
    ps.manualEmitCount = 110;
    ps.color1 = new Color4(1, 1, 1, 1);
    ps.direction1 = new Vector3(-1, 0.3, -1);
    ps.direction2 = new Vector3(1, 1.5, 1);
    ps.minEmitPower = 6; ps.maxEmitPower = 10;
    ps.minLifeTime = 0.08; ps.maxLifeTime = 0.18;
    ps.minSize = 0.1; ps.maxSize = 0.25;
  } else {
    ps.manualEmitCount = 100;
    ps.color1 = new Color4(1, 0.8, 0.3, 1);
    ps.direction1 = new Vector3(-0.3, 1, -0.3);
    ps.direction2 = new Vector3(0.3, 1, 0.3);
    ps.gravity = new Vector3(0, 2, 0);
    ps.minEmitPower = 2; ps.maxEmitPower = 4;
    ps.minLifeTime = 0.2; ps.maxLifeTime = 0.4;
    ps.minSize = 0.3; ps.maxSize = 0.6;
  }
  ps.start();
}

// Render one invisible particle during load so the particle shader compiles before the first burst.
export function prewarmElementBurst(scene: Scene): void {
  const ps = new ParticleSystem("__prewarm_element_burst", 1, scene);
  ps.particleTexture = dotTexture(scene);
  ps.emitter = new Vector3(0, -100, 0);
  ps.manualEmitCount = 1;
  ps.start();
  scene.onAfterRenderObservable.addOnce(() => ps.dispose(false));
}
