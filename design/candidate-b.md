# Candidate B: one bundle that knows its corpus

## Usage (caller's view)

The CLI is the main consumer. A caller opens the OKF bundle once, then asks it to reconcile source captures, inspect or validate the corpus, and answer navigation requests. Callers do not load Markdown, rebuild indexes, or independently resolve evidence.

```text
npm run crawl -- --site https://www.infomagnus.com
npm run okf -- validate
npm run okf -- ask "What does the source say about <topic>?"
npm run eval -- --set evaluation/evaluation-set.json
```

The question is a prompt, not a claim that the topic exists. The agent must search and cite only what the captured and accepted sources support.

Representative call sites:

```ts
const bundle = await OkfBundle.open({ root: "okf", work: ".okf-work" });
const report = await bundle.validate();
// report.diagnostics is empty only when the bundle meets the configured OKF v0.2 checks.
```

```ts
const capture = await crawlSite(siteConfig, { work: ".okf-work" });
const changes = await bundle.reconcile(capture);
// Repeat with the same pages: unchanged pages and accepted concepts stay unchanged.
```

```ts
const run = await ask(bundle, groq, question, { maxSteps: 10 });
// run includes the answer, used evidence, tool trace, and usage/latency when supplied.
```

The CLI presents the same operations: validation diagnostics; crawl changes and skipped unchanged pages; and, for an answer, question, tool calls, concepts discovered/read, links followed, cited sources, answer, latency, and token counts when returned by Groq.

## Problem

The plan treats the OKF bundle as the knowledge system but assigns its index, validator, navigation tools, crawler, and evidence handling to separate areas. That split risks several versions of the same concept and link rules. Candidate B makes one `OkfBundle` the owner of accepted knowledge and every derived way to inspect it. Crawling and Groq remain external-boundary adapters. The repository is greenfield, and the only source facts allowed in the initial corpus are those captured from infomagnus.com and reviewed with traceable evidence. `plan.md` supplies requirements and examples, not factual support for company claims.

## Shape

### Domain types

Types below are the internal domain model. Markdown/frontmatter, crawler responses, Groq requests, and CLI text are parsed at their boundaries and do not escape as public types.

```ts
type ConceptId = string & { readonly __brand: "ConceptId" };
type SourceId = string & { readonly __brand: "SourceId" };
type EvidenceId = string & { readonly __brand: "EvidenceId" };
type RelativePath = string & { readonly __brand: "RelativePath" };
type ContentHash = string & { readonly __brand: "ContentHash" };

type ConceptType =
  | "Organization" | "Service" | "Solution" | "Industry"
  | "Technology" | "Capability" | "CaseStudy" | "Insight" | "Outcome";

type SourcePage = {
  id: SourceId; canonicalUrl: URL; title: string | null;
  fetchedAt: string; contentHash: ContentHash;
  headings: readonly string[]; text: string;
  links: readonly { url: URL; relation: "internal" | "external" }[];
  metadata: Readonly<Record<string, string>>;
};

type Evidence = {
  id: EvidenceId; source: SourceId; locator: string;
  excerpt: string; excerptHash: ContentHash;
};

type Claim = { text: string; evidence: readonly EvidenceId[] };
type Relation = {
  kind: string; target: ConceptId; evidence: readonly EvidenceId[];
};
type Concept = {
  id: ConceptId; type: ConceptType; title: string;
  description: string; tags: readonly string[];
  claims: readonly Claim[]; relations: readonly Relation[];
  sourcePages: readonly SourceId[]; path: RelativePath;
  status: "current" | "deprecated";
};

type Capture = {
  pages: readonly SourcePage[];
  complete: boolean; // false on crawl failure; never interpreted as deletions
};
type ReconcileResult = {
  added: readonly SourceId[]; changed: readonly SourceId[];
  unchanged: readonly SourceId[]; proposals: readonly ConceptProposal[];
};
type ConceptProposal = {
  concept: Concept; evidence: readonly Evidence[];
  decision: "needs-review";
};
type Diagnostic = {
  severity: "error" | "warning"; code: string; path: string; message: string;
};
type ValidationReport = { diagnostics: readonly Diagnostic[] };
```

