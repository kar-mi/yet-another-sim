import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "../../shared/types";

const RING_Y = 0.03;        // just above the floor, matching other ground meshes
const INNER_SCALE = 0.8;    // inner ring radius relative to the outer (boss.radius)
const TUBE_RADIUS = 0.06;   // ring line thickness
const GAP_HALF = 0.13;      // half-width (radians) of each cut gap
// FFXIV-style target ring: solid front arc (0 = facing), gaps at the rear and
// the four intercardinals. The front has no gap, so its arc is the widest.
const GAP_CENTERS = [Math.PI, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BossRingLayer {
  private node?: TransformNode;
  private meshes: Mesh[] = [];
  private material?: StandardMaterial;

  constructor(private scene: Scene) {}

  sync(boss: Boss): void {
    if (!this.node) this.build(boss);
    this.node!.position.set(boss.pos.x, RING_Y, boss.pos.z);
    this.node!.rotation.y = boss.facing;
    this.node!.setEnabled(boss.hp > 0);
  }

  private build(boss: Boss): void {
    this.node = new TransformNode("boss-ring", this.scene);

    const mat = new StandardMaterial("boss-ring-mat", this.scene);
    const color = new Color3(0.95, 0.35, 0.2); // hostile orange-red
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    this.material = mat;

    this.buildRing(boss.radius);
    this.buildRing(boss.radius * INNER_SCALE);
    this.buildFrontTriangle(boss.radius);
  }

  // A flat ring outline drawn as tube segments, skipping the cut gaps.
  private buildRing(radius: number): void {
    const steps = 128;
    let run: Vector3[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const tube = CreateTube("boss-ring-seg", { path: run, radius: TUBE_RADIUS, tessellation: 6, cap: 0 }, this.scene);
        tube.material = this.material!;
        tube.parent = this.node!;
        tube.isPickable = false;
        this.meshes.push(tube);
      }
      run = [];
    };
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (GAP_CENTERS.some(c => Math.abs(angleDiff(a, c)) < GAP_HALF)) { flush(); continue; }
      run.push(new Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius)); // 0 = +Z (front)
    }
    flush();
  }

  // Small filled triangle at the front edge, pointing outward (+Z local).
  private buildFrontTriangle(radius: number): void {
    const tri = new Mesh("boss-ring-tri", this.scene);
    const tipLen = radius * 0.3;
    const halfW = radius * 0.2;
    const vd = new VertexData();
    vd.positions = [
      0, 0, radius + tipLen,  // tip
      -halfW, 0, radius,      // base left
      halfW, 0, radius,       // base right
    ];
    vd.indices = [0, 1, 2];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.applyToMesh(tri);
    tri.material = this.material!;
    tri.parent = this.node!;
    tri.isPickable = false;
    this.meshes.push(tri);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
    this.material?.dispose();
    this.material = undefined;
    this.node?.dispose();
    this.node = undefined;
  }
}
