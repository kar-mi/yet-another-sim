// Death effect for voxel player models: the model's "pixels" (baked into the GLB root node's
// extras by scripts/voxel-models) fly apart, bounce on the floor, and shrink away.
//
// The burst is a pure function of (pull seed, player id, seconds since death), following the
// lockstep rules (docs/deterministic-lockstep.md): randomness comes from the seeded mulberry32 PRNG,
// rotations from dmath, and physics is integrated at a fixed step from the moment of death, never
// from the render frame's delta. Every client and every replay therefore draws the same burst at
// the same sim time; it freezes while the sim is paused and seeks correctly. It is render-only and
// never feeds back into the World.
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { cos, sin } from "@shared/dmath";
import { nextRandom } from "@shared/rng";

export type BurstData = { cell: number; positions: number[]; colors: number[] };

// All in model units (the voxel model is ~4.5 tall before PLAYER_MODEL_SCALE) and sim seconds.
export const BURST_DURATION = 1.4;
export const BURST_STEP = 1 / 120;
const SHRINK_START = 0.9;
const GRAVITY = 25;
const BURST_CENTER_Y = 2.2;
const SPEED_MIN = 3;
const SPEED_MAX = 6.5;
const LIFT = 4;
const DOWN_DAMPING = 0.3; // pixels below the middle still pop up before falling
const BOUNCE = 0.3;
const FLOOR_FRICTION = 0.6;
const MAX_SPIN = 12; // rad/s

export function readBurstData(metadata: unknown): BurstData | null {
  const burst = (metadata as { gltf?: { extras?: { voxelBurst?: BurstData } } } | null)?.gltf?.extras?.voxelBurst;
  if (!burst || !Array.isArray(burst.positions) || !Array.isArray(burst.colors)) return null;
  if (burst.positions.length !== burst.colors.length * 3 || burst.colors.length === 0) return null;
  return burst;
}

// 32-bit seed for one player's burst in one pull (FNV-1a over the id, mixed with the pull seed).
export function burstSeed(worldSeed: number, playerId: string): number {
  let h = (0x811c9dc5 ^ worldSeed) >>> 0;
  for (let i = 0; i < playerId.length; i++) h = Math.imul(h ^ playerId.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export type BurstLaunch = { vel: Float64Array; spinAxis: Float64Array; spinRate: Float64Array };

// Initial velocities (outward from the model's middle, always upward at first) and spins.
export function launchBurst(data: BurstData, seed: number): BurstLaunch {
  let state = seed;
  const random = () => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
  };
  const count = data.colors.length;
  const vel = new Float64Array(count * 3);
  const spinAxis = new Float64Array(count * 3);
  const spinRate = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    let dx = data.positions[p]! + (random() - 0.5);
    let dy = data.positions[p + 1]! - BURST_CENTER_Y + (random() - 0.5);
    let dz = data.positions[p + 2]! + (random() - 0.5);
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) {
      dx = 0; dy = 1; dz = 0; len = 1;
    }
    const speed = (SPEED_MIN + random() * (SPEED_MAX - SPEED_MIN)) / len;
    dx *= speed; dy *= speed; dz *= speed;
    vel[p] = dx;
    vel[p + 1] = LIFT + (dy > 0 ? dy : dy * DOWN_DAMPING);
    vel[p + 2] = dz;
    let ax = random() - 0.5, ay = random() - 0.5, az = random() - 0.5;
    const alen = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= alen; ay /= alen; az /= alen;
    spinAxis[p] = ax; spinAxis[p + 1] = ay; spinAxis[p + 2] = az;
    spinRate[i] = (random() * 2 - 1) * MAX_SPIN;
  }
  return { vel, spinAxis, spinRate };
}

export type BurstState = { step: number; pos: Float64Array; vel: Float64Array };

// Advance every pixel one fixed step under gravity; pixels that reach the floor bounce and slide.
export function stepBurst(state: BurstState, floorY: number): void {
  const { pos, vel } = state;
  for (let i = 0; i < pos.length; i += 3) {
    vel[i + 1]! -= GRAVITY * BURST_STEP;
    pos[i]! += vel[i]! * BURST_STEP;
    pos[i + 1]! += vel[i + 1]! * BURST_STEP;
    pos[i + 2]! += vel[i + 2]! * BURST_STEP;
    if (pos[i + 1]! < floorY) {
      pos[i + 1] = floorY;
      if (vel[i + 1]! < 0) vel[i + 1] = -vel[i + 1]! * BOUNCE;
      vel[i]! *= FLOOR_FRICTION;
      vel[i + 2]! *= FLOOR_FRICTION;
    }
  }
  state.step++;
}

