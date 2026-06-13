import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveLineLink, Player } from "@shared/types";

const LINE_COLOR = new Color3(0.25, 0.85, 1.0);
const STATUE_COLOR = new Color3(0.45, 0.5, 0.58);

export class LineLinkLayer {
  private statues = new Map<string, Mesh>();
  private lines = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  sync(lineLinks: ActiveLineLink[], players: Player[], time: number): void {
    const activeIds = new Set(lineLinks.map(link => link.id));
    const playerMap = new Map(players.map(p => [p.id, p]));
    const activeLineIds = new Set<string>();
    for (const link of lineLinks) {
      if (link.resolved || time >= link.linkUntil) continue;
      for (const playerId of link.targetPlayerIds) {
        if (playerMap.get(playerId)?.alive) activeLineIds.add(lineKey(link.id, playerId));
      }
    }

    for (const [id, mesh] of this.statues) {
      if (!activeIds.has(id)) { mesh.dispose(false, true); this.statues.delete(id); }
    }
    for (const [id, line] of this.lines) {
      if (!activeLineIds.has(id)) { line.dispose(false, true); this.lines.delete(id); }
    }

    for (const link of lineLinks) {
      this.syncStatue(link, time);
      this.syncLines(link, playerMap, time);
    }
  }

  private syncStatue(link: ActiveLineLink, time: number): void {
    if (link.visual?.kind !== "statue") return;

    let statue = this.statues.get(link.id);
    if (!statue) {
      statue = CreateBox(`line-link-statue-${link.id}`, {
        width: link.visual.width,
        height: link.visual.height,
        depth: link.visual.depth,
      }, this.scene);
      const mat = new StandardMaterial(`mat-line-link-statue-${link.id}`, this.scene);
      mat.diffuseColor = STATUE_COLOR;
      mat.emissiveColor = STATUE_COLOR.scale(0.25);
      statue.material = mat;
      statue.isPickable = false;
      this.statues.set(link.id, statue);
    }

    statue.position.set(link.pos.x, link.visual.height / 2, link.pos.z);
    statue.rotation.y = Math.atan2(link.pos.x, link.pos.z);
    const mat = statue.material as StandardMaterial;
    mat.alpha = link.resolved ? Math.max(0, 1 - (time - link.resolveAt) / 0.7) : 1;
  }

  private syncLines(link: ActiveLineLink, playerMap: Map<string, Player>, time: number): void {
    if (link.resolved || time >= link.linkUntil) return;

    for (const playerId of link.targetPlayerIds) {
      const target = playerMap.get(playerId);
      if (!target?.alive) continue;

      const key = lineKey(link.id, playerId);
      const oldLine = this.lines.get(key);
      const points = [
        new Vector3(link.pos.x, 1.2, link.pos.z),
        new Vector3(target.pos.x, 1.2, target.pos.z),
      ];
      if (oldLine) {
        CreateTube(`${key}-line`, { path: points, instance: oldLine });
      } else {
        const mat = new StandardMaterial(`mat-line-link-${key}`, this.scene);
        mat.diffuseColor = LINE_COLOR;
        mat.emissiveColor = LINE_COLOR.scale(0.6);
        mat.specularColor = new Color3(0.05, 0.05, 0.05);
        const line = CreateTube(`${key}-line`, {
          updatable: true,
          path: points,
          radius: 0.08,
          tessellation: 8,
          cap: BabylonMesh.CAP_ALL,
        }, this.scene);
        line.material = mat;
        line.isPickable = false;
        this.lines.set(key, line);
      }
    }
  }

  dispose(): void {
    for (const mesh of this.statues.values()) mesh.dispose(false, true);
    for (const line of this.lines.values()) line.dispose(false, true);
    this.statues.clear();
    this.lines.clear();
  }
}

function lineKey(linkId: string, playerId: string): string {
  return `${linkId}:${playerId}`;
}
