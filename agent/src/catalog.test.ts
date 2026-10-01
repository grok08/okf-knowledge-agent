import assert from "node:assert/strict";
import test from "node:test";
import { OkfBundle } from "./bundle.js";
import { exportKnowledgeCatalog } from "./catalog-export.js";
import { parseKnowledgeCatalog } from "./catalog.js";

test("exports a normalized catalog with the corpus evidence and resolved relations", async () => {
  const bundle = await OkfBundle.open("okf");
  const catalog = exportKnowledgeCatalog(bundle);
  const paths = new Set(catalog.concepts.map((concept) => concept.path));
  const about = catalog.concepts.find((concept) => concept.path === "company/about-infomagnus.md");

  assert.equal(catalog.version, 1);
  assert.equal(catalog.concepts.length, bundle.concepts.length);
  assert.equal(about?.type, "Organization");
  assert.ok(catalog.concepts.some((concept) => concept.relations.length > 0));
  assert.ok(catalog.concepts.every((concept) => !concept.path.includes("\\") && !concept.path.startsWith("/")));
  assert.ok(catalog.concepts.flatMap((concept) => concept.relations).every((relation) => paths.has(relation.target)));
  assert.deepEqual(parseKnowledgeCatalog(JSON.parse(JSON.stringify(catalog))), catalog);
});

test("rejects catalogs with relation targets outside the exported concepts", async () => {
  const catalog = exportKnowledgeCatalog(await OkfBundle.open("okf"));
  const first = catalog.concepts[0];
  assert.ok(first);

  assert.throws(() => parseKnowledgeCatalog({
    ...catalog,
    concepts: [{ ...first, relations: [{ kind: "references", target: "missing.md", evidence: first.evidence }] }],
  }), /Unknown concept path: missing\.md/);
});