import { describe, expect, test } from "bun:test";
import { addHeadingIds, render, resolveRepoPath, slugify } from "./render";
import { outputPathFor } from "./build";
import { NAV, PAGES } from "./nav";
import { repoFileUrl } from "./site";

const urlBySource = new Map([
  ["docs/index.md", "/"],
  ["docs/raids/black-hole.md", "/raids/black-hole/"],
  ["docs/authoring-raids.md", "/authoring/raids/"],
]);

function renderMd(markdown: string, source = "docs/raids/black-hole.md") {
  return render(markdown, { source, urlBySource, repoFileUrl });
}

describe("slugify", () => {
  test("keeps contents links matching heading ids", () => {
    expect(slugify("Towers 1-2 (A side)")).toBe("towers-1-2-a-side");
    expect(slugify("`tower` — soak circle")).toBe("tower--soak-circle");
  });
});

describe("addHeadingIds", () => {
  test("gives repeated headings distinct ids", () => {
    const result = addHeadingIds("<h2>Towers</h2><h2>Towers</h2><h2>Towers</h2>");
    expect(result.headings.map(heading => heading.id)).toEqual(["towers", "towers-2", "towers-3"]);
    expect(result.html).toContain('<h2 id="towers-2">');
  });

  test("uses the heading text, not its inline markup, for the id", () => {
    const result = addHeadingIds("<h3><code>spread_stack</code> events</h3>");
    expect(result.headings[0]).toMatchObject({ id: "spread_stack-events", level: 3 });
  });
});

describe("resolveRepoPath", () => {
  test("resolves relative and root-relative hrefs", () => {
    expect(resolveRepoPath("docs/raids/black-hole.md", "../workflow.md")).toBe("docs/workflow.md");
    expect(resolveRepoPath("docs/raids/black-hole.md", "./forsaken.md")).toBe("docs/raids/forsaken.md");
    expect(resolveRepoPath("docs/index.md", "/raids/debug/authoring-demo.yaml")).toBe("raids/debug/authoring-demo.yaml");
  });
});

describe("link rewriting", () => {
  test("published Markdown becomes a site URL and keeps its fragment", () => {
    const result = renderMd("[towers](../authoring-raids.md#tower--soak-circle)");
    expect(result.html).toContain('href="/authoring/raids/#tower--soak-circle"');
    expect(result.links[0]).toMatchObject({ internal: true, fragment: "tower--soak-circle" });
  });

  test("repository sources become GitHub links", () => {
    const result = renderMd("[yaml](../../raids/dancing-mad-ultimate/black-hole.yaml)");
    expect(result.html).toContain(repoFileUrl("raids/dancing-mad-ultimate/black-hole.yaml"));
    expect(result.links[0]).toMatchObject({ internal: false, repoPath: "raids/dancing-mad-ultimate/black-hole.yaml" });
  });

  test("external and in-page links are left alone", () => {
    const result = renderMd("[x](https://example.com) [y](#towers)");
    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain('href="#towers"');
    expect(result.links).toHaveLength(0);
  });

  test("non-Markdown files under docs/ are collected as assets", () => {
    const result = renderMd("![arena](./img/arena.svg)");
    expect(result.assets).toEqual(["docs/raids/img/arena.svg"]);
    expect(result.html).toContain('src="/assets/raids/img/arena.svg"');
  });
});

describe("escaping", () => {
  test("code examples stay escaped", () => {
    const result = renderMd("```yaml\nshape: <script>alert(1)</script>\n```");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toContain("<script>alert(1)</script>");
  });
});

describe("nav manifest", () => {
  test("every page has a unique url, source and output path", () => {
    expect(new Set(PAGES.map(page => page.url)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map(page => page.source)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map(page => outputPathFor(page.url))).size).toBe(PAGES.length);
  });

  test("every source is a Markdown file under docs/", () => {
    for (const page of PAGES) {
      expect(page.source.startsWith("docs/") && page.source.endsWith(".md")).toBe(true);
    }
  });

  test("sections are non-empty", () => {
    for (const section of NAV) expect(section.pages.length).toBeGreaterThan(0);
  });
});

describe("outputPathFor", () => {
  test("maps directory URLs onto index.html", () => {
    expect(outputPathFor("/")).toBe("index.html");
    expect(outputPathFor("/raids/black-hole/")).toBe("raids/black-hole/index.html");
  });
});
