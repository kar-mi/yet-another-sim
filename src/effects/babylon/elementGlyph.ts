import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec2 } from "@shared/math";
import type { ElementGlyphKind } from "../index";

const GLYPH_Y = 2.0;
const SPIN = 1.2;
const GAP = 0.15;

export type ElementGlyphHandle = {
  root: TransformNode;
  animate: (time: number) => void;
};

export function createElementGlyph(scene: Scene, id: string, kind: ElementGlyphKind, color: string, at: Vec2, scale = 1): ElementGlyphHandle {
  const root = new TransformNode(`glyph-${id}`, scene);
  root.position.set(at.x, GLYPH_Y * scale, at.z);
  root.scaling.setAll(scale);

  const material = new StandardMaterial(`glyph-mat-${id}`, scene);
  const c = Color3.FromHexString(color);
  material.diffuseColor = c;
  material.emissiveColor = c.scale(0.5);
  material.specularColor = Color3.White().scale(0.2);
  material.alpha = 0.9;

  const own = (mesh: Mesh) => {
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  };

  switch (kind) {
    case "lightning": {
      const height = 1.2;
      const pyramid = (name: string) => CreateCylinder(name, { height, diameterTop: 0, diameterBottom: 3, tessellation: 3 }, scene);
      const top = own(pyramid(`glyph-${id}-top`));
      top.position.y = GAP / 2 + height / 2;
      const bottom = own(pyramid(`glyph-${id}-bottom`));
      bottom.rotation.x = Math.PI;
      bottom.position.y = -(GAP / 2 + height / 2);
      return { root, animate: time => { root.rotation.y = -SPIN * time; } };
    }
    case "fire": {
      const height = 1.0;
      const slab = (name: string) => CreateBox(name, { width: 2.1, depth: 2.1, height }, scene);
      const top = own(slab(`glyph-${id}-top`));
      top.position.y = GAP / 2 + height / 2;
      const bottom = own(slab(`glyph-${id}-bottom`));
      bottom.position.y = -(GAP / 2 + height / 2);
      return {
        root,
        animate: time => {
          top.rotation.y = SPIN * time;
          bottom.rotation.y = -SPIN * time;
        },
      };
    }
    case "ice":
      own(CreateSphere(`glyph-${id}-orb`, { diameter: 2.4, segments: 16 }, scene));
      return { root, animate: () => {} };
  }
}
