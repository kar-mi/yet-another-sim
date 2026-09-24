import type { World } from "@model/types";
import type { PlaybackState } from "@model/protocol";

export interface Renderer {
  init(world: World, sessionId: string, localPlayerId?: string | null): void;
  sync(world: World): void;
  setPlaybackState(state: PlaybackState): void;
  render(): void;
  dispose(): void;
  getCameraYaw(): number;
  applyControllerPan(dx: number, dy: number, dt: number): void;
  rotateCameraYaw(delta: number): void;
  getPanButtons(): { left: boolean; right: boolean };
}
