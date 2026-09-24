import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

export class KeyedMeshLayer<T extends { id: string }, H extends { all: Mesh[] }> {
  private handles = new Map<string, H>();

  constructor(private scene: Scene, private create: (scene: Scene, item: T) => H) {}

  sync(items: T[], update: (handle: H, item: T) => void): void {
    const activeIds = new Set(items.map(item => item.id));
    for (const [id, handle] of this.handles) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.handles.delete(id);
      }
    }

    for (const item of items) {
      let handle = this.handles.get(item.id);
      if (!handle) {
        handle = this.create(this.scene, item);
        this.handles.set(item.id, handle);
      }
      update(handle, item);
    }
  }

  dispose(): void {
    for (const handle of this.handles.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.handles.clear();
  }
}
