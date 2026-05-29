import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { clamp01 } from "../../shared/math";

type HealthBarOptions = {
  trackWidthPx: number;
  offsetYPx: number;
  color: string;
};

type HealthBar = {
  target: Mesh;
  plane: Mesh;
  texture: AdvancedDynamicTexture;
  fill: Rectangle;
  offsetYWorld: number;
};

export class HealthBarLayer {
  private bars = new Map<string, HealthBar>();

  constructor(private scene: Scene) {}

  link(id: string, mesh: Mesh, options: HealthBarOptions): void {
    const widthWorld = options.trackWidthPx / 36;
    const heightWorld = widthWorld / 8;
    const plane = CreatePlane(`hp-plane-${id}`, { width: widthWorld, height: heightWorld }, this.scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;

    const texture = AdvancedDynamicTexture.CreateForMesh(
      plane,
      options.trackWidthPx,
      16,
      false,
      false,
      undefined,
      (target, uniqueId, guiTexture) => {
        const mat = new StandardMaterial(`hp-plane-mat-${id}-${uniqueId}`, this.scene);
        mat.backFaceCulling = false;
        mat.diffuseColor = Color3.Black();
        mat.specularColor = Color3.Black();
        mat.emissiveTexture = guiTexture;
        mat.opacityTexture = guiTexture;
        target.material = mat;
      },
    );

    const track = new Rectangle(`hp-track-${id}`);
    track.width = "100%";
    track.height = "100%";
    track.thickness = 2;
    track.color = "rgba(255, 255, 255, 0.55)";
    track.background = "rgba(0, 0, 0, 0.65)";
    track.isHitTestVisible = false;

    const fill = new Rectangle(`hp-fill-${id}`);
    fill.width = "100%";
    fill.height = "100%";
    fill.thickness = 0;
    fill.background = options.color;
    fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    fill.isHitTestVisible = false;

    track.addControl(fill);
    texture.addControl(track);
    this.bars.set(id, { target: mesh, plane, texture, fill, offsetYWorld: Math.abs(options.offsetYPx) / 100 });
  }

  set(id: string, pct: number, visible: boolean): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    const clamped = clamp01(Number.isFinite(pct) ? pct : 0);
    bar.fill.width = `${clamped * 100}%`;
    bar.plane.isVisible = visible;
    this.syncPlane(bar);
  }

  private syncPlane(bar: HealthBar): void {
    if (!bar.plane.isVisible || bar.target.isDisposed()) return;
    bar.target.computeWorldMatrix(true);
    const bounds = bar.target.getBoundingInfo().boundingBox;
    const min = bounds.minimumWorld;
    const max = bounds.maximumWorld;
    bar.plane.position.set((min.x + max.x) / 2, max.y + bar.offsetYWorld, (min.z + max.z) / 2);
  }

  dispose(): void {
    for (const bar of this.bars.values()) {
      bar.texture.dispose();
      bar.plane.dispose();
    }
    this.bars.clear();
  }
}
