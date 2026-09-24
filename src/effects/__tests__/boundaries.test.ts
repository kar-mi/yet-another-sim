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

test("@effects does not import simulator code", async () => {
  const offenders = (await importsOf("src/effects/**/*.ts"))
    .filter(({ specifier }) =>
      (specifier.startsWith("@shared/") && specifier !== "@shared/math")
      || /^(@|\.\.\/)*(src\/)?(client|engine|server)\//.test(specifier))
    .map(({ file, specifier }) => `${file} -> ${specifier}`);
  expect(offenders).toEqual([]);
});

test("the engine does not import rendering code", async () => {
  const offenders = (await importsOf("src/engine/**/*.ts"))
    .filter(({ specifier }) => specifier.startsWith("@babylonjs/") || specifier.startsWith("@effects/babylon"))
    .map(({ file, specifier }) => `${file} -> ${specifier}`);
  expect(offenders).toEqual([]);
});
