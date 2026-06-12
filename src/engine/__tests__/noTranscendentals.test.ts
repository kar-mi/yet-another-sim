import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// Guard rail for deterministic lockstep: the simulation engine (src/engine) and the shared code it
// pulls in (src/shared) may only use IEEE-754 operations that are correctly-rounded on every JS
// engine. Math.sin/cos/atan2/... are implementation-defined and would silently desync clients, so
// they are banned here — use src/shared/dmath.ts instead. Date.now is banned because it is wall
// clock, not simulation state.
//
// Excluded: dmath.ts (the deterministic shim itself), rng.ts (its only nondeterminism is makeSeed,
// the per-pull seed source, minted once and shared with every client), and logger.ts (app-log
// timestamps, not simulation state).

const FORBIDDEN = /\bMath\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|log|hypot|random)\b|\bDate\.now\b/;
const SKIP = /(dmath\.ts|rng\.ts|logger\.ts|\.test\.ts)$|__tests__/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("engine and shared use only deterministic math", () => {
  const files = [...tsFiles("src/engine"), ...tsFiles("src/shared")]
    .filter(f => !SKIP.test(f.replace(/\\/g, "/")));
  const offenders: string[] = [];
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
