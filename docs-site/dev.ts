import { watch } from "node:fs";
import { join } from "node:path";
import { build, outputPathFor, ROOT } from "./build";
import { SITE } from "./site";

const outDir = join(ROOT, SITE.outDir);

async function rebuild(): Promise<void> {
  const started = Date.now();
  try {
    const result = await build();
    console.log(`docs: ${result.pages.length} pages in ${Date.now() - started}ms`);
  } catch (error) {
    console.error(`docs: build failed — ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rebuild();

let pending: ReturnType<typeof setTimeout> | null = null;
const schedule = () => {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => { pending = null; void rebuild(); }, 100);
};

for (const dir of ["docs", "docs-site", "src/client"]) {
  watch(join(ROOT, dir), { recursive: true }, schedule);
}

Bun.serve({
  port: SITE.devPort,
  async fetch(request) {
    const url = new URL(request.url);
    const candidates = url.pathname.endsWith("/")
      ? [outputPathFor(url.pathname)]
      : [url.pathname.slice(1), `${url.pathname.slice(1)}/index.html`];
    for (const candidate of candidates) {
      const file = Bun.file(join(outDir, candidate));
      if (await file.exists()) return new Response(file);
    }
    return new Response(Bun.file(join(outDir, "404.html")), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`docs: serving http://localhost:${SITE.devPort}`);
