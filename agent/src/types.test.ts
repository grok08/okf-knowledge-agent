import assert from "node:assert/strict";
import test from "node:test";
import { categoryFor, inferConceptType, parseInventory, sha256, slugify } from "./types.js";

test("inventory parsing rejects malformed page hashes", () => {
  assert.throws(() => parseInventory({ version: 1, site: "https://example.com/", complete: true, pages: [{ url: "https://example.com/", title: "Home", headings: [], text: "text", internalLinks: [], externalLinks: [], metadata: {}, contentHash: "invalid", stale: false }] }));
});

test("concept routes derive from observed URL paths", () => {
  assert.equal(inferConceptType(new URL("https://example.com/infomagnus-services/data-and-ai-services")), "Service");
  assert.equal(inferConceptType(new URL("https://example.com/privacy-policy")), null);
  assert.equal(categoryFor("CaseStudy"), "case-studies");
  assert.equal(slugify("AI & Data Services"), "ai-data-services");
  assert.equal(sha256("source").length, 64);
});

test("site discovery ignores broad listing and unrelated service paths", () => {
  assert.equal(inferConceptType(new URL("https://example.com/infomagnus-services/ai-powered-application-modernization")), "Service");
  assert.equal(inferConceptType(new URL("https://example.com/infomagnus-services")), null);
  assert.equal(inferConceptType(new URL("https://example.com/infomagnus-partners/github-advanced-partner")), "Organization");
  assert.equal(inferConceptType(new URL("https://example.com/perspectives-and-insights/ado-github-enterprise-migration")), "Insight");
  assert.equal(inferConceptType(new URL("https://example.com/content-collection/modernizing-healthcare-development-with-github")), "Insight");
});
