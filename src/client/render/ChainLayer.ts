import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveChain, Player } from "../../shared/types";
import { glyphBillboardMaterial } from "./meshes/billboardMaterials";

const ICON_Y = 3.2;   // height of the chain icon above a player
const LINE_Y = 1.0;   // height of the connecting tube
const RED = new Color3(1.0, 0.2, 0.2);
const GREEN = new Color3(0.3, 1.0, 0.4);
const WHITE = new Color3(1.0, 1.0, 1.0);

const iconKey = (chainId: string, playerId: string) => `${chainId}:${playerId}`;

export class ChainLayer {
  private icons = new Map<string, Mesh>(); // `${chainId}:${playerId}` -> billboard plane
  private lines = new Map<string, Mesh>(); // chainId -> tube
  private iconMaterial: StandardMaterial | null = null;

  constructor(private scene: Scene) {}

  sync(chains: ActiveChain[], players: Player[]): void {
    const playerMap = new Map(players.map(p => [p.id, p]));

    // Icons show only during the cast + connected phase (before break/burst).
    const wantIcons = new Set<string>();
    const wantLines = new Set<string>();
    for (const chain of chains) {
      if (chain.outcome === undefined) {
        if (playerMap.get(chain.a)?.alive) wantIcons.add(iconKey(chain.id, chain.a));
        if (playerMap.get(chain.b)?.alive) wantIcons.add(iconKey(chain.id, chain.b));
      }
      if (chain.resolved) wantLines.add(chain.id);
    }

    for (const [key, mesh] of this.icons) {
      if (!wantIcons.has(key)) { mesh.dispose(); this.icons.delete(key); }
    }
    for (const [id, line] of this.lines) {
      if (!wantLines.has(id)) { line.dispose(false, true); this.lines.delete(id); }
    }

    for (const chain of chains) {
      // Head icons over each chained player.
      if (chain.outcome === undefined) {
        for (const playerId of [chain.a, chain.b]) {
          const player = playerMap.get(playerId);
          if (!player?.alive) continue;
          const key = iconKey(chain.id, playerId);
          let icon = this.icons.get(key);
          if (!icon) {
            icon = CreatePlane(`chain-icon-${key}`, { size: 1.1 }, this.scene);
            icon.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
            icon.isPickable = false;
            icon.material = this.getIconMaterial();
            this.icons.set(key, icon);
          }
          icon.position.set(player.pos.x, ICON_Y, player.pos.z);
        }
      }

      // Connecting tube once the cast resolves; color signals the state/outcome.
      if (!chain.resolved) continue;
      const a = playerMap.get(chain.a);
      const b = playerMap.get(chain.b);
      const oldLine = this.lines.get(chain.id);
      if (!a || !b) {
        if (oldLine) { oldLine.dispose(false, true); this.lines.delete(chain.id); }
        continue;
      }

      const color = chain.outcome === "broken" ? GREEN : chain.outcome === "damaged" ? WHITE : RED;
      const points = [
        new Vector3(a.pos.x, LINE_Y, a.pos.z),
        new Vector3(b.pos.x, LINE_Y, b.pos.z),
      ];
      if (oldLine) {
        CreateTube(`${chain.id}-line`, { path: points, instance: oldLine });
        const mat = oldLine.material as StandardMaterial;
        mat.diffuseColor = color;
        mat.emissiveColor = color.scale(0.6);
      } else {
        const mat = new StandardMaterial(`mat-${chain.id}-line`, this.scene);
        mat.diffuseColor = color;
        mat.emissiveColor = color.scale(0.6);
        mat.specularColor = new Color3(0.05, 0.05, 0.05);
        const line = CreateTube(`${chain.id}-line`, {
          updatable: true,
          path: points,
          radius: 0.1,
          tessellation: 8,
          cap: BabylonMesh.CAP_ALL,
        }, this.scene);
        line.material = mat;
        line.isPickable = false;
        this.lines.set(chain.id, line);
      }
    }
  }

  private getIconMaterial(): StandardMaterial {
    if (this.iconMaterial) return this.iconMaterial;
    this.iconMaterial = glyphBillboardMaterial(this.scene, "chain-icon-mat", "chain-icon-tex", "⛓", "#ffd24a");
    return this.iconMaterial;
  }

  dispose(): void {
    for (const mesh of this.icons.values()) mesh.dispose();
    for (const line of this.lines.values()) line.dispose(false, true);
    this.icons.clear();
    this.lines.clear();
    this.iconMaterial?.dispose();
    this.iconMaterial = null;
  }
}
