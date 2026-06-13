import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@shared/types";
import { filteredCirclePaths } from "./meshes/meshPaths";

const RING_Y = 0.03;        // just above the floor, matching other ground meshes
const INNER_SCALE = 0.9;    // inner ring radius relative to the outer (boss.radius)
const VISUAL_SCALE = 2.0;   // render a larger ring without changing boss mechanics  
// TODO - make this a raid param. kefka is 2.0, other bosses will ahve their own size
const TUBE_RADIUS = 0.06;   // ring line thickness
// Connected front arc (0 = facing) wrapping to the SE/SW intercardinals (±135°),
// leaving only the rear 90° open. Draw only within REAR_OPENING_HALF of the front.
const REAR_OPENING_HALF = (3 * Math.PI) / 4;

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BossRingLayer {
  private node?: TransformNode;
  private meshes: Mesh[] = [];
  private materials: StandardMaterial[] = [];

  constructor(private scene: Scene) {}

  sync(boss: Boss): void {
    if (!this.node) this.build(boss);
    this.node!.position.set(boss.pos.x, RING_Y, boss.pos.z);
    this.node!.rotation.y = boss.facing;
    this.node!.setEnabled(boss.hp > 0);
  }

  private build(boss: Boss): void {
    this.node = new TransformNode("boss-ring", this.scene);

    const red = this.makeMaterial("boss-ring-red", new Color3(0.9, 0.13, 0.12));
    const white = this.makeMaterial("boss-ring-red-2",new Color3(0.9, 0.13, 0.12));

    const radius = boss.radius * VISUAL_SCALE;
    this.buildRing(radius, red);                // outer ring red
    this.buildRing(radius * INNER_SCALE, white); // inner ring white
    this.buildMarkers(radius, red, white);
  }

  private makeMaterial(name: string, color: Color3): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    this.materials.push(mat);
    return mat;
  }

  // A flat ring outline drawn as tube segments, skipping the cut gaps.
  private buildRing(radius: number, material: StandardMaterial): void {
    for (const path of filteredCirclePaths(
      0,
      0,
      radius,
      0,
      128,
      angle => Math.abs(angleDiff(angle, 0)) <= REAR_OPENING_HALF,
      "z",
    )) {
      const tube = CreateTube("boss-ring-seg", { path, radius: TUBE_RADIUS, tessellation: 6, cap: 0 }, this.scene);
      tube.material = material;
      tube.parent = this.node!;
      tube.isPickable = false;
      this.meshes.push(tube);
    }
  }

  // Facing markers: front triangle pointing outward (+Z), plus small E/W
  // triangles inside the ring pointing north (toward facing).
  private buildMarkers(radius: number, red: StandardMaterial, white: StandardMaterial): void {
    const frontTip = radius * 0.2, frontHalf = radius * 0.07;
    this.addTriangle([
      0, 0, radius + frontTip, // tip (outward)
      -frontHalf, 0, radius,
      frontHalf, 0, radius,
    ], red);

    // Small E/W markers inside the ring, both pointing north (+Z, toward facing).
    const sideX = radius * 0.9, sideLen = radius * 0.16, sideHalf = radius * 0.1;
    for (const cx of [sideX, -sideX]) {
      this.addTriangle([
        cx, 0, sideLen / 2,            // tip (north)
        cx - sideHalf, 0, -sideLen / 2,
        cx + sideHalf, 0, -sideLen / 2,
      ], white);
    }
  }

  private addTriangle(positions: number[], material: StandardMaterial): void {
    const tri = new Mesh("boss-ring-tri", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = [0, 1, 2];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.applyToMesh(tri);
    tri.material = material;
    tri.parent = this.node!;
    tri.isPickable = false;
    this.meshes.push(tri);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
    for (const mat of this.materials) mat.dispose();
    this.materials = [];
    this.node?.dispose();
    this.node = undefined;
  }
}
