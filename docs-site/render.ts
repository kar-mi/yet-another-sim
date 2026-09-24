export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface LinkRef {
  raw: string;
  repoPath: string;
  fragment: string;
  internal: boolean;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  links: LinkRef[];
  assets: string[];
  anchors: string[];
  fragments: string[];
}

export interface RenderOptions {
  source: string;
  urlBySource: Map<string, string>;
  repoFileUrl: (repoPath: string) => string;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function resolveRepoPath(fromSource: string, href: string): string {
  const base = href.startsWith("/") ? [] : fromSource.split("/").slice(0, -1);
  const parts = [...base, ...href.replace(/^\//, "").split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function addHeadingIds(html: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const out = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, levelText: string, inner: string) => {
    const level = Number(levelText);
    const text = plainText(inner);
    const base = slugify(text) || `section-${headings.length + 1}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen + 1}`;
    headings.push({ level, id, text });
    const permalink = `<a class="heading-anchor" href="#${id}" aria-label="Permalink to ${escapeHtml(text)}">#</a>`;
    return `<h${level} id="${id}">${inner}${permalink}</h${level}>`;
  });
  return { html: out, headings };
}

interface RewriteResult {
  html: string;
  links: LinkRef[];
  assets: string[];
}

function rewriteLinks(html: string, options: RenderOptions): RewriteResult {
  const links: LinkRef[] = [];
  const assets = new Set<string>();

  const resolveHref = (href: string, asAsset: boolean): string => {
    if (href === "" || href.startsWith("#") || EXTERNAL.test(href)) return href;
    const hashAt = href.indexOf("#");
    const rawPath = hashAt === -1 ? href : href.slice(0, hashAt);
    const fragment = hashAt === -1 ? "" : href.slice(hashAt + 1);
    if (rawPath === "") return href;

    const repoPath = resolveRepoPath(options.source, rawPath);
    const pageUrl = options.urlBySource.get(repoPath);
    if (pageUrl !== undefined) {
      links.push({ raw: href, repoPath, fragment, internal: true });
      return fragment === "" ? pageUrl : `${pageUrl}#${fragment}`;
    }

    if (asAsset || (repoPath.startsWith("docs/") && !repoPath.endsWith(".md"))) {
      assets.add(repoPath);
      links.push({ raw: href, repoPath, fragment, internal: true });
      return `/assets/${repoPath.replace(/^docs\//, "")}`;
    }

    links.push({ raw: href, repoPath, fragment, internal: false });
    return fragment === ""
      ? options.repoFileUrl(repoPath)
      : `${options.repoFileUrl(repoPath)}#${fragment}`;
  };

  let out = html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/g, (_m, pre: string, href: string, post: string) =>
    `${pre}${resolveHref(href, false)}${post}`);
  out = out.replace(/(<img\b[^>]*?\ssrc=")([^"]*)(")/g, (_m, pre: string, src: string, post: string) =>
    `${pre}${resolveHref(src, true)}${post}`);

  return { html: out, links, assets: [...assets] };
}

function markExternalLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)\shref="(https?:\/\/[^"]*)"([^>]*)>/g, (_m, pre: string, href: string, post: string) =>
    `<a${pre} href="${href}"${post} target="_blank" rel="noopener">`);
}

function wrapScrollables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

export function render(markdown: string, options: RenderOptions): RenderResult {
  const raw = Bun.markdown.html(markdown);
  const withIds = addHeadingIds(raw);
  const rewritten = rewriteLinks(withIds.html, options);
  const headingIds = new Set(withIds.headings.map(heading => heading.id));
  const anchors = [...withIds.html.matchAll(/<a\b[^>]*?\sid="([^"]+)"/g)].map(match => match[1]!);
  const fragments = [...rewritten.html.matchAll(/<a\b[^>]*?\shref="#([^"]+)"/g)]
    .map(match => match[1]!)
    .filter(fragment => !headingIds.has(fragment));
  return {
    html: wrapScrollables(markExternalLinks(rewritten.html)),
    headings: withIds.headings,
    links: rewritten.links,
    assets: rewritten.assets,
    anchors,
    fragments,
  };
}
