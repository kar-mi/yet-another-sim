import { NAV, PAGES, sectionOf, type NavPage, type NavSection } from "./nav";
import { SITE } from "./site";
import { escapeHtml, type Heading } from "./render";

export interface PageContext {
  page: NavPage;
  body: string;
  headings: Heading[];
}

function sectionList(section: NavSection, current: NavPage | null): string {
  const items = section.pages.map(page => {
    const active = page === current ? ' class="is-active" aria-current="page"' : "";
    return `<li><a href="${page.url}"${active}>${escapeHtml(page.title)}</a></li>`;
  }).join("");
  return `<div class="nav-section"><div class="nav-section-title">${escapeHtml(section.title)}</div><ul>${items}</ul></div>`;
}

function navList(current: NavPage | null): string {
  const sections = current === null ? NAV : [sectionOf(current)];
  return sections.map(section => sectionList(section, current)).join("");
}

function topNav(current: NavPage | null): string {
  const items = NAV.map(section => {
    const landing = section.pages[0]!;
    const active = current !== null && section.pages.includes(current)
      ? ' class="is-active" aria-current="true"'
      : "";
    if (section.pages.length < 2) {
      return `<li class="topnav-item"><a href="${landing.url}"${active}>${escapeHtml(section.title)}</a></li>`;
    }
    const menu = section.pages.map(page => {
      const pageActive = page === current ? ' class="is-active"' : "";
      return `<li><a href="${page.url}"${pageActive}>${escapeHtml(page.title)}</a></li>`;
    }).join("");
    return `<li class="topnav-item">`
      + `<a href="${landing.url}"${active}>${escapeHtml(section.title)}`
      + `<span class="topnav-caret" aria-hidden="true">▾</span></a>`
      + `<ul class="topnav-menu">${menu}</ul></li>`;
  }).join("");
  return `<nav class="topnav" aria-label="Sections"><ul>${items}</ul></nav>`;
}

function contentsList(headings: Heading[]): string {
  const entries = headings.filter(heading => heading.level === 2 || heading.level === 3);
  if (entries.length < 2) return "";
  const items = entries.map(heading =>
    `<li class="depth-${heading.level}"><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`).join("");
  return `      <details class="contents collapsible" open>
        <summary>On this page</summary>
        <nav class="collapsible-body" aria-label="On this page"><ul>${items}</ul></nav>
      </details>`;
}

function breadcrumbs(page: NavPage): string {
  const section = sectionOf(page);
  const home = PAGES[0]!;
  if (page === home) return "";
  const trail = [`<a href="${home.url}">${escapeHtml(SITE.shortTitle)}</a>`, `<span>${escapeHtml(section.title)}</span>`];
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${trail.join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
}

function pager(page: NavPage): string {
  const index = PAGES.indexOf(page);
  const previous = index > 0 ? PAGES[index - 1] : undefined;
  const next = index < PAGES.length - 1 ? PAGES[index + 1] : undefined;
  const link = (target: NavPage | undefined, rel: "prev" | "next", label: string) => target
    ? `<a class="pager-link pager-${rel}" href="${target.url}" rel="${rel}"><span class="pager-label">${label}</span><span class="pager-title">${escapeHtml(target.title)}</span></a>`
    : "<span></span>";
  return `<nav class="pager" aria-label="Pagination">${link(previous, "prev", "Previous")}${link(next, "next", "Next")}</nav>`;
}

const COPY_SCRIPT = `
for (const block of document.querySelectorAll("main pre")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-btn";
  button.textContent = "COPY";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(block.querySelector("code")?.innerText ?? block.innerText);
      button.textContent = "COPIED";
    } catch {
      button.textContent = "FAILED";
    }
    setTimeout(() => { button.textContent = "COPY"; }, 1500);
  });
  block.appendChild(button);
}`.trim();

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  current: NavPage | null;
  headings: Heading[];
  main: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}">
  <link rel="canonical" href="${options.canonical}">
  <meta property="og:title" content="${escapeHtml(options.title)}">
  <meta property="og:description" content="${escapeHtml(options.description)}">
  <meta property="og:url" content="${options.canonical}">
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Jersey+10&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
  <a class="skip-link" href="#article">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="/">${escapeHtml(SITE.shortTitle)}<span class="brand-sub">DOCS</span></a>
    ${topNav(options.current)}
    <div class="topbar-actions">
      <a class="topbar-link" href="${SITE.repoUrl}" target="_blank" rel="noopener">GitHub</a>
      <a class="topbar-cta" href="${SITE.simulatorUrl}" target="_blank" rel="noopener">Open simulator</a>
    </div>
  </header>
  <div class="layout">
    <div class="rail">
      <details class="sidebar collapsible" open>
        <summary>${escapeHtml(options.current === null ? "Documentation" : sectionOf(options.current).title)}</summary>
        <nav class="collapsible-body" aria-label="Section">${navList(options.current)}</nav>
      </details>
${contentsList(options.headings)}
    </div>
${options.main}
  </div>
  <footer class="sitefoot">
    <span>Yet Another Sim &mdash; raid mechanics practice sandbox.</span>
    <a href="${SITE.repoUrl}" target="_blank" rel="noopener">Source on GitHub</a>
  </footer>
  <script>${COPY_SCRIPT}</script>
</body>
</html>
`;
}

export function renderPage(context: PageContext): string {
  const { page, body, headings } = context;
  const canonical = new URL(page.url, SITE.origin).href;
  const title = page.url === "/" ? SITE.title : `${page.title} — ${SITE.shortTitle}`;
  const main = `    <main id="article" class="article">
      ${breadcrumbs(page)}
      <article>
${body}
      </article>
      ${pager(page)}
    </main>`;
  return shell({ title, description: page.description, canonical, current: page, headings, main });
}

export function renderNotFound(): string {
  const main = `    <main id="article" class="article">
      <article>
        <h1>Page not found</h1>
        <p>That documentation page does not exist. It may have been renamed, or the link may be
        from an older version of the site.</p>
        <ul>
          <li><a href="/">Documentation home</a></li>
          <li><a href="/getting-started/">Getting started</a></li>
          <li><a href="/authoring/">Authoring</a></li>
          <li><a href="/troubleshooting/browsers/">Browser &amp; performance help</a></li>
        </ul>
      </article>
    </main>`;
  return shell({
    title: `Page not found — ${SITE.shortTitle}`,
    description: "That documentation page does not exist.",
    canonical: new URL("/404.html", SITE.origin).href,
    current: null,
    headings: [],
    main,
  });
}

export function renderSitemap(): string {
  const entries = PAGES.map(page => `  <url><loc>${new URL(page.url, SITE.origin).href}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}