`ConceptType` contains the types named by the plan. Relationship kinds remain evidence-backed strings until the OKF v0.2 contract and source corpus establish the allowed vocabulary; no new relation is inferred just because a model suggests it. Each factual claim and relation points to evidence. An accepted concept cannot contain a dangling evidence reference. Proposals are not searchable knowledge until a human review promotes them.

The durable files remain the OKF bundle. Source captures and reconciliation state live in the bundle's work directory, not as undocumented additions to the OKF format. The catalog is rebuilt from canonical bundle content when opened. Search fields and navigation maps are derived from concepts and index references, never separately edited state.

### Public functions

```ts
interface OkfBundle {
  reconcile(capture: Capture): Promise<ReconcileResult>;
  accept(proposal: ConceptProposal): Promise<void>;
  validate(): Promise<ValidationReport>;
  list(input?: { type?: ConceptType; under?: RelativePath }): readonly Concept[];
  read(id: ConceptId): { concept: Concept; evidence: readonly Evidence[] } | null;
  search(query: string, limit?: number): readonly SearchHit[];
  follow(id: ConceptId): readonly { relation: Relation; concept: Concept }[];
}

type SearchHit = {
  id: ConceptId; title: string; type: ConceptType;
  description: string; matchedFields: readonly string[]; score: number;
};

namespace OkfBundle {
  function open(config: { root: string; work: string }): Promise<OkfBundle>;
}

function crawlSite(config: SiteConfig, options: { work: string }): Promise<Capture>;
function ask(bundle: OkfBundle, model: GroqModel, question: string,
  options: { maxSteps: number }): Promise<AgentRun>;
function evaluate(bundle: OkfBundle, model: GroqModel,
  set: EvaluationSet): Promise<EvaluationRun>;
```

`list`, `read`, `search`, and `follow` form the agent's complete knowledge API. `validate` and `reconcile` use the same in-memory catalog and evidence resolver, avoiding separate implementations of link, path, and source rules. The public interface hides parsing, index construction, lexical scoring, evidence resolution, atomic writes, and OKF rule application. Callers choose a bundle root and work directory and handle returned diagnostics; they do not coordinate load/validate/index/save steps.

The `GroqModel` interface is an internal adapter, not an exported SDK type:

```ts
interface GroqModel {
  complete(messages: readonly AgentMessage[], tools: readonly ToolSpec[]):
    Promise<ModelTurn>;
}
```

The adapter parses provider responses, checks tool arguments, normalizes finish states and token usage, and returns domain values. Its concrete configuration reads `GROQ_API_KEY` and `GROQ_MODEL`, defaulting the model only to the plan's `openai/gpt-oss-120b`. Missing credentials fail at CLI startup with a direct error.

```ts
type AgentRun = {
  answer: string; citations: readonly EvidenceId[];
  trace: readonly ToolEvent[]; usage: TokenUsage | null;
  latencyMs: number; stop: "completed" | "step-limit";
};
```

### Data flow and ownership

