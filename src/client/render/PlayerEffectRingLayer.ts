import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "@shared/types";
import { STATIC_ROOT } from "../staticBase";
import { imageBillboardMaterial } from "./meshes/billboardMaterials";

// Heights above the player's feet: the first ring floats at the knees, the second at the chest.
const RING_HEIGHTS = [0.5, 1.3];
const RING_HEIGHT_STEP = 0.4; // spacing for any ring past the listed heights
const RADIUS = 0.7;
const THICKNESS = 0.05;
const ICON_SIZE = 0.4;

type RingState = { key: string; root: TransformNode };

// Draws a thin colored ring floating around each player for every active effect with a `ring`, each
// at its own height (knees, then chest) so they never overlap, with its element icon as a billboard
// on the ring's east point.
export class PlayerEffectRingLayer {
  private rings = new Map<string, RingState>();

  constructor(private scene: Scene) {}

  sync(players: Player[], time: number, isVisible: (player: Player) => boolean): void {
    for (const player of players) {
      const effects = player.alive
        ? player.effects.filter(effect => effect.ring && effect.appliedAt + effect.duration > time)
        : [];
      const key = effects.map(effect => `${effect.id}:${effect.ring!.color}:${effect.ring!.icon}`).join("|");
      let state = this.rings.get(player.id);
      if (state?.key !== key) {
        state?.root.dispose(false, true);
        this.rings.delete(player.id);
        state = effects.length > 0 ? { key, root: this.build(player.id, effects) } : undefined;
        if (state) this.rings.set(player.id, state);
      }
      if (!state) continue;
      state.root.position.set(player.pos.x, player.y, player.pos.z);
      state.root.setEnabled(isVisible(player));
    }
  }

  private build(playerId: string, effects: Player["effects"]): TransformNode {
    const root = new TransformNode(`effect-rings-${playerId}`, this.scene);
    effects.forEach((effect, index) => {
      const last = RING_HEIGHTS.length - 1;
      const height = RING_HEIGHTS[Math.min(index, last)]! + Math.max(0, index - last) * RING_HEIGHT_STEP;
      const name = `effect-ring-${playerId}-${effect.id}`;
      const color = Color3.FromHexString(effect.ring!.color);
      const material = new StandardMaterial(`${name}-mat`, this.scene);
      material.diffuseColor = color;
      material.emissiveColor = color;
      material.disableLighting = true;
      const torus = CreateTorus(name, { diameter: RADIUS * 2, thickness: THICKNESS, tessellation: 64 }, this.scene);
      torus.position.y = height;
      torus.material = material;
      torus.isPickable = false;
      torus.parent = root;

      const icon = CreatePlane(`${name}-icon`, { size: ICON_SIZE }, this.scene);
      icon.material = imageBillboardMaterial(this.scene, `${name}-icon-mat`, `${STATIC_ROOT}/element_icons/${effect.ring!.icon}`);
      icon.billboardMode = Mesh.BILLBOARDMODE_ALL;
      icon.position.set(RADIUS, height, 0);
      icon.isPickable = false;
      icon.parent = root;
    });
    return root;
  }

  dispose(): void {
    for (const state of this.rings.values()) state.root.dispose(false, true);
    this.rings.clear();
  }
}
