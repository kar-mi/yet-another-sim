import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Scene } from "@babylonjs/core/scene";

export type Range = { min: number; max: number };

export type MeshGlowOptions = {
  glowColor: Color4;
  haloColor: Color3;
  intensity: Range;
  haloAlpha: Range;
  pulseSeconds: number;
  blurKernelSize?: number;
};

export type MeshGlow = {
  // Compile the glow shaders for meshes whose art may still be loading.
  warm(meshes: Iterable<AbstractMesh>): void;
  // Light `meshes` and place the halo; null clears the highlight. `time` is in seconds.
  highlight(meshes: AbstractMesh[] | null, time: number, haloPosition?: Vector3, haloScale?: number): void;
  dispose(): void;
};

// A pulsing glow around an arbitrary set of meshes, plus a soft camera-facing halo. The halo is
// parented to `haloParent` rather than a target mesh, so the glow layer does not blur it into a
// solid blob.
export function createMeshGlow(scene: Scene, name: string, haloParent: Mesh, options: MeshGlowOptions): MeshGlow {
  const halo = CreatePlane(`${name}-halo`, { size: 1 }, scene);
  halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
  halo.material = haloMaterial(scene, `${name}-halo`, options.haloColor);
  halo.isPickable = false;
  halo.parent = haloParent;
  halo.setEnabled(false);
  halo.material.forceCompilation(halo);

  // Disable an empty glow layer: an empty include list would glow everything.
  const glow = new GlowLayer(name, scene, { blurKernelSize: options.blurKernelSize ?? 96 });
  glow.customEmissiveColorSelector = (_mesh, _subMesh, _material, result) => result.copyFrom(options.glowColor);
  glow.isEnabled = false;

  let included: AbstractMesh[] = [];
  const warmed = new Set<AbstractMesh>();

  return {
    warm(meshes) {
      if (warmed.size === 0) glow.isLayerReady(); // creates the merge effect
      for (const mesh of meshes) {
        if (warmed.has(mesh) || !mesh.material || !mesh.subMeshes) continue;
        warmed.add(mesh);
        for (const subMesh of mesh.subMeshes) glow.isReady(subMesh, false);
      }
    },
    highlight(meshes, time, haloPosition, haloScale) {
      const next = meshes ?? [];
      if (next.length !== included.length || next.some((mesh, i) => mesh !== included[i])) {
        for (const mesh of included) glow.removeIncludedOnlyMesh(mesh as Mesh);
        for (const mesh of next) glow.addIncludedOnlyMesh(mesh as Mesh);
        included = next;
      }
      glow.isEnabled = meshes !== null;
      halo.setEnabled(meshes !== null);
      if (!meshes) return;
      const pulse = (1 - Math.cos((time / options.pulseSeconds) * Math.PI * 2)) / 2;
      glow.intensity = options.intensity.min + (options.intensity.max - options.intensity.min) * pulse;
      if (haloPosition) halo.position.copyFrom(haloPosition);
      if (haloScale !== undefined) halo.scaling.setAll(haloScale);
      halo.material!.alpha = options.haloAlpha.min + (options.haloAlpha.max - options.haloAlpha.min) * pulse;
    },
    dispose() {
      glow.dispose();
    },
  };
}

// A soft sphere: faint in the middle so the target shows through, brightest toward the rim.
function haloMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const tex = new DynamicTexture(`${name}-tex`, { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.2)");
  g.addColorStop(0.6, "rgba(255,255,255,0.6)");
  g.addColorStop(0.8, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.hasAlpha = true;
  tex.update();

  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = color;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.disableDepthWrite = true;
  // The camera-facing plane cuts through the target slab; depth testing would clip it along a seam.
  mat.depthFunction = Constants.ALWAYS;
  mat.backFaceCulling = false;
  mat.alphaMode = Constants.ALPHA_ADD;
  return mat;
}
