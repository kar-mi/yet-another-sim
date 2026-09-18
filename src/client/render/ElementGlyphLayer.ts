import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import { moverPosition } from "@shared/mover";
import { createElementGlyph, type ElementGlyphHandle } from "./meshes/elementGlyphMeshes";

const DEFAULT_COLOR = "#ffffff";
// A glyph with a `mover` is a smaller copy that grows in over GROW_IN seconds, then rides the mover.
const MOVING_SCALE = 0.5;
const GROW_IN = 1;

// Draws each unresolved mechanic's `glyph` (see ElementGlyph). Keyed by id + kind + color so a new
// pull that re-rolls the element under the same id rebuilds the mesh.
export class ElementGlyphLayer {
  private glyphs = new Map<string, ElementGlyphHandle>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    const wanted = new Map<string, ActiveMechanic>();
    for (const m of mechanics) {
      if (m.resolved || !m.glyph?.kind) continue;
      wanted.set(`${m.id}|${m.glyph.kind}|${m.color ?? DEFAULT_COLOR}`, m);
    }

    for (const [key, handle] of this.glyphs) {
      if (!wanted.has(key)) {
        handle.root.dispose(false, true);
        this.glyphs.delete(key);
      }
    }

    for (const [key, m] of wanted) {
      let handle = this.glyphs.get(key);
      if (!handle) {
        handle = createElementGlyph(this.scene, m.id, m.glyph!.kind!, m.color ?? DEFAULT_COLOR, m.glyph!.at, m.mover ? MOVING_SCALE : 1);
        this.glyphs.set(key, handle);
      }
      if (m.mover && (m.shape.kind === "circle" || m.shape.kind === "donut")) {
        const pos = moverPosition(m.mover, m.shape.center, m.resolveAt, time);
        handle.root.position.x = pos.x;
        handle.root.position.z = pos.z;
        handle.root.scaling.setAll(MOVING_SCALE * Math.min(1, Math.max(0, (time - m.telegraphStart) / GROW_IN)));
      }
      handle.animate(time);
    }
  }

  dispose(): void {
    for (const handle of this.glyphs.values()) handle.root.dispose(false, true);
    this.glyphs.clear();
  }
}
