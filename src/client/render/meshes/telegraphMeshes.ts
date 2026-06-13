import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic, AOEShape } from "@shared/types";
import { normalize } from "@shared/math";

// Geometry-only ground mesh for an AOE shape (no material). Shared by the telegraph layer
// and other layers that need to draw a shape footprint (e.g. the inverse "?" telegraph).
export function createShapeMesh(scene: Scene, id: string, shape: AOEShape): Mesh | null {
  const Y = 0.01;
  let mesh: Mesh;

  switch (shape.kind) {
    case "circle":
      mesh = CreateDisc(`tel-${id}`, { radius: shape.radius, tessellation: 64 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(shape.center.x, Y, shape.center.z);
      break;

    case "donut": {
      const seg = 64;
      const outer: Vector3[] = [], inner: Vector3[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        outer.push(new Vector3(shape.center.x + c * shape.outer, Y, shape.center.z + s * shape.outer));
        inner.push(new Vector3(shape.center.x + c * shape.inner, Y, shape.center.z + s * shape.inner));
      }
      mesh = CreateRibbon(`tel-${id}`, { pathArray: [outer, inner] }, scene);
      break;
    }

    case "cone": {
      const dir = normalize(shape.direction);
      const yaw = Math.atan2(dir.x, dir.z);
      const half = (shape.angleDeg / 2) * (Math.PI / 180);
      const seg = 32;
      const apex = new Vector3(shape.origin.x, Y, shape.origin.z);
      const arc: Vector3[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = yaw - half + (i / seg) * shape.angleDeg * (Math.PI / 180);
        arc.push(new Vector3(
          shape.origin.x + Math.sin(a) * shape.length, Y,
          shape.origin.z + Math.cos(a) * shape.length,
        ));
      }
      mesh = CreateRibbon(`tel-${id}`, {
        pathArray: [Array(seg + 1).fill(apex), arc],
      }, scene);
      break;
    }

    case "rect": {
      const dir = normalize(shape.direction);
      const yaw = Math.atan2(dir.x, dir.z);
      mesh = CreateGround(`tel-${id}`, { width: shape.width, height: shape.length }, scene);
      mesh.rotation.y = yaw;
      mesh.position.set(
        shape.origin.x + dir.x * shape.length / 2,
        Y,
        shape.origin.z + dir.z * shape.length / 2,
      );
      break;
    }

    default:
      return null;
  }

  return mesh;
}

export function createTelegraphMesh(scene: Scene, mechanic: ActiveMechanic): Mesh | null {
  const mesh = createShapeMesh(scene, mechanic.id, mechanic.shape);
  if (!mesh) return null;

  const mat = new StandardMaterial(`tel-mat-${mechanic.id}`, scene);
  mat.diffuseColor = new Color3(1, 0.8, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mesh.material = mat;
  return mesh;
}
