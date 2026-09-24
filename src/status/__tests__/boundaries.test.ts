import { expect, test } from "bun:test";
import { Glob } from "bun";

const IMPORT_STATEMENT = /^\s*(import|export)(\s+type)?\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const ALLOWED = new Set(["zod", "@shared/math", "@shared/dmath"]);
const TYPE_ONLY = new Set(["@effects"]);

async function sources(pattern: string, exclude: (file: string) => boolean): Promise<Array<{ file: string; source: string }>> {
  const found: Array<{ file: string; source: string }> = [];
  for await (const path of new Glob(pattern).scan(".")) {
    const file = path.replaceAll("\\", "/");
    if (!exclude(file)) found.push({ file, source: await Bun.file(path).text() });
  }
  return found;
}

const isTest = (file: string) => file.includes("/__tests__/") || file.endsWith(".test.ts");

test("@status imports only pure math, zod, type-only geometry and itself", async () => {
  const offenders: string[] = [];
  for (const { file, source } of await sources("src/status/**/*.ts", isTest)) {
    for (const [, , typeOnly, specifier] of source.matchAll(IMPORT_STATEMENT)) {
      if (specifier!.startsWith("./") || specifier!.startsWith("../")) {
        if (!new URL(specifier!, `file:///${file}`).pathname.includes("/src/status/")) offenders.push(`${file} -> ${specifier}`);
        continue;
      }
      if (ALLOWED.has(specifier!)) continue;
      if (TYPE_ONLY.has(specifier!) && typeOnly) continue;
      offenders.push(`${file} -> ${specifier}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("consumers use only the public @status and @status/schema entry points", async () => {
  const offenders = (await sources("src/{engine,client,server,shared,model,effects}/**/*.ts", () => false))
    .flatMap(({ file, source }) => [...source.matchAll(IMPORT_STATEMENT)]
      .map(match => match[3]!)
      .filter(specifier => /(^|\/)status\//.test(specifier) && specifier !== "@status/schema")
      .map(specifier => `${file} -> ${specifier}`));
  expect(offenders).toEqual([]);
});

test("status lists are only mutated by package operations", async () => {
  const mutation = /\.effects\s*=(?!=)|\.effects\.(push|splice|pop|shift|unshift|sort|reverse|fill|copyWithin)\(/;
  const offenders = (await sources("src/**/*.ts", file => file.startsWith("src/status/") || isTest(file)))
    .flatMap(({ file, source }) => source.split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => mutation.test(line))
      .map(({ index }) => `${file}:${index + 1}`));
  expect(offenders).toEqual([]);
});

test("consumers query status data but never switch on behavior kinds", async () => {
  const offenders = (await sources("src/**/*.ts", file => file.startsWith("src/status/") || isTest(file)))
    .flatMap(({ file, source }) => source.split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\bbehavior\.kind\b|\.behavior as\b/.test(line))
      .map(({ index }) => `${file}:${index + 1}`));
  expect(offenders).toEqual([]);
});
