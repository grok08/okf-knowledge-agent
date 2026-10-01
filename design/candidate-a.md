# Candidate A: Evidence workspace

## Problem

The repository is greenfield, and `plan.md` defines the target corpus, source, agent, and experimental boundary without supplying facts about InfoMagnus itself or the exact OKF v0.2 schema. The design must therefore make source evidence the entry point for every fact, keep the corpus verifiable, and let an agent discover knowledge without loading the entire bundle. It should not recreate the conventional split into crawler, validator, and agent subsystems. This candidate puts the corpus and its evidence ledger behind one local workspace API; network access, Groq, and the CLI are boundary adapters around that domain.

## Usage (caller's view)

The operator starts with the site named in the plan. Crawl results become source observations, not OKF claims. A reviewed decision file maps observations to candidate concepts and relationships; conversion writes the accepted concepts into the OKF bundle.

```powershell
# Fetch the site's reachable pages and save content-addressed source snapshots.
npm run okf -- crawl https://www.infomagnus.com/

# Review the staged source inventory and prepare evidence-backed concept decisions.
npm run okf -- sources
npm run okf -- convert --decisions decisions/initial.json

# Check the resulting bundle, then ask questions against that bundle.
npm run okf -- validate
npm run okf -- ask "Which services are related to application modernization?" --trace
```

The workspace API gives scripts and later evaluation code the same operations as the CLI:

```ts
const workspace = await openWorkspace(".");
const crawl = await workspace.crawl(["https://www.infomagnus.com/"]);
const validation = await workspace.validate();
```

```ts
const result = await workspace.convert(decisions);
// result.written contains deterministic OKF paths; unsupported or ambiguous
// decisions remain unconverted with a reason.
```

```ts
const run = await workspace.ask(question, { trace: true });
// run.answer and run.trace include only concepts and sources discovered
// through this workspace's tools; token counts are nullable.
```

These examples do not assert what the site contains or guarantee a particular concept count. They show the operator flow; content is established by retrieved source material and review.

## Shape

### Domain types

The types describe internal domain data. HTML, Groq wire messages, YAML parser results, and OKF-specific serialization details stay behind adapters.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type CanonicalUrl = Brand<string, "CanonicalUrl">;
type ContentHash = Brand<string, "ContentHash">;
type ConceptId = Brand<string, "ConceptId">;
type RelativePath = Brand<string, "RelativePath">;

type ConceptKind =
  | "Organization"
  | "Service"
  | "Solution"
  | "Industry"
  | "Technology"
  | "Capability"
  | "CaseStudy"
  | "Insight"
  | "Outcome";

type SourceId = Brand<string, "SourceId">;
type ClaimId = Brand<string, "ClaimId">;

/** A fetched representation. Identity is URL plus content digest, not fetch time. */
interface SourceSnapshot {
  readonly id: SourceId;
  readonly url: CanonicalUrl;
  readonly contentHash: ContentHash;
  readonly title: string | null;
  readonly headings: readonly string[];
  readonly text: string;
  readonly internalLinks: readonly CanonicalUrl[];
  readonly externalLinks: readonly CanonicalUrl[];
  readonly metadata: Readonly<Record<string, string>>;
}

/** A precise pointer from a proposed fact to captured source material. */
interface Evidence {
  readonly source: SourceId;
  readonly locator: string;
  readonly quote: string;
}

interface SupportedClaim {
  readonly id: ClaimId;
  readonly text: string;
  readonly evidence: readonly [Evidence, ...Evidence[]];
}

type RelationshipKind =
  | "supports"
  | "uses"
  | "serves"
  | "demonstrated_by"
  | "demonstrates"
  | "discusses";

interface SupportedRelationship {
  readonly from: ConceptId;
  readonly kind: RelationshipKind;
  readonly to: ConceptId;
  readonly evidence: readonly [Evidence, ...Evidence[]];
}

interface Concept {
  readonly id: ConceptId;
  readonly kind: ConceptKind;
  readonly title: string;
  readonly titleEvidence: Evidence;
  readonly description: SupportedClaim;
  readonly claims: readonly SupportedClaim[];
  readonly relationships: readonly SupportedRelationship[];
  readonly tags: readonly string[];
  readonly resource: CanonicalUrl;
}

