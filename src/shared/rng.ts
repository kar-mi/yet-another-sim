export function makeSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

export function nextRandom(state: number): { value: number; state: number } {
  let s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

export function randomInt(state: number, n: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * n), state: r.state };
}