1. The crawler follows same-site links from the configured origin, captures URL/title/headings/text/links/metadata, canonicalizes URLs, and hashes normalized content. It writes each page snapshot to a temporary file and atomically replaces the work-cache entry. A failed or partial crawl sets `complete: false`; it never treats absent pages as deletions.
2. `bundle.reconcile(capture)` upserts snapshots by canonical source ID and content hash. Identical content is unchanged, changed pages get a new snapshot, and interrupted writes are discarded on the next open. Re-running the same capture converges to the same state. The crawl does not itself publish knowledge.
3. Conversion proposes concepts and evidence links from captured text. A proposal is only admissible when each claim and relation maps to an excerpt from a captured source. It receives `needs-review`; a reviewer checks accuracy, classification, duplication, and relationships before `accept`. There is no unsupported automatic acceptance. For the first release, convert and review the initial 50–100 concepts only if the source inventory supports that many; do not pad the corpus.
4. `accept` writes the concept and its source/evidence references as an atomic bundle update. Concept IDs derive from normalized type and title, with collisions surfaced for review rather than silently overwritten. Re-accepting identical content is a no-op. Index pages are regenerated from accepted concepts and explicit relationships; they are views, not a second authority.
5. `open` parses bundle files and the configured OKF v0.2 rules once, builds a catalog keyed by concept/source IDs, resolves evidence, and derives navigation and search structures. `validate` reports malformed frontmatter, missing required type, malformed Markdown, broken internal links/file references, bad indexes/reserved files, duplicate concepts, invalid source references, unsupported evidence links, and applicable v0.2 violations. Exact format rules come from the authoritative OKF v0.2 specification, not assumptions in this design.
6. `search` tokenizes and normalizes the query, then ranks catalog entries using lexical matches in title, type, description, tags, and generated index references. Exact title/type and phrase matches may receive greater weight; ties sort by stable concept ID. It never calls embeddings, vector storage, semantic retrieval, a search API, or external RAG.
7. `ask` starts with the system prompt and user question, then calls Groq using only the declared bundle tools. The dispatcher accepts `list`, `search`, `read`, and `follow`, validates arguments at the model boundary, executes one operation against the bundle, and returns compact concept/evidence results. The loop ends on a final response or after ten model turns. The final citation IDs must be among evidence returned during that run; invalid IDs are removed and recorded as a validation failure, not rendered as citations.
8. An evaluation run uses the same ask path as an interactive run. It records the question, tool events, concepts searched/read, relations followed, evidence/source IDs, answer, latency, token counts, stop reason, and citation validation. Results are written atomically to `evaluation/results/okf-results.json` so a crash cannot leave a plausible partial result file.

Each accepted factual statement has evidence; source captures retain URL, fetch time, content hash, and locator. The exact excerpt plus hash lets validation check that the evidence still matches the stored snapshot. When a source changes, prior accepted claims remain visible with their old snapshot until review. A crawl cannot silently rewrite knowledge or erase facts just because a page temporarily disappears.

### Module map

```text
src/
  bundle.ts       OkfBundle public boundary; catalog, evidence, validation,
                  lexical search, navigation, and atomic bundle writes
  crawl.ts        same-site crawl, canonical URLs, page capture and work cache
  groq.ts         Groq transport/config parsing into private model values
  agent.ts        bounded tool loop, prompt, citation check, run trace
  cli.ts          commands and human-readable output; thin orchestration
  evaluation.ts   fixed-set parsing, evaluation run aggregation, atomic results
okf/              canonical OKF v0.2 bundle
.okf-work/        ignored source snapshots and interrupted-work cleanup data
evaluation/       source-grounded question set and result artifacts
```

`bundle.ts` is intentionally the large ownership boundary, not a collection of forwarding submodules. It concentrates rules that must agree about what a concept, link, evidence item, and index mean. The crawl and Groq modules adapt outside systems; neither owns accepted knowledge. This keeps question-to-answer and source-to-concept call paths short.

### MVP phases

