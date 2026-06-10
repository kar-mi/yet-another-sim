import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

export function applyAlphaTest(mat: StandardMaterial, tex: DynamicTexture | Texture): void {
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.4;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
}

export function glyphBillboardMaterial(
  scene: Scene,
  materialName: string,
  textureName: string,
  glyph: string,
  color: string,
): StandardMaterial {
  const tex = new DynamicTexture(textureName, { width: 128, height: 128 }, scene, false);
  tex.hasAlpha = true;
  tex.drawText(glyph, null, 96, "bold 96px sans-serif", color, "transparent", true, true);
  const mat = new StandardMaterial(materialName, scene);
  applyAlphaTest(mat, tex);
  return mat;
}

export function imageBillboardMaterial(
  scene: Scene,
  materialName: string,
  url: string,
): StandardMaterial {
  const tex = new Texture(url, scene, true, false);
  tex.hasAlpha = true;
  const mat = new StandardMaterial(materialName, scene);
  applyAlphaTest(mat, tex);
  return mat;
}