// Deterministic pixel simulation. `at(elapsed)` returns the state at the last fixed step at or
// before `elapsed`, stepping forward from a cache and restarting from the launch when time goes
// back (a replay seek).
export class BurstSim {
  readonly launch: BurstLaunch;
  private state: BurstState;

  constructor(private readonly data: BurstData, seed: number) {
    this.launch = launchBurst(data, seed);
    this.state = this.initial();
  }

  private initial(): BurstState {
    return { step: 0, pos: Float64Array.from(this.data.positions), vel: Float64Array.from(this.launch.vel) };
  }

  at(elapsed: number): BurstState {
    const target = Math.max(0, Math.floor(elapsed / BURST_STEP));
    if (target < this.state.step) this.state = this.initial();
    while (this.state.step < target) stepBurst(this.state, this.data.cell / 2);
    return this.state;
  }
}

export function burstScale(elapsed: number): number {
  if (elapsed <= SHRINK_START) return 1;
  return Math.max(0, 1 - (elapsed - SHRINK_START) / (BURST_DURATION - SHRINK_START));
}

const MATERIAL_NAME = "voxel-burst";

// One material per scene, shared by every burst; pixel colours come from the instance buffer.
function burstMaterial(scene: Scene): PBRMaterial {
  const existing = scene.getMaterialByName(MATERIAL_NAME);
  if (existing instanceof PBRMaterial) return existing;
  const material = new PBRMaterial(MATERIAL_NAME, scene);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = 1;
  return material;
}

// One burst: a thin-instanced cube per pixel under `frame`, which carries the model root's
// transform so pixels line up with the model they replace. The owner calls render() with the sim
// time since death.
export class VoxelBurst {
  private readonly frame: TransformNode;
  private readonly mesh: Mesh;
  private readonly sim: BurstSim;
  private readonly matrices: Float32Array;
  private readonly count: number;

  constructor(scene: Scene, frameTemplate: TransformNode, parent: TransformNode, data: BurstData, seed: number) {
    this.frame = new TransformNode(`${frameTemplate.name}-burst`, scene);
    this.frame.parent = parent;
    this.frame.position.copyFrom(frameTemplate.position);
    this.frame.rotationQuaternion = frameTemplate.rotationQuaternion?.clone() ?? null;
    if (!this.frame.rotationQuaternion) this.frame.rotation.copyFrom(frameTemplate.rotation);
    this.frame.scaling.copyFrom(frameTemplate.scaling);

    this.mesh = CreateBox(`${frameTemplate.name}-burst-pixels`, { size: data.cell }, scene);
    this.mesh.parent = this.frame;
    this.mesh.isPickable = false;
    this.mesh.material = burstMaterial(scene);
    this.mesh.alwaysSelectAsActiveMesh = true; // instances fly well outside the unit cube's bounds

    this.count = data.colors.length;
    const colors = new Float32Array(this.count * 4);
    const color = new Color3();
    data.colors.forEach((hex, i) => {
      Color3.FromHexString(`#${hex.toString(16).padStart(6, "0")}`).toLinearSpaceToRef(color);
      colors.set([color.r, color.g, color.b, 1], i * 4);
    });
    this.sim = new BurstSim(data, seed);
    this.matrices = new Float32Array(this.count * 16);
    this.render(0);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", colors, 4, true);
  }

  render(elapsed: number): void {
    const state = this.sim.at(elapsed);
    const t = state.step * BURST_STEP;
    const s = burstScale(t);
    const scaling = new Vector3(s, s, s);
    const rotation = new Quaternion();
    const position = new Vector3();
    const matrix = new Matrix();
    const { spinAxis, spinRate } = this.sim.launch;
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      const half = (spinRate[i]! * t) / 2;
      const sh = sin(half);
      rotation.set(spinAxis[p]! * sh, spinAxis[p + 1]! * sh, spinAxis[p + 2]! * sh, cos(half));
      position.set(state.pos[p]!, state.pos[p + 1]!, state.pos[p + 2]!);
      Matrix.ComposeToRef(scaling, rotation, position, matrix);
      matrix.copyToArray(this.matrices, i * 16);
    }
    if (this.mesh.hasThinInstances) this.mesh.thinInstanceBufferUpdated("matrix");
  }

  dispose(): void {
    this.mesh.dispose();
    this.frame.dispose();
  }
}
