import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import { elementRingRadius } from "@shared/elementRing";
import { createElementGlyph, type ElementGlyphHandle } from "./meshes/elementGlyphMeshes";

// Ring and glyphs share one height so the glyphs sit on the ring line.
const RING_Y = 2.0;
const RING_COLOR = "#ffffff";
const TUBE_RADIUS = 0.08;
const SEGMENTS = 96;
const GLYPH_SCALE = 0.5;
// Glyphs sit at the six platform bearings (clockwise from north).
const GLYPH_BEARINGS = [0, 60, 120, 180, 240, 300].map(deg => deg * Math.PI / 180);
const DEFAULT_COLOR = "#ffffff";

type RingHandle = { tube: Mesh; glyphs: ElementGlyphHandle[] };

function circlePath(cx: number, cz: number, radius: number): Vector3[] {
  return Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const a = (i / SEGMENTS) * Math.PI * 2;
    return new Vector3(cx + Math.sin(a) * radius, RING_Y, cz + Math.cos(a) * radius);
  });
}

// Draws each unresolved mechanic's `ring` (see ElementRing): a white outline circle growing over the
// cast, with six element glyphs (in the mechanic's color) riding on it.
export class ElementRingLayer {
  private rings = new Map<string, RingHandle>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    const wanted = new Map<string, ActiveMechanic>();
    for (const m of mechanics) {
      if (m.resolved || !m.ring) continue;
      wanted.set(`${m.id}|${m.ring.kind ?? ""}|${m.color ?? DEFAULT_COLOR}`, m);
    }

    for (const [key, handle] of this.rings) {
      if (!wanted.has(key)) {
        this.disposeHandle(handle);
        this.rings.delete(key);
      }
    }

    for (const [key, m] of wanted) {
      const ring = m.ring!;
      const color = m.color ?? DEFAULT_COLOR;
      // Keep a visible minimum so the tube builder never gets a degenerate zero-radius path.
      const radius = Math.max(0.05, elementRingRadius(ring, m.telegraphStart, m.resolveAt, time));
      const path = circlePath(ring.center.x, ring.center.z, radius);

      let handle = this.rings.get(key);
      if (!handle) {
        const tube = CreateTube(`ring-${m.id}`, { path, radius: TUBE_RADIUS, tessellation: 6, cap: 0, updatable: true }, this.scene);
        const mat = new StandardMaterial(`ring-mat-${m.id}`, this.scene);
        mat.diffuseColor = Color3.FromHexString(RING_COLOR);
        mat.emissiveColor = mat.diffuseColor.clone();
        mat.specularColor = new Color3(0, 0, 0);
        mat.disableLighting = true;
        tube.material = mat;
        tube.isPickable = false;
        const glyphs = ring.kind
          ? GLYPH_BEARINGS.map((_, i) => createElementGlyph(this.scene, `${m.id}-${i}`, ring.kind!, color, ring.center, GLYPH_SCALE))
          : [];
        handle = { tube, glyphs };
        this.rings.set(key, handle);
      } else {
        CreateTube(`ring-${m.id}`, { path, radius: TUBE_RADIUS, instance: handle.tube }, this.scene);
      }

      handle.glyphs.forEach((glyph, i) => {
        const a = GLYPH_BEARINGS[i]!;
        glyph.root.position.x = ring.center.x + Math.sin(a) * radius;
        glyph.root.position.y = RING_Y;
        glyph.root.position.z = ring.center.z + Math.cos(a) * radius;
        glyph.animate(time);
      });
    }
  }

  dispose(): void {
    for (const handle of this.rings.values()) this.disposeHandle(handle);
    this.rings.clear();
  }

  private disposeHandle(handle: RingHandle): void {
    handle.tube.dispose(false, true);
    for (const glyph of handle.glyphs) glyph.root.dispose(false, true);
  }
}
