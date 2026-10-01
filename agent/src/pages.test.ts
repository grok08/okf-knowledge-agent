import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPages, listFiles } from "./build-pages.js";

test("builds a deterministic Pages artifact with subpath-safe assets and a public API base", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "okf-pages-"));
  try {
    await buildPages({ outputDirectory, apiBase: "https://okf-api.example.workers.dev/" });
    const firstFiles = await listFiles(outputDirectory);
    const html = await readFile(join(outputDirectory, "index.html"), "utf8");
    const app = await readFile(join(outputDirectory, "app.js"), "utf8");
    const config = await readFile(join(outputDirectory, "config.js"), "utf8");
    const markdownModule = await readFile(join(outputDirectory, "vendor/marked.js"), "utf8");
    const browserBundle = await Promise.all(firstFiles.map((path) => readFile(join(outputDirectory, path), "utf8")));

    assert.deepEqual(firstFiles, ["app.js", "config.js", "index.html", "styles.css", "theme.js", "vendor/marked.js", "vendor/purify.es.mjs"]);
    assert.match(html, /href="\.\/styles\.css"/);
    assert.match(html, /src="\.\/config\.js"/);
    assert.match(html, /src="\.\/app\.js"/);
    assert.doesNotMatch(html, /(?:src|href)="\//);
    assert.match(app, /from "\.\/vendor\/marked\.js"/);
    assert.match(app, /from "\.\/vendor\/purify\.es\.mjs"/);
    assert.match(app, /fetch\(`\$\{window\.okfApiBase \?\? ""\}\/api\/ask`/);
    assert.equal(config, 'window.okfApiBase = "https://okf-api.example.workers.dev";\n');
    assert.equal(markdownModule, await readFile("node_modules/marked/lib/marked.esm.js", "utf8"));
    assert.doesNotMatch(browserBundle.join("\n"), /GROQ_API_KEY|test-secret|Bearer /);

    const firstContents = await Promise.all(firstFiles.map((path) => readFile(join(outputDirectory, path), "utf8")));
    await buildPages({ outputDirectory, apiBase: "https://okf-api.example.workers.dev/" });
    const secondContents = await Promise.all(firstFiles.map((path) => readFile(join(outputDirectory, path), "utf8")));
    assert.deepEqual(secondContents, firstContents);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("rejects an insecure or path-scoped production Worker URL", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "okf-pages-invalid-"));
  try {
    await assert.rejects(() => buildPages({ outputDirectory, apiBase: "http://okf-api.example.workers.dev" }), /HTTPS origin/);
    await assert.rejects(() => buildPages({ outputDirectory, apiBase: "https://example.com/api" }), /HTTPS origin/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});