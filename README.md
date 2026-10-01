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

The terminal chat is still available explicitly:

```powershell
npm run okf -- tui
```

One-off commands are also available:

```powershell
npm run okf -- list
npm run okf -- search "application modernization"
npm run okf -- ask "Which services are related to application modernization?"
```

The answer command prints tool calls, concepts discovered and read, evidence-backed relationships followed, sources, unverified citation URLs, the answer, latency, and token counts when Groq returns them. If Groq answers without using a knowledge tool, the agent declines to answer from the bundle.

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
