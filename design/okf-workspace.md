# OKF workspace design

## Caller usage

```powershell
npm run crawl -- --site https://www.infomagnus.com --limit 20
npm run okf -- validate
npm run okf -- search "application modernization"
npm run okf -- ask "Which services support application modernization?"
npm run eval
```

```ts
const bundle = await OkfBundle.open({ root: "okf", work: ".okf-work" });
const report = await bundle.validate();
const hits = bundle.search("application modernization");
```

## Data model

`SourcePage` is a captured page identified by its canonical URL and content hash. It stores extracted title, headings, body text, internal and external links, and metadata.

`Evidence` points to a source page and exact excerpt. `Claim` contains a non-empty list of evidence. `Relation` connects two concepts and also requires evidence. `Concept` contains a typed kind, title, evidence-backed description and claims, explicit relationships, tags, source URL, and status. Unreviewed page classifications remain inventory metadata. The inventory does not become accepted knowledge without supported concept content.

`OkfBundle` parses the Markdown bundle once and derives a catalog keyed by concept ID. It owns validation, indexes, lexical search, and navigation. The catalog is rebuilt from Markdown, so the bundle remains the source of truth.

## Module map

```text
agent/src/
  types.ts       Domain shapes and external-boundary parsers
  bundle.ts      Bundle parsing, validation, indexing, search, and traversal
  crawler.ts     Same-origin crawl and deterministic site inventory
  groq.ts        Groq configuration and private API adapter
  agent.ts       Bounded tool loop and trace collection
  cli.ts         Command parsing and terminal output
  evaluation.ts  Fixed question set and atomic result output
```

`okf/` is the portable knowledge bundle. `site-inventory.json` records crawl output. The crawler does not accept concepts or alter the bundle. `knowledge-model.md` defines concept and relationship types. Groq receives only discovered bundle content through tools. Search uses local lexical matching and makes no embedding, vector database, semantic retrieval, search API, or external RAG calls.

## Synthesis decision

Candidate B is the base because it gives the bundle one clear owner and specifies partial-crawl and atomic-write behavior. Candidate A contributes evidence-required claims and relationships, conflict detection for generated content, and fixture-first implementation gates. Candidate B's evaluation trace and output checks remain. The candidates converge on human review before concept promotion and on deferring exact OKF format rules to the plan's stated v0.2 metadata examples because no authoritative spec URL is supplied.

## Implementation gates

1. Create the typed Node package and fixture-backed domain operations.
2. Verify deterministic crawler inventory, concept parsing, lexical search, and link traversal.
3. Add automated structural validation and verify invalid fixtures fail.
4. Crawl the public site and build only source-backed concepts with matching excerpts.
5. Add the bounded Groq tool loop, CLI trace, and evaluation record format.
6. Run local end-to-end checks. Run live provider checks only when a key is configured.

## Tradeoffs

- Human-reviewed content remains a separate step from crawling, so the crawler cannot publish unsupported claims.
- The structural validator checks the metadata and Markdown contract given in `plan.md`. A complete OKF v0.2 compliance claim requires an authoritative specification, which the plan does not identify.
- Evaluation execution requires Groq credentials. Dataset and result formats remain usable without making a live call.
- Site availability, crawl policy, and page changes can affect the fetched corpus. The inventory stores source URLs and content hashes for review.