/** Review input. Suggestions are not facts until accepted with evidence. */
type Decision =
  | { readonly state: "new-concept"; readonly concept: Concept }
  | { readonly state: "existing-concept"; readonly concept: Concept }
  | { readonly state: "supporting-evidence"; readonly target: ConceptId; readonly claim: SupportedClaim }
  | { readonly state: "reference-only"; readonly source: SourceId }
  | { readonly state: "unresolved"; readonly source: SourceId; readonly reason: string };

interface CrawlReport {
  readonly discovered: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly rejected: readonly { url: string; reason: string }[];
}

interface ConversionResult {
  readonly written: readonly RelativePath[];
  readonly unresolved: readonly { source: SourceId; reason: string }[];
}

interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: RelativePath;
  readonly message: string;
}

interface ValidationReport {
  readonly issues: readonly ValidationIssue[];
  readonly conceptsChecked: number;
  readonly sourcesChecked: number;
  readonly ok: boolean;
}

interface SearchHit {
  readonly concept: Concept;
  readonly score: number;
  readonly matchedFields: readonly ("title" | "kind" | "description" | "tags" | "index")[];
}

type AgentToolCall =
  | { readonly name: "search_concepts"; readonly query: string }
  | { readonly name: "list_concepts"; readonly kind?: ConceptKind }
  | { readonly name: "read_concept"; readonly id: ConceptId }
  | { readonly name: "follow_links"; readonly id: ConceptId };

type AgentMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly calls: readonly { id: string; call: AgentToolCall }[];
    }
  | { readonly role: "tool"; readonly callId: string; readonly content: string };

interface AgentToolDefinition {
  readonly name: AgentToolCall["name"];
  readonly description: string;
  readonly parameters: Readonly<Record<string, string>>;
}

interface AgentTrace {
  readonly calls: readonly { tool: AgentToolCall; resultSummary: string }[];
  readonly query: string;
  readonly discoveredFromSearch: readonly ConceptId[];
  readonly discovered: readonly ConceptId[];
  readonly read: readonly ConceptId[];
  readonly traversed: readonly SupportedRelationship[];
  readonly sources: readonly SourceId[];
}

