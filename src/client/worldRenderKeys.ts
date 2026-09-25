import type { World } from "@model/types";

export type WorldRenderKeys = {
  arena: string;
  waymarks: string;
  crystals: string;
};

const renderKeysByWorld = new WeakMap<World, WorldRenderKeys>();

export function computeWorldRenderKeys(world: World): WorldRenderKeys {
  return {
    arena: JSON.stringify(world.arena),
    waymarks: JSON.stringify(world.waymarks),
    crystals: JSON.stringify(world.crystals),
  };
}

export function getWorldRenderKeys(world: World): WorldRenderKeys | undefined {
  return renderKeysByWorld.get(world);
}

export function setWorldRenderKeys(world: World, keys: WorldRenderKeys): void {
  renderKeysByWorld.set(world, keys);
}
