import type { World } from "./types";

// FNV-1a 32-bit string hash. Pure integer ops => identical on every engine.
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A stable fingerprint of a simulated world, used to detect lockstep desync across clients.
// `log` is excluded: it is render-only event history (cleared server-side, accumulated client-side)
// and not part of the simulated state. Key order in JSON.stringify is deterministic because every
// client runs identical code that builds objects in the same order.
export function worldHash(world: World): number {
  const { log, ...rest } = world;
  return fnv1a(JSON.stringify(rest));
}
