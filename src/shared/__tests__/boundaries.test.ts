import { expect, test } from "bun:test";
import { Glob } from "bun";

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

test("@shared imports only zod and other @shared modules", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("src/shared/*.ts").scan(".")) {
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1]!;
      if (specifier === "zod" || specifier.startsWith("./")) continue;
      offenders.push(`${file.replaceAll("\\", "/")} -> ${specifier}`);
    }
  }
  expect(offenders).toEqual([]);
});
