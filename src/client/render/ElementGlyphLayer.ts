import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import { createElementGlyph, type ElementGlyphHandle } from "./meshes/elementGlyphMeshes";

const DEFAULT_COLOR = "#ffffff";

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
        handle = createElementGlyph(this.scene, m.id, m.glyph!.kind!, m.color ?? DEFAULT_COLOR, m.glyph!.at);
        this.glyphs.set(key, handle);
      }
      handle.animate(time);
    }
  }

  dispose(): void {
    for (const handle of this.glyphs.values()) handle.root.dispose(false, true);
    this.glyphs.clear();
  }
}
