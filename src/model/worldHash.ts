import type { World } from "./types";

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function worldHash(world: World): number {
  const { log, ...rest } = world;
  return fnv1a(JSON.stringify(rest));
}
