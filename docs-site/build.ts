import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PAGES } from "./nav";
import { render, type Heading, type LinkRef } from "./render";
import { renderNotFound, renderPage, renderSitemap } from "./template";
import { SITE, repoFileUrl } from "./site";

export const ROOT = resolve(import.meta.dir, "..");

export interface BuiltPage {
  url: string;
  source: string;
  outFile: string;
  headings: Heading[];
  links: LinkRef[];
  anchors: string[];
  fragments: string[];
}

export interface BuildResult {
  outDir: string;
  pages: BuiltPage[];
  assets: string[];
}

const urlBySource = new Map(PAGES.map(page => [page.source, page.url]));

export function outputPathFor(url: string): string {
  const trimmed = url.replace(/^\//, "").replace(/\/$/, "");
  return trimmed === "" ? "index.html" : `${trimmed}/index.html`;
}

async function writeOut(outDir: string, relativePath: string, contents: string): Promise<void> {
  const target = join(outDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

export async function build(): Promise<BuildResult> {
  const outDir = join(ROOT, SITE.outDir);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const pages: BuiltPage[] = [];
  const assets = new Set<string>();

  for (const page of PAGES) {
    const sourcePath = join(ROOT, page.source);
    let markdown: string;
    try {
      markdown = await readFile(sourcePath, "utf8");
    } catch {
      throw new Error(`Missing source for ${page.url}: ${page.source} (listed in docs-site/nav.ts)`);
    }
    const result = render(markdown, { source: page.source, urlBySource, repoFileUrl });
    for (const asset of result.assets) assets.add(asset);
    const outFile = outputPathFor(page.url);
    await writeOut(outDir, outFile, renderPage({ page, body: result.html, headings: result.headings }));
    pages.push({
      url: page.url,
      source: page.source,
      outFile,
      headings: result.headings,
      links: result.links,
      anchors: result.anchors,
      fragments: result.fragments,
    });
  }

  for (const asset of assets) {
    const target = join(outDir, "assets", asset.replace(/^docs\//, ""));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(ROOT, asset), target);
  }

  await mkdir(join(outDir, "assets"), { recursive: true });
  await copyFile(join(ROOT, "src/client/style-tokens.css"), join(outDir, "assets", "tokens.css"));
  await copyFile(join(ROOT, "docs-site/styles/docs.css"), join(outDir, "assets", "docs.css"));

  await writeOut(outDir, "404.html", renderNotFound());
  await writeOut(outDir, "sitemap.xml", renderSitemap());
  await writeOut(outDir, "robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE.origin}/sitemap.xml\n`);

  return { outDir, pages, assets: [...assets] };
}

if (import.meta.main) {
  const result = await build();
  console.log(`docs: built ${result.pages.length} pages and ${result.assets.length} assets into ${SITE.outDir}/`);
}
