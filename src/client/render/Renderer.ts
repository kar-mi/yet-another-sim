import type { World } from "../../shared/types";

export interface Renderer {
  init(world: World): void;
  sync(world: World, alpha: number): void;
  dispose(): void;
  getCameraYaw(): number;
}
