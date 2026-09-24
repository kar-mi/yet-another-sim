import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "@model/types";
import { STATUS_ICON_ROOT } from "../staticBase";
import { createGlowRing, imageBillboardMaterial } from "@effects/babylon";

// Ring heights above the player’s feet.
const RING_HEIGHTS = [0.5, 0.8];
const RING_HEIGHT_STEP = 0.4; // spacing for any ring past the listed heights
const RADIUS = 0.7;
const THICKNESS = 0.05;
const ICON_SIZE = 0.4;
// Alternate icon bearings between rings (degrees clockwise from north).
const ICON_BEARINGS = [[180, 300, 60], [0, 120, 240]];

type RingState = { key: string; root: TransformNode };

// Stack effect rings with three element icons each; visibility follows the POV.
export class PlayerEffectRingLayer {
  private rings = new Map<string, RingState>();

  constructor(private scene: Scene) {}

  sync(players: Player[], time: number, isVisible: (player: Player) => boolean): void {
    for (const player of players) {
      // Build only for visible players: a ring set is 2 materials, a texture and 4 meshes each.
      const effects = player.alive && isVisible(player)
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
    }
  }

  private build(playerId: string, effects: Player["effects"]): TransformNode {
    const root = new TransformNode(`effect-rings-${playerId}`, this.scene);
    effects.forEach((effect, index) => {
      const last = RING_HEIGHTS.length - 1;
      const height = RING_HEIGHTS[Math.min(index, last)]! + Math.max(0, index - last) * RING_HEIGHT_STEP;
      const name = `effect-ring-${playerId}-${effect.id}`;
      const { mesh: torus } = createGlowRing(this.scene, name, {
        diameter: RADIUS * 2,
        thickness: THICKNESS,
        color: Color3.FromHexString(effect.ring!.color),
        tessellation: 64,
      });
      torus.position.y = height;
      torus.parent = root;

      const iconMaterial = imageBillboardMaterial(this.scene, `${name}-icon-mat`, `${STATUS_ICON_ROOT}/${effect.ring!.icon}`);
      ICON_BEARINGS[index % ICON_BEARINGS.length]!.forEach((bearing, i) => {
        const a = (bearing * Math.PI) / 180;
        const icon = CreatePlane(`${name}-icon-${i}`, { size: ICON_SIZE }, this.scene);
        icon.material = iconMaterial;
        icon.billboardMode = Mesh.BILLBOARDMODE_ALL;
        icon.position.set(Math.sin(a) * RADIUS, height, Math.cos(a) * RADIUS);
        icon.isPickable = false;
        icon.parent = root;
      });
    });
    return root;
  }

  dispose(): void {
    for (const state of this.rings.values()) state.root.dispose(false, true);
    this.rings.clear();
  }
}
