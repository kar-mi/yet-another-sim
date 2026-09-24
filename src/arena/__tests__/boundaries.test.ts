import { expect, test } from "bun:test";
import { Glob } from "bun";

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

async function importsOf(pattern: string): Promise<Array<{ file: string; specifier: string }>> {
  const found: Array<{ file: string; specifier: string }> = [];
  for await (const file of new Glob(pattern).scan(".")) {
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      found.push({ file: file.replaceAll("\\", "/"), specifier: match[1]! });
    }
  }
  return found;
}

test("@arena core does not import simulator or rendering code", async () => {
  const allowed = new Set(["zod", "@shared/math", "@shared/dmath", "@shared/schema"]);
  const offenders = (await importsOf("src/arena/*.ts")).flatMap(({ file, specifier }) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return new URL(specifier, `file:///${file}`).pathname.includes("/src/arena/") ? [] : [`${file} -> ${specifier}`];
    }
    return allowed.has(specifier) ? [] : [`${file} -> ${specifier}`];
  });
  expect(offenders).toEqual([]);
});

test("consumers use only public arena entry points", async () => {
  const allowed = new Set(["@arena", "@arena/schema", "@arena/babylon"]);
  const imports = [
    ...await importsOf("src/{engine,client,server,shared,model,effects,status}/**/*.ts"),
    ...await importsOf("scripts/**/*.ts"),
  ];
  const offenders = imports
    .filter(({ specifier }) => specifier.includes("/arena/") || specifier.startsWith("@arena"))
    .filter(({ specifier }) => !allowed.has(specifier))
    .map(({ file, specifier }) => `${file} -> ${specifier}`);
  expect(offenders).toEqual([]);
});

test("the engine does not import Babylon arena code", async () => {
  const offenders = (await importsOf("src/engine/**/*.ts"))
    .filter(({ specifier }) => specifier.startsWith("@babylonjs/") || specifier === "@arena/babylon")
    .map(({ file, specifier }) => `${file} -> ${specifier}`);
  expect(offenders).toEqual([]);
});
