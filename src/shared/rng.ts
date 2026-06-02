// Seeded PRNG (mulberry32). State is a plain number so the World stays
// JSON-serializable and the sim stays deterministic given the same seed.

//TODO - swap this

export function nextRng(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

export function rngInt(state: number, n: number): { index: number; state: number } {
  const { value, state: next } = nextRng(state);
  return { index: Math.floor(value * n), state: next };
}
