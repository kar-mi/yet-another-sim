import type { World } from "../../shared/types";

export interface Renderer {
  init(world: World, sessionId: string): void;
  sync(world: World, alpha: number): void;
  render(): void;
  dispose(): void;
  getCameraYaw(): number;
}
