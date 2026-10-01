# GitHub Pages and Cloudflare Worker

## Problem

The browser app currently posts questions to `/api/ask` on the local Node server. That server loads the OKF Markdown files, runs the tool loop, and calls Groq with a server-side key. GitHub Pages can host the browser files but cannot run this Node endpoint. The deploy target must therefore keep the key off the public page and preserve the local Node workflow.

## Usage

The local user continues to run `npm start` and submit a question in the browser. The deployed user opens `https://grok08.github.io/okf-knowledge-agent/` and submits the same question. In production the browser posts to the Cloudflare Worker URL. The Worker returns the existing `AgentRun` JSON shape.

## Shape

The runtime-neutral agent core accepts a typed catalog, a system prompt, and a model completion function. It does not load files, read environment variables, or handle HTTP.

```ts
export type KnowledgeCatalog = {
  version: 1;
  concepts: KnowledgeConcept[];
};

export type KnowledgeConcept = {
  path: string;
  type: ConceptType;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  evidence: Evidence;
  relations: Array<{
    kind: RelationKind;
    target: string;
    evidence: Evidence;
  }>;
};

export type AgentRuntime = {
  catalog: KnowledgeCatalog;
  systemPrompt: string;
  completeTurn: (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ModelTurn>;
};

export function runAgent(
  runtime: AgentRuntime,
  question: string,
  options?: AgentOptions,
): Promise<AgentRun>;
```

`path` and relation `target` always use slash-separated paths relative to the OKF root. The Node adapter translates `OkfBundle` paths at its boundary. The Worker validates catalog JSON once when it loads the static asset. The core owns tool execution, citation collection, and step limits. The Node adapter continues to use the Groq SDK. The Worker adapter uses `fetch` and parses Groq's response with a schema.

The Worker owns origin checks, request validation, CORS responses, per-IP limits, provider error redaction, and secret access. It serves `POST /api/ask` only. GitHub Pages serves the browser files and has no Groq credential.

## Synthesis decision

The `poteto-agent` profile implemented one shared runtime-neutral agent core with Node and Worker adapters. The requested routing instruction prohibited starting sibling agents, so no parallel Arena design pass ran. The alternative design is recorded below. The implementation should be reviewed against that alternative before release.

## Tradeoffs accepted

- We accept a small adapter around the current Node agent in exchange for one implementation of the tool loop and citation behavior.
- We accept a generated static catalog asset in the Worker deployment in exchange for keeping Markdown parsing and filesystem APIs out of the Worker runtime.
- We accept a public endpoint with a best-effort per-IP limit in exchange for no login step. Cloudflare counters are per edge location and asynchronously updated, so they do not guarantee a hard spend cap. CORS is not treated as API authentication.
- We accept an API URL build setting in exchange for using the same browser files locally and on Pages.

## Alternatives considered

- Keep `agent.ts` unchanged and write a separate Worker agent. This avoids refactoring local code, but exposes two copies of the tool definitions, model loop, citation logic, and response behavior. It loses on interface depth because each runtime owns and maintains the full implementation.
- Deploy the existing Node server to a Node host and keep GitHub Pages for the GUI. This preserves the server implementation, but requires operating a separate Node service and adapting host/origin checks. Workers fit the requested Cloudflare account and do not require a general Node server.

## Open questions and risks

- Does the serialized concept catalog fit the selected Worker static-asset packaging limits? Measure the generated file before choosing the final binding.
- Does the configured Groq account allow the selected GPT-OSS model from Cloudflare Workers? Verify with a live request before enabling Pages deployment.
- Does the rate-limit `namespace_id` in `wrangler.jsonc` conflict with a binding in the Cloudflare account? Check it before the first deploy. Reuse the same unused ID on subsequent deploys.
- What exact per-IP request budget fits expected use and Groq spend? Start at 10 requests per minute and adjust from observed traffic. Cloudflare applies counters per edge location, so the limit cannot provide a hard spend ceiling.
- Is the Cloudflare account authorized for the Worker rate-limit binding and GitHub Actions token scope? Verify during provisioning.

## Next implementation step

Build a deterministic catalog exporter from `OkfBundle` and test that it preserves normalized paths, evidence, relations, and byte-for-byte repeatability.
