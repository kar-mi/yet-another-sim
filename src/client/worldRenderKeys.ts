import type { World } from "@shared/types";

export type WorldRenderKeys = {
  arena: string;
  waymarks: string;
};

export const WORLD_RENDER_KEYS: unique symbol = Symbol("yas.worldRenderKeys");

type KeyedWorld = World & { [WORLD_RENDER_KEYS]?: WorldRenderKeys };

export function computeWorldRenderKeys(world: World): WorldRenderKeys {
  return {
    arena: JSON.stringify(world.arena),
    waymarks: JSON.stringify(world.waymarks),
  };
}

export function getWorldRenderKeys(world: World): WorldRenderKeys | undefined {
  return (world as KeyedWorld)[WORLD_RENDER_KEYS];
}

export function setWorldRenderKeys(world: World, keys: WorldRenderKeys): void {
  (world as KeyedWorld)[WORLD_RENDER_KEYS] = keys;
}
