import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crawlSite } from "./crawler.js";
import { sha256, type Inventory, type SitePage } from "./types.js";

test("crawl only follows relevant site paths and retains failed pages as stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-crawler-"));
  const inventoryPath = join(root, "site-inventory.json");
  const site = "https://www.infomagnus.com/";
  const relevantUrl = `${site}infomagnus-services/ai-powered-application-modernization`;
  const outOfScopeUrl = `${site}privacy-policy`;
  const oldPage = (url: string): SitePage => ({
    url,
    title: "Previously captured page",
    headings: [],
    text: "Previously captured page content with enough detail to be retained after a failed refresh.",
    internalLinks: [],
    externalLinks: [],
    metadata: {},
    contentHash: sha256(url),
    stale: false,
  });
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  try {
    const previous: Inventory = { version: 1, site, complete: true, pages: [oldPage(relevantUrl), oldPage(outOfScopeUrl)] };
    await writeFile(inventoryPath, JSON.stringify(previous));
    globalThis.fetch = async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url.endsWith("/sitemap.xml")) return new Response("<urlset></urlset>", { status: 200, headers: { "content-type": "application/xml" } });
      const response = url === site
        ? new Response(`<main><a href="/infomagnus-services/ai-powered-application-modernization">Modernization</a><a href="/privacy-policy">Privacy</a></main>`, { status: 200, headers: { "content-type": "text/html" } })
        : new Response("Unavailable", { status: 503, headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    };

    const report = await crawlSite({ site, limit: 10, inventoryPath });
    const saved: Inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    const staleUrls = saved.pages.filter((page) => page.stale).map((page) => page.url);

    assert.equal(report.inventory.complete, false);
    assert.ok(fetched.includes(relevantUrl));
    assert.ok(!fetched.includes(outOfScopeUrl));
    assert.deepEqual(staleUrls, [relevantUrl]);
    assert.deepEqual(saved.pages.map((page) => page.url).sort(), [site, relevantUrl].sort());
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
