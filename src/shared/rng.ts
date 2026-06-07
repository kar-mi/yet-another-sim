// Tiny seeded PRNG (mulberry32). Deterministic given a seed; the state is threaded through the
// World so a pull's randomness is reproducible (and identical on server + serialized clients).

// A fresh 32-bit seed for a new pull.
export function makeSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

// Advance the state, returning a float in [0, 1) plus the next state.
export function nextRandom(state: number): { value: number; state: number } {
  let s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

// Advance the state, returning an integer in [0, n) plus the next state.
export function randomInt(state: number, n: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * n), state: r.state };
}