interface AgentRun {
  readonly question: string;
  readonly answer: string;
  readonly answerSources: readonly SourceId[];
  readonly trace: AgentTrace;
  readonly totalToolCalls: number;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

interface ChatRequest {
  readonly model: "openai/gpt-oss-120b";
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentToolDefinition[];
}

interface ChatResponse {
  readonly message: AgentMessage;
  readonly finish: "tool_calls" | "stop";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

interface EvaluationCase {
  readonly id: string;
  readonly question: string;
  readonly expectedConcepts: readonly ConceptId[];
  readonly expectedSources: readonly SourceId[];
}

interface EvaluationRecord {
  readonly caseId: string;
  readonly run: AgentRun;
  readonly expectedConcepts: readonly ConceptId[];
  readonly expectedSources: readonly SourceId[];
}

interface PageFetcher {
  fetch(url: CanonicalUrl): Promise<Uint8Array>;
}

interface EvidenceStore {
  saveSnapshot(snapshot: SourceSnapshot, bytes: Uint8Array): Promise<void>;
  replaceInventory(inventory: ReadonlyMap<CanonicalUrl, SourceId>): Promise<void>;
}

interface WorkspaceStore extends EvidenceStore {
  loadConcepts(): Promise<readonly Concept[]>;
  loadSnapshots(): Promise<ReadonlyMap<SourceId, SourceSnapshot>>;
  writeBundle(files: ReadonlyMap<RelativePath, string>): Promise<readonly RelativePath[]>;
  readBundle(): Promise<ReadonlyMap<RelativePath, string>>;
}

interface KnowledgeView {
  list(kind?: ConceptKind): readonly Concept[];
  read(id: ConceptId): Concept | undefined;
  follow(id: ConceptId): readonly SupportedRelationship[];
  search(query: string, limit?: number): readonly SearchHit[];
}

interface ChatProvider {
  complete(request: ChatRequest): Promise<ChatResponse>;
}

interface WorkspaceOptions {
  readonly groqApiKey?: string;
  readonly model?: "openai/gpt-oss-120b";
}

interface Workspace {
  crawl(seeds: readonly string[]): Promise<CrawlReport>;
  sources(): Promise<readonly SourceSnapshot[]>;
  convert(decisions: readonly Decision[]): Promise<ConversionResult>;
  validate(): Promise<ValidationReport>;
  search(query: string, limit?: number): Promise<readonly SearchHit[]>;
  ask(question: string, options?: { trace?: boolean }): Promise<AgentRun>;
}
```

Boundary constructors parse and validate external values once. The workspace exposes branded URLs and paths only after canonicalization and confinement checks. `SupportedClaim` and `SupportedRelationship` require evidence in the type; unresolved content has a different case and cannot be serialized as accepted knowledge by accident.

### Public functions

```ts
/** Open the one local knowledge workspace and its private adapters. */
async function openWorkspace(root: string, options?: WorkspaceOptions): Promise<Workspace>;

/** Turn network or fixture responses into canonical, deduplicated observations. */
async function crawlSources(
  seeds: readonly string[],
  fetcher: PageFetcher,
  store: EvidenceStore,
): Promise<CrawlReport>;

/** Compile reviewed decisions into the OKF v0.2 files and derived indexes. */
async function convertDecisions(
  decisions: readonly Decision[],
  store: WorkspaceStore,
): Promise<ConversionResult>;

/** Parse the bundle, check structural and evidence invariants, return all issues. */
async function validateBundle(store: WorkspaceStore): Promise<ValidationReport>;

/** Return a category-aware list from the parsed bundle. */
function listConcepts(view: KnowledgeView, kind?: ConceptKind): readonly Concept[];

/** Read one concept by stable identity; missing identity remains an explicit result. */
function readConcept(view: KnowledgeView, id: ConceptId): Concept | undefined;

/** Follow only relationships declared on the selected concept. */
function followLinks(view: KnowledgeView, id: ConceptId): readonly SupportedRelationship[];

/** Rank local concepts lexically; no network or model call occurs here. */
function searchConcepts(
  query: string,
  concepts: readonly Concept[],
  limit?: number,
): readonly SearchHit[];

/** Run a bounded Groq tool loop against this bundle, preserving a trace. */
async function answerQuestion(
  question: string,
  corpus: KnowledgeView,
  provider: ChatProvider,
  options?: { maxSteps?: number; trace?: boolean },
): Promise<AgentRun>;

/** Run a frozen set through the same agent path and persist auditable traces. */
async function evaluate(
  cases: readonly EvaluationCase[],
  workspace: Workspace,
): Promise<readonly EvaluationRecord[]>;
```

Function bodies are not implemented in this candidate. Each function is intended to be the responsibility of the workspace domain, except the thin CLI entry point and external transport adapters.

### Module map

```text
src/
  cli.ts                 Parse commands and render reports; no domain policy
  workspace.ts           Public Workspace API and local composition root
  knowledge.ts           Source, claim, concept, relationship, conversion, validation
  discovery.ts            Lexical search and bounded relationship traversal
  answering.ts            Groq tool loop, prompt policy, trace and usage capture
  adapters/
    site.ts               HTTP/fixture fetching, HTML extraction, URL scope rules
    files.ts              Private YAML/Markdown and filesystem representation
    groq.ts               Groq SDK/wire translation and token/latency capture

okf/                      Canonical portable OKF v0.2 bundle
evidence/
  snapshots/<digest>.html Immutable fetched source bytes
  inventory.json          Deterministic URL-to-snapshot inventory
decisions/
  initial.json             Human-reviewed conversion input
evaluation/
  questions.json           Fixed question set and expected evidence targets
  results/                  Recorded runs, traces, and metrics
```

There is no `crawler/`, `validation/`, or `agent/` package boundary. Those actions share knowledge invariants and use one workspace. The adapter files are boundaries because they translate HTTP, disk, and Groq protocols; they do not become public domain concepts. The `okf/` directory stays the portable corpus, separate from acquisition evidence and execution tooling as required by the plan.

### Data flow and ownership

1. `crawl` canonicalizes allowed same-site URLs, fetches HTML through `site.ts`, and extracts title, headings, body text, links, and metadata. It stores response bytes under their content digest, then updates a URL-keyed inventory deterministically. Fetch timestamps and transient failures belong to the run report, not to canonical generated files.
2. The inventory is reviewed and classified. A draft may suggest a type or concept match, but it cannot become an accepted concept unless its claims and each asserted relationship point to source evidence. Unsupported or ambiguous material stays unresolved or reference-only. The MVP may perform this classification by hand; no LLM-generated fact is trusted by default.
3. `convert` checks evidence references against the inventory and snapshots, derives stable concept paths from kind and normalized title, and emits OKF Markdown plus root/category indexes. Serialization maps the domain into the exact OKF v0.2 shape after confirming the specification. If a generated path was hand-edited since the prior conversion, conversion reports a conflict rather than silently replacing it.
4. `validate` reads the actual bundle through the private file adapter. It checks parseability, required metadata and Markdown shape, internal links and file references, index consistency, reserved files, duplicate concepts, valid sources, evidence references, and applicable v0.2 requirements. Semantic review remains a human check against source snapshots; a structural validator cannot prove a claim true.
5. `search` builds a small in-memory lexical view from parsed title, kind, description, tags, and index references. It tokenizes the query and fields, scores exact normalized term overlap, weights title and kind matches above descriptions and tags, and breaks ties by stable concept ID. Results include matched fields. The agent discovers concepts by search/list, reads only relevant concepts, then follows explicit relationship links for multi-hop questions.
6. `ask` passes the question and tool definitions to Groq using `openai/gpt-oss-120b`. Each tool call is parsed into `AgentToolCall`, executed against the local workspace, and returned as domain data. A fixed maximum of 10 tool turns bounds the loop. The system prompt requires the model to use indexes for discovery, read concepts before answering, traverse declared relationships for multi-hop questions, cite discovered source IDs, and say when evidence is insufficient. Tool traces retain concept and source IDs, so the CLI can show calls, reads, traversals, sources, answer, latency, and token usage. The Groq adapter parses external tool arguments at the boundary; malformed calls become tool errors rather than unchecked domain values.
7. Evaluation invokes the same `ask` entry point for each fixed question, stores its trace and metrics, and permits later comparison with the existing RAG using identical questions. It does not call the RAG system or share its embeddings, index, or retrieval code.

The public interface hides URL policy, snapshots, content deduplication, schema translation, index generation, lexical ranking, validation, Groq protocol details, and instrumentation. Callers see a small set of workspace operations and domain results. This is deliberately a deeper workspace module instead of a chain of shallow stage wrappers.

### Idempotency and provenance rules

- Canonical URL plus content digest identifies each observation. Identical fetches reuse the same snapshot; changed bytes create a new immutable snapshot and replace only the current URL pointer in the deterministic inventory. Repeating an unchanged crawl creates no duplicate pages or concepts.
- `convert` is a deterministic projection of accepted decisions. Stable concept IDs and paths, sorted relationships and sources, and reproducible Markdown make a repeated conversion byte-identical. A conversion that encounters a manually changed generated file stops with a conflict, preserving review work.
- Every accepted claim and edge carries one or more exact evidence quotes and locators into a source snapshot. OKF `resource`/`sources` links and any claim-level detail are serialized only in forms permitted by the confirmed v0.2 spec; the richer locator ledger can remain in `evidence/` if the format has no standard field.
- A page's existence, title, navigation, or type is not evidence for every statement in its body. The converter never fills gaps with model knowledge. Semantic checks compare each claim and relationship with its cited snapshot.
- No embeddings, vector database, semantic search, external search API, or external RAG enters this workspace.

## Synthesis decision

This file is Candidate A, a standalone design candidate as requested. It has not been synthesized with a second runner candidate. Its distinctive choice is to center ownership on one evidence-backed workspace rather than separate crawler, validator, and agent modules.

## Tradeoffs accepted

- We accept a human review gate for early conversion in exchange for a corpus that does not silently promote unsupported model output into company facts.
- We accept a local filesystem workspace and in-memory lexical ranking in exchange for a portable MVP with no hosted database or vector service.
- We accept stable normalized-title paths and explicit edit-conflict handling in exchange for repeatable conversion that does not erase human corrections.
- We accept confirming the OKF v0.2 serialization details during the first implementation phase in exchange for keeping internal types independent of Markdown/YAML and avoiding invented schema requirements.
- We accept a fixed-step Groq tool loop and visible evidence trace in exchange for bounded, inspectable agent runs; model answers still need evaluation because a trace alone does not establish correctness.

## Alternatives considered

- **Conventional crawler, validator, and agent packages.** Each package can own its implementation but exposes stage-specific interfaces and shared representations to callers. The operator or orchestration code must coordinate crawl, conversion, validation, and answering. That shape has a longer call chain and spreads evidence rules across boundaries; the workspace hides those rules in one domain API.
- **LLM-first site-to-Markdown conversion.** It makes corpus creation look simple, but exposes prompt and retry policy while hiding the unsupported-claim problem in generated prose. It cannot give a small caller interface a reliable way to distinguish source facts from model completions. This loses the source-backed guarantee, so candidate concepts must carry evidence before conversion.
- **Static generated search index as the primary corpus.** It can make lookup fast, but creates a second knowledge representation that must stay synchronized with Markdown and links. For a 50–100 concept MVP, building lexical ranking from the parsed bundle keeps the OKF files as the single source of truth and costs less than maintaining an index lifecycle.

## Open questions and risks

- Which exact OKF v0.2 document and required metadata rules will implementation treat as authoritative? The plan gives an example but not the full schema.
- Should the initial converter accept only human-reviewed decisions, or may Groq propose candidate claims in a review file? Either way, acceptance must require evidence.
- What crawl scope and politeness limits should apply to the named site, and does it expose a sitemap or crawl policy? The candidate assumes neither.
- Does the selected Groq SDK response for this model provide token usage and tool-call fields in the needed shape? The private adapter should verify this with a live smoke run.
- Stable title-derived paths can collide or shift after a title correction. The converter should detect collisions and require an explicit identity decision rather than guess.
- Source pages can change or disappear after a crawl. Immutable snapshots preserve what supported a claim at conversion time, but corpus maintenance still needs a staleness review.
- Lexical search will miss paraphrases that share no terms. That is a measured experimental limitation, not a reason to add embeddings to this implementation.

## Viable MVP phases

1. **Workspace and spec boundary.** Create the Node/TypeScript CLI and workspace API; confirm the actual OKF v0.2 rules; define the concept/evidence model and deterministic file mapping. Build the validator against a tiny hand-authored, source-backed bundle before crawling.
2. **Evidence acquisition.** Implement bounded same-site crawling and HTML extraction; save immutable content-addressed snapshots and a deterministic inventory. Verify that a repeated fixture crawl is unchanged and that changed page bytes create a new observation without duplicating URLs.
3. **Reviewed initial corpus.** Classify available source material and accept only evidence-backed claims and relationships. Convert a representative initial set, generate indexes, run structural validation, and manually check source accuracy. Reach the plan's 50–100 concept target only if the site evidence supports it.
4. **Offline navigation.** Implement list/read/follow and lexical search over the parsed OKF bundle. Verify calls and multi-hop traces locally without a Groq key; keep the whole corpus out of each prompt.
5. **Groq and CLI run.** Add the bounded tool loop, `ask`, safe configuration from environment variables, visible trace output, and token/latency capture. Run a live smoke question and record whether the agent reached its answer through OKF tools.
6. **Evaluation and expansion.** Freeze a question set with expected source/concept targets, store every run and metric, then expand only after initial review. Compare the same question set with the existing RAG outside this workspace; keep the two retrieval pipelines independent.

## Runtime verification

The first useful proof is an end-to-end local run, not a successful TypeScript build:

```powershell
npm run okf -- crawl --fixture fixtures/site
npm run okf -- convert --decisions fixtures/decisions.json
npm run okf -- validate
npm run okf -- search "<fixture concept terms>" --trace
```

The fixture corpus should contain only its own stated facts. The local run must show source IDs and concept IDs through the search result, and validation must inspect the written OKF files. Run crawl and conversion twice and compare canonical inventory and corpus bytes; unchanged input should produce no diff. Then, with `GROQ_API_KEY` configured, run one live `ask --trace` and confirm the reported model, tool calls, discovered/read concepts, followed relationships, cited sources, answer, latency, and available token counts. Record unavailable usage fields as null rather than fabricate them.

## Next implementation step

Confirm the authoritative OKF v0.2 requirements, then implement the domain types, fixture-backed workspace store, and validator against one deliberately small bundle before adding network crawling.