1. **Ground the format and source boundary.** Create the package and bundle/work directories, read the authoritative OKF v0.2 requirements, capture a small crawl, and verify that the crawler remains on the configured site. Do not create sample InfoMagnus claims from plan examples.
2. **Prove one reviewed slice.** Reconcile captures, review concept proposals, and accept a small source-backed slice. Implement bundle open, evidence resolution, validation, index generation, list/read/follow, and lexical search. Grow toward 50–100 concepts only where sources support them. Keep content review part of this phase.
3. **Prove the agent at runtime.** Add Groq configuration and the bounded tool loop, then expose `okf validate`, `okf ask`, and `crawl` CLI commands. Ask questions answerable by the accepted slice and inspect that each displayed citation resolves to the cited source excerpt.
4. **Measure before expanding.** Build the fixed evaluation set from reviewed concepts, including relationship and multi-hop questions only when the needed links have evidence. Record traces, citations, latency, and tokens. Run the set through the same CLI/application path and write results atomically. Expand the corpus only after the slice validates and behaves as expected; comparison with the existing RAG is a later phase.

### Runtime verification

The first proof should use a captured source fixture taken from an actual page, with URL, capture hash, and excerpts retained. It must not contain invented InfoMagnus facts. Run these checks against the built package:

```text
npm run crawl -- --site https://www.infomagnus.com --limit 1
npm run okf -- validate
npm run okf -- ask "What does the captured source say about <verified topic>?"
npm run eval -- --set evaluation/evaluation-set.json
```

Verify the crawl stays on-origin, repeating it does not create duplicate source records, a changed page updates its snapshot without silently changing accepted claims, and an interrupted run leaves no partially published bundle file. Verify that validation catches a broken internal link and missing evidence, then passes after correction. Verify a known answer traverses at least one tool, prints only resolvable citations, obeys the ten-turn cap, and logs the calls, concepts, evidence, latency, and token counts available. The evaluation command must produce parseable JSON whose records match the input questions. These are runtime checks of the user-facing paths, not only compilation checks.

## Synthesis decision

This is an independent Candidate B package. No other candidate was run or synthesized. The requested single-bundle ownership is the defining choice; a later synthesis can compare it with another complete shape.

## Tradeoffs accepted

- We accept a more capable `OkfBundle` implementation in exchange for one authority for indexing, validation, evidence, and navigation.
- We accept human review before proposal promotion in exchange for keeping generated or extracted claims out of the accepted corpus until their sources support them.
- We accept rebuilding small-corpus indexes when opening the bundle in exchange for avoiding stale, independently edited catalog files.
- We accept retaining old snapshots and claims when a crawl is incomplete in exchange for avoiding destructive changes after transient source failures.
- We accept plain lexical matching in exchange for a clean experiment that does not use embeddings, vectors, semantic search, search APIs, or external RAG.
- We accept that official OKF v0.2 rules must be checked before implementation in exchange for not inventing format requirements from a planning document.

## Alternatives considered

- **Separate `okf/`, `validation/`, navigation tools, and catalog/index packages.** Each package gets a small interface, but callers and maintainers must keep their parsers and link/evidence rules aligned. This exposes coordination and duplicates ownership that the single `OkfBundle` hides.
- **Database-first graph store with Markdown export.** It gives richer querying but makes the export and database competing authorities, adds reconciliation and transaction rules, and weakens the direct test of OKF bundle navigation. It hides storage details from callers only after introducing a larger persistence boundary.
- **Crawler writes accepted concepts directly.** It shortens ingestion but combines uncertain extraction with publication, making unsupported claims harder to distinguish from reviewed knowledge. Keeping proposals and accepted concepts as different states costs a review action and gives the corpus an explicit trust boundary.

## Open questions and risks

- Which authoritative OKF v0.2 specification and reserved-file rules should the validator target?
- Does the actual site permit a complete same-origin crawl at the planned rate, and which pages count as in scope?
- Should proposed concept changes be reviewed through a CLI diff or direct Markdown edits before acceptance?
- How should source pages that change or disappear be reviewed and marked stale after the MVP?
- Which Groq response metadata is available for token and latency reporting in the selected SDK version?

## Next implementation step

Read the authoritative OKF v0.2 specification and implement a fixture-backed `OkfBundle.open` plus `validate` vertical slice that proves the bundle can resolve one source excerpt and one concept without adding unsupported facts.
