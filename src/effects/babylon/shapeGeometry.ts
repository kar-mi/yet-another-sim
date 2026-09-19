import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { AOEShape } from "../index";
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

    case "polygon": {
      const data = new VertexData();
      data.positions = shape.vertices.flatMap(v => [v.x, Y, v.z]);
      data.normals = shape.vertices.flatMap(() => [0, 1, 0]);
      // Fan from vertex 0; the authored polygons are convex.
      data.indices = shape.vertices.slice(2).flatMap((_, i) => [0, i + 1, i + 2]);
      mesh = new Mesh(`tel-${id}`, scene);
      data.applyToMesh(mesh);
      break;
    }

    default:
      return null;
  }

  return mesh;
}

// Outline every shape: the circle and polygon perimeters, a rectangle's four sides, a cone's arc
// closed by its two radial edges, and both of a donut's boundaries.
export function createShapeOutlineMesh(scene: Scene, id: string, shape: AOEShape): Mesh | null {
  const Y = 0.03;
  const name = `tel-outline-${id}`;

  switch (shape.kind) {
    case "polygon":
      return outlineTube(scene, name, shape.vertices.map(v => new Vector3(v.x, Y, v.z)));

    case "circle":
      return outlineTube(scene, name, ringPoints(shape.center, shape.radius, Y));

    case "donut": {
      const outer = outlineTube(scene, `${name}-outer`, ringPoints(shape.center, shape.outer, Y));
      const inner = outlineTube(scene, `${name}-inner`, ringPoints(shape.center, shape.inner, Y));
      return Mesh.MergeMeshes([outer, inner], true) ?? outer;
    }

    case "cone": {
      const dir = normalize(shape.direction);
      const yaw = Math.atan2(dir.x, dir.z);
      const half = (shape.angleDeg / 2) * (Math.PI / 180);
      const seg = 32;
      const arc = Array.from({ length: seg + 1 }, (_, i) => {
        const a = yaw - half + (i / seg) * 2 * half;
        return new Vector3(
          shape.origin.x + Math.sin(a) * shape.length, Y,
          shape.origin.z + Math.cos(a) * shape.length,
        );
      });
      // Closing the path back to the apex draws both radial edges.
      return outlineTube(scene, name, [new Vector3(shape.origin.x, Y, shape.origin.z), ...arc]);
    }

    case "rect": {
      const dir = normalize(shape.direction);
      const right = { x: dir.z, z: -dir.x };
      const halfWidth = shape.width / 2;
      const corner = (along: number, across: number) => new Vector3(
        shape.origin.x + dir.x * along + right.x * across, Y,
        shape.origin.z + dir.z * along + right.z * across,
      );
      return outlineTube(scene, name, [
        corner(0, halfWidth),
        corner(shape.length, halfWidth),
        corner(shape.length, -halfWidth),
        corner(0, -halfWidth),
      ]);
    }

    default:
      return null;
  }
}

function ringPoints(center: { x: number; z: number }, radius: number, y: number): Vector3[] {
  return Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return new Vector3(center.x + Math.cos(a) * radius, y, center.z + Math.sin(a) * radius);
  });
}

function outlineTube(scene: Scene, name: string, points: Vector3[]): Mesh {
  return CreateTube(name, { path: [...points, points[0]!], radius: 0.1, tessellation: 6, cap: 0 }, scene);
}
