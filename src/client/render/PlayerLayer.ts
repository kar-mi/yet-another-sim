import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
// Bun's bundler drops the bare side-effect import, so register edges rendering explicitly.
import { RegisterEdgesRenderer } from "@babylonjs/core/Rendering/edgesRenderer";
RegisterEdgesRenderer();
import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "../../shared/types";

const PLAYER_HEIGHT = 0.8;
const PLAYER_CENTER_Y = PLAYER_HEIGHT / 2;
const APEX_DEPTH = 0.9;   // distance from center to the forward (+Z) tip
const REAR_SETBACK = 0.5; // distance from center back to the rear edge
const REAR_HALF_WIDTH = 0.7;

// A vertically-centered triangular prism with its apex on +Z. Apex vertices are
// tinted bright (front), rear vertices keep the role color, so the gradient shows facing.
function buildPrism(name: string, role: Player["role"], scene: Scene): Mesh {
  const color =
    role === "tank" ? new Color3(0.3, 0.5, 1) :
    role === "healer" ? new Color3(0.3, 1, 0.5) :
    new Color3(1, 0.4, 0.4);
  // Lighten the role color toward white for the front apex highlight.
  const front = Color3.Lerp(color, new Color3(1, 1, 1), 0.7);

  const h = PLAYER_HEIGHT / 2;
  // Local footprint: 0 = apex (front, +Z), 1 = rear-left, 2 = rear-right.
  const positions = [
    0, -h, APEX_DEPTH,          0, h, APEX_DEPTH,          // apex bottom / top
    -REAR_HALF_WIDTH, -h, -REAR_SETBACK,  -REAR_HALF_WIDTH, h, -REAR_SETBACK,  // rear-left bottom / top
    REAR_HALF_WIDTH, -h, -REAR_SETBACK,   REAR_HALF_WIDTH, h, -REAR_SETBACK,   // rear-right bottom / top
  ];
  // Index order per corner: bottom = 0,2,4 ; top = 1,3,5
  const indices = [
    0, 4, 2,        // bottom face
    1, 3, 5,        // top face
    0, 1, 3, 0, 3, 2,   // left side (apex -> rear-left)
    4, 5, 1, 4, 1, 0,   // right side (rear-right -> apex)
    2, 3, 5, 2, 5, 4,   // rear face
  ];
  const c = (col: Color3) => [col.r, col.g, col.b, 1];
  const colors = [
    ...c(front), ...c(front),   // apex
    ...c(color), ...c(color),   // rear-left
    ...c(color), ...c(color),   // rear-right
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;
  data.applyToMesh(mesh);

  const mat = new StandardMaterial(`pmat-${name}`, scene);
  mat.diffuseColor = new Color3(1, 1, 1); // let vertex colors show through
  mat.emissiveColor = color.scale(0.2);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false; // small solid body; render both sides
  mat.twoSidedLighting = true; // light whichever side faces the camera, regardless of winding
  mesh.material = mat;

  mesh.enableEdgesRendering();
  mesh.edgesWidth = 2;
  mesh.edgesColor = new Color4(0.05, 0.05, 0.05, 1);
  return mesh;
}

export class PlayerLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  init(players: Player[]): void {
    for (const player of players) {
      const mesh = buildPrism(`player-${player.id}`, player.role, this.scene);
      mesh.position.set(player.pos.x, PLAYER_CENTER_Y + player.y, player.pos.z);
      mesh.rotation.y = player.facing;
      this.meshes.set(player.id, mesh);
    }
  }

  sync(players: Player[]): void {
    for (const player of players) {
      const mesh = this.meshes.get(player.id);
      if (!mesh) continue;
      mesh.position.x = player.pos.x;
      mesh.position.y = PLAYER_CENTER_Y + player.y;
      mesh.position.z = player.pos.z;
      mesh.rotation.y = player.facing;
      mesh.isVisible = player.alive;
    }
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.get(id);
  }
}
