# InfoMagnus OKF agent

This repository crawls `infomagnus.com`, stores a source inventory, builds an Open Knowledge Format bundle, and answers questions through local OKF navigation tools and Groq's `openai/gpt-oss-120b` model.

The agent uses lexical matching. It does not use embeddings, a vector database, semantic retrieval, a search API, or external RAG.

## Setup

Install Node.js 20 or later, then run:

```powershell
npm install
Copy-Item .env.example .env
```

Set `GROQ_API_KEY` in `.env` to chat with the knowledge base. The crawl, validation, search, and tests do not need a key.

The default model is `openai/gpt-oss-120b`. Set `GROQ_MODEL` in `.env` to choose another Groq model.

## Crawl and build the bundle

```powershell
npm run crawl -- --site https://www.infomagnus.com --limit 100
npm run okf -- convert
npm run validate
```

The crawl writes `site-inventory.json`. Commit the inventory with the bundle so source checks work without a new crawl. Conversion creates concepts from captured pages with source excerpts and evidence-backed links. It replaces generated concept files, indexes, and `okf/log.md` deterministically. Do not edit generated files by hand. When a page cannot be refreshed, its previous capture is retained and marked stale; a partial crawl is not eligible for conversion.

The checked-in initial corpus contains 68 concepts from 71 captured, relevant pages. The crawler uses an allowlist for the site's service, solution, partner, insight, and content-collection pages. Review classifications and relationships before using the corpus as a final semantic dataset. The converter records a `references` relationship only when linked text also appears in the source page.

## Navigate and answer

```powershell
npm start
# or: npm run chat
```

This starts the local browser chat at `http://127.0.0.1:4317` and opens it in your default browser. The server listens only on loopback. Type a question in the single-line field and press Enter to send. Answers support Markdown. Choose light or dark appearance with the header toggle. The first visit follows your system setting; a choice is saved in this browser. Conversations stay in the tab and are not saved. The browser sends questions through this computer to Groq. Do not expose the local server to a network.

To choose a port, run `npm run chat -- --port 4321`. To disable automatic browser launch, set `BROWSER=none`.

One-off commands are also available:

```powershell
npm run okf -- list
npm run okf -- search "application modernization"
npm run okf -- ask "Which services are related to application modernization?"
```

The answer command prints tool calls, concepts discovered and read, evidence-backed relationships followed, sources, unverified citation URLs, the answer, latency, and token counts when Groq returns them. If Groq answers without using a knowledge tool, the agent declines to answer from the bundle.

## Deploy the browser app

The local app runs its GUI and `/api/ask` endpoint in Node. The deployed site uses GitHub Pages for the browser files and a Cloudflare Worker for `/api/ask`. The Worker reads the OKF catalog generated from `okf/` and keeps `GROQ_API_KEY` in a Cloudflare secret.

### Configure Cloudflare

1. Create a Cloudflare API token scoped to deploy Workers in the account that will host this app.
2. Add the token to the repository's Actions secrets as `CLOUDFLARE_API_TOKEN`.
3. Add the Cloudflare account ID as the Actions secret `CLOUDFLARE_ACCOUNT_ID`.

### Deploy the Worker

Run the `Deploy Worker` workflow from the Actions tab, or push a change under `agent/src/worker.ts`, `agent/src/core-agent.ts`, `agent/src/catalog.ts`, `agent/prompts/`, `okf/`, or `wrangler.jsonc` to `master`. The Worker workflow builds the catalog and deploys the API.

After the first deploy creates the Worker, run `npx wrangler login` and `npx wrangler secret put GROQ_API_KEY`. Enter the Groq key at Wrangler's prompt. You can also add it under the Worker settings in Cloudflare. Never add this key to GitHub Actions or the Pages build.

The first successful deployment creates the Worker URL. Add its HTTPS origin, without a path or trailing route, as the repository Actions variable `PUBLIC_API_BASE`. For example, use `https://infomagnus-okf-agent-api.<your-workers-subdomain>.workers.dev` with your actual Workers subdomain.

### Publish GitHub Pages

Set the repository's Pages source to **GitHub Actions**. Run the `Deploy Pages` workflow from the Actions tab or push a change under `agent/web/` to `master`. The workflow requires `PUBLIC_API_BASE` and fails if it is empty. It publishes the site at `https://grok08.github.io/okf-knowledge-agent/`.

The Worker accepts requests from `https://grok08.github.io` and applies a 10-request-per-minute per-IP limit. Confirm that the rate-limit `namespace_id` in `wrangler.jsonc` is unused in your Cloudflare account before the first deploy. Reuse that value for later deploys.

Cloudflare applies each rate-limit counter per edge location and updates counters asynchronously. This limit reduces ordinary bursts but is not a strict spend cap. Users behind the same proxy can share an IP limit. CORS restricts browser origins but does not authenticate callers, so the public endpoint can still receive direct requests. Review usage and Groq spend.

Pull requests run tests, typecheck, validation, and both build checks. `npm run build:catalog`, `npm run build:pages`, and `npm run build:worker` run those builds locally. Set `PUBLIC_API_BASE` only when you need the Pages artifact to call a deployed Worker.

## Validate and test

```powershell
npm run validate
npm test
npm run typecheck
```

The validator checks frontmatter, required fields, source and evidence references, internal links, category indexes, duplicate concepts, and the metadata contract used by this repository. `plan.md` does not identify an authoritative OKF v0.2 specification, so the validator does not claim complete conformance beyond that contract.

## Evaluate

Edit `evaluation/evaluation-set.json` to add source-grounded questions. Run:

```powershell
npm run okf -- eval
```

The command writes traces and available usage data to `evaluation/results/okf-results.json`. Compare those same questions with the existing RAG separately. This repository does not connect to or change that system.
