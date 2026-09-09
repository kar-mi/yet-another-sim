import { access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { build, outputPathFor, ROOT, type BuiltPage } from "./build";
import { NAV, PAGES, UNPUBLISHED } from "./nav";
import { loadSessionRaid } from "../src/server/sessionRaid";

interface Problem {
  where: string;
  message: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function markdownFilesUnderDocs(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) found.push(relative(ROOT, full).replaceAll("\\", "/"));
    }
  };
  await walk(join(ROOT, "docs"));
  return found;
}

function checkNav(problems: Problem[]): void {
  const seenUrl = new Map<string, string>();
  const seenSource = new Map<string, string>();
  const seenOutput = new Map<string, string>();
  for (const section of NAV) {
    for (const page of section.pages) {
      if (!page.url.startsWith("/") || !page.url.endsWith("/")) {
        problems.push({ where: page.source, message: `nav url must start and end with "/" (got "${page.url}")` });
      }
      if (page.description.trim() === "") {
        problems.push({ where: page.source, message: "nav entry has an empty description" });
      }
      const url = seenUrl.get(page.url);
      if (url) problems.push({ where: page.source, message: `duplicate site URL "${page.url}" (also ${url})` });
      seenUrl.set(page.url, page.source);

      const source = seenSource.get(page.source);
      if (source) problems.push({ where: page.source, message: `source published twice (also at ${source})` });
      seenSource.set(page.source, page.url);

      const outFile = outputPathFor(page.url);
      const output = seenOutput.get(outFile);
      if (output) problems.push({ where: page.source, message: `output file "${outFile}" collides with ${output}` });
      seenOutput.set(outFile, page.source);
    }
  }
}

async function checkUnpublished(problems: Problem[]): Promise<void> {
  const published = new Set([...PAGES.map(page => page.source), ...UNPUBLISHED]);
  for (const file of await markdownFilesUnderDocs()) {
    if (!published.has(file)) {
      problems.push({ where: file, message: "Markdown file under docs/ is not listed in docs-site/nav.ts" });
    }
  }
}

async function checkLinks(problems: Problem[], pages: BuiltPage[], assets: string[]): Promise<void> {
  const anchorsByUrl = new Map(pages.map(page =>
    [page.url, new Set([...page.headings.map(heading => heading.id), ...page.anchors])]));
  const urlBySource = new Map(PAGES.map(page => [page.source, page.url]));

  for (const page of pages) {
    for (const link of page.links) {
      if (!(await exists(join(ROOT, link.repoPath)))) {
        problems.push({ where: page.source, message: `link target does not exist in the repository: ${link.raw}` });
        continue;
      }
      if (!link.internal || link.fragment === "") continue;
      const targetUrl = urlBySource.get(link.repoPath);
      if (targetUrl === undefined) continue;
      const anchors = anchorsByUrl.get(targetUrl);
      if (!anchors?.has(link.fragment)) {
        problems.push({ where: page.source, message: `link "${link.raw}" points at a heading that does not exist on ${targetUrl}` });
      }
    }
    const ownAnchors = anchorsByUrl.get(page.url)!;
    for (const fragment of page.fragments) {
      if (!ownAnchors.has(fragment)) {
        problems.push({ where: page.source, message: `in-page link "#${fragment}" has no matching heading` });
      }
    }
  }

  for (const asset of assets) {
    if (!(await exists(join(ROOT, "dist/docs/assets", asset.replace(/^docs\//, ""))))) {
      problems.push({ where: asset, message: "referenced asset was not copied into the output" });
    }
  }
}

async function checkReferencedRaids(problems: Problem[], pages: BuiltPage[]): Promise<void> {
  const raidsDir = join(ROOT, "raids");
  const referenced = new Map<string, string>();
  for (const page of pages) {
    for (const link of page.links) {
      const match = /^raids\/([^/]+\/[^/]+)\.ya?ml$/.exec(link.repoPath);
      if (!match || match[1]!.endsWith("-bots") || match[1]!.endsWith("raid_info")) continue;
      referenced.set(match[1]!, page.source);
    }
  }
  for (const [raidId, where] of referenced) {
    try {
      await loadSessionRaid(raidId, raidsDir);
    } catch (error) {
      problems.push({ where, message: `referenced raid ${raidId} failed to load: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}

async function checkOutput(problems: Problem[], pages: BuiltPage[]): Promise<void> {
  for (const page of pages) {
    if (!(await exists(join(ROOT, "dist/docs", page.outFile)))) {
      problems.push({ where: page.source, message: `expected output ${page.outFile} is missing` });
    }
  }
  for (const file of ["404.html", "sitemap.xml", "assets/docs.css", "assets/tokens.css"]) {
    if (!(await exists(join(ROOT, "dist/docs", file)))) {
      problems.push({ where: "docs-site/build.ts", message: `expected output ${file} is missing` });
    }
  }
}

export async function check(): Promise<Problem[]> {
  const problems: Problem[] = [];
  checkNav(problems);
  await checkUnpublished(problems);
  const result = await build();
  await checkOutput(problems, result.pages);
  await checkLinks(problems, result.pages, result.assets);
  await checkReferencedRaids(problems, result.pages);
  return problems;
}

if (import.meta.main) {
  const problems = await check();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${problem.where}: ${problem.message}`);
    console.error(`\ndocs:check failed with ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log("docs:check passed.");
}
