import { load } from "cheerio";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseInventory, sha256, type Inventory, type SitePage } from "./types.js";

export type CrawlOptions = {
  site: string;
  limit: number;
  inventoryPath: string;
};

function canonicalize(input: string, origin: string): string | null {
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function inCrawlScope(url: string, origin: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return url === `${origin}/`
    || /^\/(about-us\/about-infomagnus|insights-and-news|infomagnus-services\/[^/]+|infomagnus-solutions\/[^/]+|infomagnus-partners\/[^/]+|perspectives-and-insights\/[^/]+|content-collection\/[^/]+)$/.test(path);
}

function extractPage(url: string, html: string, origin: string): SitePage {
  const $ = load(html);
  $("script, style, noscript, svg, nav, footer, header, form").remove();
  const title = $("meta[property='og:title']").attr("content")?.trim()
    || $("title").first().text().trim()
    || $("h1").first().text().trim()
    || new URL(url).pathname;
  const root = $("main").length ? $("main") : $("body");
  const headings = root.find("h1, h2, h3, h4").toArray()
    .map((node) => $(node).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const blocks = root.find("h1, h2, h3, h4, p, li, blockquote, td").toArray()
    .map((node) => $(node).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = (blocks.length ? blocks : [root.text()]).map((block) => block.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const internalLinks = new Map<string, string>();
  const externalLinks = new Set<string>();
  root.find("a[href]").each((_, node) => {
    const href = $(node).attr("href");
    if (!href) return;
    let absolute: URL;
    try {
      absolute = new URL(href, origin);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(absolute.protocol)) return;
    absolute.hash = "";
    const target = absolute.origin === origin ? canonicalize(absolute.toString(), origin) : absolute.toString();
    const anchor = $(node).text().replace(/\s+/g, " ").trim();
    if (absolute.origin === origin && target) internalLinks.set(target, anchor);
    else if (absolute.origin !== origin) externalLinks.add(target ?? absolute.toString());
  });
  const metadata: Record<string, string> = {};
  $("meta[name], meta[property]").each((_, node) => {
    const key = $(node).attr("name") ?? $(node).attr("property");
    const value = $(node).attr("content");
    if (key && value) metadata[key] = value;
  });
  return {
    url,
    title,
    headings,
    text,
    internalLinks: [...internalLinks].map(([link, anchor]) => ({ url: link, text: anchor })),
    externalLinks: [...externalLinks],
    metadata,
    contentHash: sha256(`${title}\n${headings.join("\n")}\n${text}`),
    stale: false,
  };
}

async function discoverFromSitemap(site: URL): Promise<string[]> {
  try {
    const response = await fetch(new URL("/sitemap.xml", site), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
      .map((match) => canonicalize(match[1] ?? "", site.origin))
      .filter((url): url is string => url !== null);
  } catch {
    return [];
  }
}

async function readPrevious(path: string, site: string): Promise<Map<string, SitePage>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const inventory = parseInventory(raw);
    if (inventory.site !== site) return new Map();
    return new Map(inventory.pages.map((page) => [page.url, page]));
  } catch {
    return new Map();
  }
}

export async function crawlSite(options: CrawlOptions): Promise<{ inventory: Inventory; changed: number; unchanged: number; rejected: number }> {
  const siteUrl = new URL(options.site);
  if (siteUrl.username || siteUrl.password || !["http:", "https:"].includes(siteUrl.protocol)) throw new Error("Crawl site must be an HTTP or HTTPS URL without credentials.");
  const site = `${siteUrl.origin}/`;
  const previous = await readPrevious(options.inventoryPath, site);
  const initial = (await discoverFromSitemap(siteUrl)).filter((url) => inCrawlScope(url, siteUrl.origin));
  const queue = [...new Set([...initial, site])];
  const expected = new Set(queue);
  const visited = new Set<string>();
  const unresolved = new Set<string>();
  const pages = new Map<string, SitePage>();
  let changed = 0;
  let unchanged = 0;
  let rejected = 0;
  let hitLimit = false;
  while (queue.length > 0 && visited.size < options.limit) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    unresolved.delete(url);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "InfoMagnusOKF/0.1 (knowledge ingestion)" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
        rejected += 1;
        unresolved.add(url);
        continue;
      }
      if (new URL(response.url).origin !== siteUrl.origin) {
        rejected += 1;
        unresolved.add(url);
        continue;
      }
      const page = extractPage(url, await response.text(), siteUrl.origin);
      pages.set(url, page);
      const old = previous.get(url);
      if (old?.contentHash === page.contentHash) unchanged += 1;
      else changed += 1;
      if (url === site) {
        const sitemapLinks = await discoverFromSitemap(siteUrl);
        for (const link of sitemapLinks) {
          if (inCrawlScope(link, siteUrl.origin)) {
            expected.add(link);
            if (!visited.has(link) && !queue.includes(link)) queue.push(link);
          }
        }
      }
      for (const link of page.internalLinks) {
        if (inCrawlScope(link.url, siteUrl.origin)) {
          expected.add(link.url);
          if (!visited.has(link.url) && !queue.includes(link.url)) queue.push(link.url);
        }
      }
    } catch {
      rejected += 1;
      unresolved.add(url);
    }
  }
  hitLimit = queue.length > 0;
  for (const url of unresolved) {
    const old = previous.get(url);
    if (old) pages.set(url, { ...old, stale: true });
  }
  for (const [url, old] of previous) if (!pages.has(url) && !visited.has(url) && inCrawlScope(url, siteUrl.origin)) pages.set(url, { ...old, stale: true });
  const inventory: Inventory = { version: 1, site, complete: !hitLimit && unresolved.size === 0 && [...expected].every((url) => visited.has(url)), pages: [...pages.values()].sort((a, b) => a.url.localeCompare(b.url)) };
  await mkdir(dirname(resolve(options.inventoryPath)), { recursive: true });
  const temporary = `${resolve(options.inventoryPath)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  await rename(temporary, resolve(options.inventoryPath));
  return { inventory, changed, unchanged, rejected };
}
