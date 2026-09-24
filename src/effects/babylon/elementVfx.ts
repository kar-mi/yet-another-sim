import type { Scene } from "@babylonjs/core/scene";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { AOEShape, BurstVfx, ElementGlyphKind } from "../index";
import { sampleShapePoint } from "../sampling";

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
    float frost = smoothstep(0.45, 0.75, fbm(vXZ * 0.35 + vec2(time * 0.05, time * 0.03)));
    float sparkle = step(0.985, hash(floor(vXZ * 4.0) + floor(time * 3.0)));
    glow = 0.55 + 0.6 * frost + sparkle;
    tint = mix(color, vec3(1.0), 0.35 * frost + sparkle);
  } else if (mode < 1.5) {
    float vein = 1.0 - smoothstep(0.0, 0.04, abs(fbm(vXZ * 0.4 + vec2(0.0, time * 0.8)) - 0.5));
    float flicker = 0.6 + 0.4 * step(0.5, hash(vec2(floor(time * 12.0), 1.0)));
    glow = 0.45 + 1.6 * vein * flicker;
    tint = mix(color, vec3(1.0), 0.6 * vein);
  } else {
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
    scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const mat of s.materials.values()) mat.setFloat("time", t);
    });
    states.set(scene, s);
    state = s;
  }
  return state;
}

export function createElementFloorMaterial(scene: Scene, name: string): ShaderMaterial {
  const mat = new ShaderMaterial(name, scene, "elementFloor", {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "time", "mode", "color", "alpha"],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false;
  return mat;
}

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

type ElementPreset = {
  count: number;
  color1: Color4;
  direction1: Vector3;
  direction2: Vector3;
  gravity?: Vector3;
  power: { min: number; max: number };
  lifetime: { min: number; max: number };
  size: { min: number; max: number };
};

const PRESETS: Record<ElementGlyphKind, ElementPreset> = {
  ice: {
    count: 90,
    color1: new Color4(0.9, 0.97, 1, 1),
    direction1: new Vector3(-1, 2, -1),
    direction2: new Vector3(1, 3, 1),
    gravity: new Vector3(0, -6, 0),
    power: { min: 1.5, max: 3 },
    lifetime: { min: 0.2, max: 0.35 },
    size: { min: 0.2, max: 0.45 },
  },
  lightning: {
    count: 110,
    color1: new Color4(1, 1, 1, 1),
    direction1: new Vector3(-1, 0.3, -1),
    direction2: new Vector3(1, 1.5, 1),
    power: { min: 6, max: 10 },
    lifetime: { min: 0.08, max: 0.18 },
    size: { min: 0.1, max: 0.25 },
  },
  fire: {
    count: 100,
    color1: new Color4(1, 0.8, 0.3, 1),
    direction1: new Vector3(-0.3, 1, -0.3),
    direction2: new Vector3(0.3, 1, 0.3),
    gravity: new Vector3(0, 2, 0),
    power: { min: 2, max: 4 },
    lifetime: { min: 0.2, max: 0.4 },
    size: { min: 0.3, max: 0.6 },
  },
};

const BURST_Y = 0.1;
const MAX_PARTICLES = 400;

export function spawnElementBurst(scene: Scene, kind: ElementGlyphKind, shape: AOEShape, color: string, overrides?: BurstVfx): void {
  const preset = PRESETS[kind];
  const base = Color3.FromHexString(overrides?.color ?? color);
  const ps = new ParticleSystem(`element-burst-${kind}`, MAX_PARTICLES, scene);
  ps.particleTexture = dotTexture(scene);
  ps.emitter = Vector3.Zero();
  ps.startPositionFunction = (worldMatrix, positionToUpdate) => {
    const point = sampleShapePoint(shape);
    Vector3.TransformCoordinatesFromFloatsToRef(point.x, BURST_Y, point.z, worldMatrix, positionToUpdate);
  };
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.color1 = preset.color1;
  ps.color2 = new Color4(base.r, base.g, base.b, 1);
  ps.colorDead = new Color4(base.r, base.g, base.b, 0);
  ps.direction1 = preset.direction1;
  ps.direction2 = preset.direction2;
  if (preset.gravity) ps.gravity = preset.gravity;
  ps.minEmitPower = preset.power.min;
  ps.maxEmitPower = preset.power.max;
  ps.minLifeTime = overrides?.lifetime?.min ?? preset.lifetime.min;
  ps.maxLifeTime = overrides?.lifetime?.max ?? preset.lifetime.max;
  ps.minSize = overrides?.size?.min ?? preset.size.min;
  ps.maxSize = overrides?.size?.max ?? preset.size.max;
  ps.manualEmitCount = Math.min(overrides?.count ?? preset.count, MAX_PARTICLES);
  ps.targetStopDuration = 0.1;
  ps.onAnimationEnd = () => scene.onAfterRenderObservable.addOnce(() => ps.dispose(false));
  ps.start();
}

export function prewarmElementBurst(scene: Scene): void {
  const ps = new ParticleSystem("__prewarm_element_burst", 1, scene);
  ps.particleTexture = dotTexture(scene);
  ps.emitter = new Vector3(0, -100, 0);
  ps.manualEmitCount = 1;
  ps.start();
  scene.onAfterRenderObservable.addOnce(() => ps.dispose(false));
}
