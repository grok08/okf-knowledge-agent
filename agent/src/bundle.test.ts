import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OkfBundle, convertInventory } from "./bundle.js";
import { sha256, type Inventory } from "./types.js";

test("conversion is repeatable and bundle navigation uses written OKF files", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-bundle-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    const source = "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing. The service includes planning, implementation, and validation for legacy application work. This work is supported by trained engineers and a delivery process.";
    const inventory: Inventory = {
      version: 1,
      site: "https://www.infomagnus.com/",
      complete: true,
      pages: [{
        url: "https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization",
        title: "AI-Powered Application Modernization",
        headings: ["Modernize applications"],
        text: source,
        internalLinks: [],
        externalLinks: [],
        metadata: {},
        contentHash: sha256(source),
        stale: false,
      }],
    };
    await writeFile("site-inventory.json", JSON.stringify(inventory));
    assert.equal(await convertInventory(inventory), 1);
    const first = await readFile("okf/services/ai-powered-application-modernization.md", "utf8");
    assert.equal(await convertInventory(inventory), 1);
    assert.equal(await readFile("okf/services/ai-powered-application-modernization.md", "utf8"), first);
    const bundle = await OkfBundle.open("okf");
    assert.equal(bundle.search("application modernization")[0]?.title, "AI-Powered Application Modernization");
    assert.equal(bundle.list("Service").length, 1);
    assert.ok(bundle.concepts[0]?.description.includes("AI-assisted engineering"));
    assert.deepEqual(await bundle.validate(), []);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("conversion marks retained stale sources as stale and the validator accepts their evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-stale-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    const source = "InfoMagnus supports healthcare teams modernizing clinical applications through structured engineering and quality practices that protect important workflows. Teams receive planning, implementation, testing, and release support from experienced specialists.";
    const inventory: Inventory = {
      version: 1,
      site: "https://www.infomagnus.com/",
      complete: true,
      pages: [{ url: "https://www.infomagnus.com/infomagnus-services/healthcare-application-modernization", title: "Healthcare Application Modernization", headings: [], text: source, internalLinks: [], externalLinks: [], metadata: {}, contentHash: sha256(source), stale: true }],
    };
    await writeFile("site-inventory.json", JSON.stringify(inventory));
    await convertInventory(inventory);
    const content = await readFile("okf/services/healthcare-application-modernization.md", "utf8");
    assert.match(content, /status: stale/);
    assert.deepEqual(await (await OkfBundle.open("okf")).validate(), []);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("generated relationship links resolve from the concept directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-relations-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    const serviceUrl = "https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization";
    const solutionUrl = "https://www.infomagnus.com/infomagnus-solutions/application-modernization-with-sonyx";
    const serviceText = "InfoMagnus modernizes applications with SONYX, a solution for transforming legacy software. The service combines AI-assisted engineering, delivery planning, and structured quality testing for business applications.";
    const solutionText = "SONYX modernizes applications through AI-assisted engineering, delivery planning, and structured quality testing for business applications.";
    const inventory: Inventory = {
      version: 1,
      site: "https://www.infomagnus.com/",
      complete: true,
      pages: [
        { url: serviceUrl, title: "AI-Powered Application Modernization", headings: [], text: serviceText, internalLinks: [{ url: solutionUrl, text: "SONYX" }], externalLinks: [], metadata: {}, contentHash: sha256(serviceText), stale: false },
        { url: solutionUrl, title: "Application Modernization with SONYX", headings: [], text: solutionText, internalLinks: [], externalLinks: [], metadata: {}, contentHash: sha256(solutionText), stale: false },
      ],
    };
    await writeFile("site-inventory.json", JSON.stringify(inventory));
    await convertInventory(inventory);
    const bundle = await OkfBundle.open("okf");
    const related = bundle.follow("services/ai-powered-application-modernization.md");
    assert.equal(related.length, 1);
    assert.equal(related[0]?.title, "Application Modernization with SONYX");
    assert.match(await readFile("okf/services/ai-powered-application-modernization.md", "utf8"), /\]\(\.\.\/solutions\/application-modernization-with-sonyx\.md\)/i);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("validator reports broken internal concept links", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-invalid-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await mkdir("okf/services", { recursive: true });
    await writeFile("site-inventory.json", JSON.stringify({ version: 1, site: "https://www.infomagnus.com/", complete: true, pages: [] }));
    await writeFile("okf/index.md", "# Root\n");
    for (const category of ["company", "services", "solutions", "industries", "technologies", "capabilities", "case-studies", "insights"]) {
      await mkdir(`okf/${category}`, { recursive: true });
      await writeFile(`okf/${category}/index.md`, `# ${category}\n`);
    }
    await writeFile("okf/services/example.md", "---\ntype: Service\ntitle: Example\ndescription: A source-backed service description.\nresource: https://www.infomagnus.com/example\nevidence:\n  resource: https://www.infomagnus.com/example\n  quote: A source-backed service description.\n---\n\n# Example\n\n[Missing](./missing.md)\n");
    const issues = await (await OkfBundle.open("okf")).validate();
    assert.ok(issues.some((issue) => issue.code === "invalid-source"));
    assert.ok(issues.some((issue) => issue.code === "broken-link"));
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("conversion does not delete or overwrite a hand-authored concept", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-preserve-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    const source = "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing. The service helps teams manage legacy application updates with testing, review, and controlled release processes.";
    const inventory: Inventory = {
      version: 1,
      site: "https://www.infomagnus.com/",
      complete: true,
      pages: [{ url: "https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization", title: "AI-Powered Application Modernization", headings: [], text: source, internalLinks: [], externalLinks: [], metadata: {}, contentHash: sha256(source), stale: false }],
    };
    await writeFile("site-inventory.json", JSON.stringify(inventory));
    await mkdir("okf/services", { recursive: true });
    await writeFile("okf/services/manual.md", `---\ntype: Service\ntitle: Manual\ndescription: A hand-authored service.\nresource: ${inventory.pages[0]?.url}\nevidence:\n  resource: ${inventory.pages[0]?.url}\n  quote: ${source}\n---\n\n# Manual\n`);
    await convertInventory(inventory);
    assert.match(await readFile("okf/services/manual.md", "utf8"), /A hand-authored service/);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("conversion refuses an incomplete crawl inventory", async () => {
  const source = "InfoMagnus helps teams modernize applications with AI-assisted engineering and structured testing. This service also provides a governed path for application changes.";
  const inventory: Inventory = {
    version: 1,
    site: "https://www.infomagnus.com/",
    complete: false,
    pages: [{ url: "https://www.infomagnus.com/infomagnus-services/ai-powered-application-modernization", title: "Application Modernization", headings: [], text: source, internalLinks: [], externalLinks: [], metadata: {}, contentHash: sha256(source), stale: false }],
  };
  await assert.rejects(() => convertInventory(inventory), /incomplete site inventory/);
});
