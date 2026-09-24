import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateGoldberg } from "@babylonjs/core/Meshes/Builders/goldbergBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RegisterEdgesRenderer } from "@babylonjs/core/Rendering/edgesRenderer.pure";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@model/types";
import type { BossSideOrbColors } from "./bossSideOrbs";

const SIDE_ORB_DIAMETER = 1.6;
const SIDE_ORB_OFFSET = 2.4;
const SIDE_ORB_HEIGHT = 2;
const PURPLE_ORB_COLOR = "#a855f7";
const INNER_SPIN_SPEED = 1.8;
const CORE_BLUE = new Color4(0.12, 0.52, 1, 1);
const CORE_WHITE = new Color4(1, 1, 1, 1);
const EDGE_COLOR = new Color4(0.01, 0.015, 0.025, 1);

RegisterEdgesRenderer();

function addTriangle(
  points: readonly Vector3[],
  color: Color4,
  positions: number[],
  indices: number[],
  colors: number[],
): void {
  const start = positions.length / 3;
  for (const point of points) {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b, color.a);
  }
  indices.push(start, start + 1, start + 2);
}

function createSubdividedTetrahedron(name: string, scene: Scene): Mesh {
  const radius = 0.55;
  const topY = radius / 3;
  const topRadius = radius * 2 * Math.sqrt(2) / 3;
  const vertices = [
    new Vector3(0, -radius, 0),
    new Vector3(topRadius, topY, 0),
    new Vector3(-topRadius / 2, topY, topRadius * Math.sqrt(3) / 2),
    new Vector3(-topRadius / 2, topY, -topRadius * Math.sqrt(3) / 2),
  ];
  const faces = [[1, 2, 3], [0, 2, 1], [0, 3, 2], [0, 1, 3]] as const;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  for (const [aIndex, bIndex, cIndex] of faces) {
    const a = vertices[aIndex]!;
    const b = vertices[bIndex]!;
    const c = vertices[cIndex]!;
    const ab = Vector3.Center(a, b);
    const bc = Vector3.Center(b, c);
    const ca = Vector3.Center(c, a);
    addTriangle([a, ab, ca], CORE_BLUE, positions, indices, colors);
    addTriangle([ab, b, bc], CORE_WHITE, positions, indices, colors);
    addTriangle([ca, bc, c], CORE_BLUE, positions, indices, colors);
    addTriangle([ab, bc, ca], CORE_WHITE, positions, indices, colors);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.enableEdgesRendering(1.01, true);
  mesh.edgesWidth = 1.5;
  mesh.edgesColor = EDGE_COLOR;
  return mesh;
}

function createPanelSphere(name: string, scene: Scene): Mesh {
  const mesh = CreateGoldberg(name, { m: 1, n: 1, size: 0.55 }, scene);
  mesh.setGoldbergFaceColors(Array.from(
    { length: mesh.goldbergData.nbFaces },
    (_, index) => [index, index, index % 2 === 0 ? CORE_BLUE : CORE_WHITE],
  ));
  mesh.enableEdgesRendering();
  mesh.edgesWidth = 1.5;
  mesh.edgesColor = EDGE_COLOR;
  return mesh;
}

type SideOrbMeshes = {
  root: TransformNode;
  shell: Mesh;
  panelSphere: Mesh;
  tetrahedron: Mesh;
};

export class BossSideOrbLayer {
  private node?: TransformNode;
  private orbs?: { left: SideOrbMeshes; right: SideOrbMeshes };
  private readonly materials = new Map<string, StandardMaterial>();
  private coreMaterial?: StandardMaterial;

  constructor(private scene: Scene) {}

  sync(boss: Boss, colors: BossSideOrbColors | undefined, time: number): void {
    const shown = boss.hp > 0 && !boss.hidden;
    if (!shown || (!colors?.leftColor && !colors?.rightColor)) {
      this.node?.setEnabled(false);
      return;
    }
    if (!this.orbs) this.build();
    this.node!.position.set(boss.pos.x, SIDE_ORB_HEIGHT, boss.pos.z);
    this.node!.rotation.y = boss.facing;
    this.node!.setEnabled(true);
    for (const [side, color] of [["left", colors.leftColor], ["right", colors.rightColor]] as const) {
      const orb = this.orbs![side];
      if (color === undefined) {
        orb.root.setEnabled(false);
        continue;
      }
      orb.shell.material = this.material(color);
      const purple = color.toLowerCase() === PURPLE_ORB_COLOR;
      orb.panelSphere.setEnabled(purple);
      orb.tetrahedron.setEnabled(!purple);
      orb.panelSphere.rotation.y = time * INNER_SPIN_SPEED;
      orb.tetrahedron.rotation.y = -time * INNER_SPIN_SPEED;
      orb.root.setEnabled(true);
    }
  }

  private build(): void {
    this.node = new TransformNode("boss-side-orbs", this.scene);
    const make = (side: "left" | "right"): SideOrbMeshes => {
      const root = new TransformNode(`boss-side-orb-${side}`, this.scene);
      root.parent = this.node!;
      root.position.x = side === "left" ? -SIDE_ORB_OFFSET : SIDE_ORB_OFFSET;

      const shell = CreateSphere(`boss-side-orb-shell-${side}`, { diameter: SIDE_ORB_DIAMETER, segments: 16 }, this.scene);
      shell.parent = root;

      const panelSphere = createPanelSphere(`boss-side-orb-panel-sphere-${side}`, this.scene);
      panelSphere.parent = root;
      panelSphere.rotation.x = 0.15;
      panelSphere.material = this.getCoreMaterial();

      const tetrahedron = createSubdividedTetrahedron(`boss-side-orb-tetrahedron-${side}`, this.scene);
      tetrahedron.parent = root;
      tetrahedron.material = this.getCoreMaterial();

      for (const mesh of [shell, panelSphere, tetrahedron]) mesh.isPickable = false;
      return { root, shell, panelSphere, tetrahedron };
    };
    this.orbs = { left: make("left"), right: make("right") };
  }

  private getCoreMaterial(): StandardMaterial {
    if (this.coreMaterial) return this.coreMaterial;
    const material = new StandardMaterial("boss-side-orb-core-mat", this.scene);
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.specularColor = new Color3(0, 0, 0);
    material.disableLighting = true;
    this.coreMaterial = material;
    return material;
  }

  private material(color: string): StandardMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const material = new StandardMaterial(`boss-side-orb-mat-${color}`, this.scene);
    const tint = Color3.FromHexString(color);
    material.diffuseColor = tint;
    material.emissiveColor = tint;
    material.specularColor = new Color3(0, 0, 0);
    material.disableLighting = true;
    material.alpha = 0.32;
    material.backFaceCulling = false;
    this.materials.set(color, material);
    return material;
  }

  dispose(): void {
    for (const orb of this.orbs ? [this.orbs.left, this.orbs.right] : []) {
      orb.shell.dispose();
      orb.panelSphere.dispose();
      orb.tetrahedron.dispose();
      orb.root.dispose();
    }
    this.orbs = undefined;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.coreMaterial?.dispose();
    this.coreMaterial = undefined;
    this.node?.dispose();
    this.node = undefined;
  }
}
