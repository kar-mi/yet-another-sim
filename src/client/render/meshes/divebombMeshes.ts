import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveDivebomb } from "@shared/types";
import { length, sub } from "@shared/math";
import { DIVEBOMB_LINGER } from "@shared/constants";
import { divebombPosition } from "@shared/divebomb";

export type DivebombMeshes = {
  all: Mesh[];
  material: StandardMaterial;
};

// Number of discrete slots along the path (matches the engine's stepping model: every `gap` of
// distance plus the start slot).
function slotCount(divebomb: ActiveDivebomb): number {
  return Math.ceil(length(sub(divebomb.to, divebomb.from)) / divebomb.gap) + 1;
}

function makeSphere(scene: Scene, name: string, divebomb: ActiveDivebomb, material: StandardMaterial): Mesh {
  const sphere = CreateSphere(name, { diameter: divebomb.size, segments: 16 }, scene);
  sphere.material = material;
  sphere.isPickable = false;
  return sphere;
}

export function createDivebombMeshes(scene: Scene, divebomb: ActiveDivebomb): DivebombMeshes {
  const material = new StandardMaterial(`divebomb-mat-${divebomb.id}`, scene);
  const color = Color3.FromHexString(divebomb.color);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.5);
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = 0.8;

  // "line": one sphere per slot, parked on its slot position; updateDivebombMeshes pops each in as
  // the wave reaches it. "step": a single sphere that advances along the path.
  if (divebomb.visual === "line") {
    const count = slotCount(divebomb);
    const all: Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const sphere = makeSphere(scene, `divebomb-${divebomb.id}-${i}`, divebomb, material);
      const pos = divebombPosition(divebomb.from, divebomb.to, divebomb.gap, divebomb.speed, (i * divebomb.gap) / divebomb.speed);
      sphere.position.set(pos.x, 0, pos.z);
      sphere.scaling.setAll(0);
      sphere.setEnabled(false);
      all.push(sphere);
    }
    return { all, material };
  }

  return { all: [makeSphere(scene, `divebomb-${divebomb.id}`, divebomb, material)], material };
}

// easeOutBack: overshoots slightly past full scale before settling, so each sphere reads as a pop.
function popScale(p: number): number {
  if (p >= 1) return 1;
  const c1 = 1.70158;
  const t = p - 1;
  return 1 + (c1 + 1) * t * t * t + c1 * t * t;
}

export function updateDivebombMeshes(handle: DivebombMeshes, divebomb: ActiveDivebomb, time: number): void {
  const elapsed = time - divebomb.startedAt;
  const fade = divebomb.resolved
    ? 0.8 * Math.max(0, 1 - (time - divebomb.expireAt) / DIVEBOMB_LINGER)
    : 0.8;
  handle.material.alpha = fade;

  if (divebomb.visual === "line") {
    const stepTime = divebomb.gap / divebomb.speed;
    const popTime = stepTime * 0.6; // how long each sphere takes to pop in
    for (let i = 0; i < handle.all.length; i++) {
      const sphere = handle.all[i]!;
      const age = elapsed - i * stepTime; // time since this slot's wave-front arrival
      if (age < 0) { sphere.setEnabled(false); continue; }
      sphere.setEnabled(true);
      sphere.scaling.setAll(popScale(Math.min(1, age / popTime)));
    }
    return;
  }

  const position = divebombPosition(divebomb.from, divebomb.to, divebomb.gap, divebomb.speed, elapsed);
  // Center the sphere on the floor plane so its lower half bisects the ground.
  handle.all[0]!.position.set(position.x, 0, position.z);
}
