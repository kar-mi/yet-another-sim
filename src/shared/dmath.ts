// Deterministic transcendental math for the simulation engine.
//
// JS engines (V8, SpiderMonkey, JSC) are NOT required to agree bit-for-bit on Math.sin/cos/
// atan2/acos — they are implementation-defined. For server-relayed deterministic lockstep, every
// client must compute byte-identical worlds from the same inputs, so the engine may only use the
// IEEE-754 operations that ARE mandated to be correctly rounded: +, -, *, /, comparisons, and
// Math.sqrt/floor/abs. These polynomial approximations are built purely from those, so they
// produce identical results on every engine. Accuracy (~1e-9) is far beyond gameplay needs; the
// guarantee that matters is cross-engine reproducibility.

const PI = Math.PI;
const TWO_PI = 2 * PI;
const HALF_PI = PI / 2;
const PI_6 = PI / 6;
const SQRT3 = Math.sqrt(3); // sqrt is IEEE-correctly-rounded => deterministic
const TAN_PI_12 = 2 - SQRT3; // tan(15°) ≈ 0.2679, the atan reduction threshold

// sin on [-PI/2, PI/2] via odd Taylor series through x^13 (truncation error ~6e-10 at the edge).
function sinCore(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
}

export function sin(x: number): number {
  // Reduce to (-PI, PI], then reflect into [-PI/2, PI/2] (sin is symmetric about ±PI/2).
  let r = x - TWO_PI * Math.floor(x / TWO_PI + 0.5);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

// atan on |z| <= tan(15°) via odd Taylor series through z^13 (error ~2e-10 at the edge).
function atanCore(z: number): number {
  const z2 = z * z;
  return z * (1 + z2 * (-1 / 3 + z2 * (1 / 5 + z2 * (-1 / 7 + z2 * (1 / 9 + z2 * (-1 / 11 + z2 * (1 / 13)))))));
}

// atan for x in [0, 1], reducing arguments above tan(15°) via atan(x) = PI/6 + atan((√3·x−1)/(x+√3)).
function atanUnit(x: number): number {
  if (x > TAN_PI_12) return PI_6 + atanCore((SQRT3 * x - 1) / (x + SQRT3));
  return atanCore(x);
}

function atan(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const r = ax > 1 ? HALF_PI - atanUnit(1 / ax) : atanUnit(ax);
  return sign * r;
}

// Matches Math.atan2 semantics (including the signed-zero-free cases the engine relies on).
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function acos(x: number): number {
  return atan2(Math.sqrt(1 - x * x), x);
}
