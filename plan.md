# InfoMagnus OKF + Groq GPT-OSS 120B — Complete Build Plan

## Objective

Build an **Open Knowledge Format (OKF) v0.2 knowledge base from infomagnus.com** and an **OKF-aware agent** that uses **Groq's `openai/gpt-oss-120b`** to answer questions over that knowledge base.

The existing vector-based RAG system is already deployed and is **out of scope** for this implementation. It will only be used later as the comparison baseline.

## Target Architecture

```text
infomagnus.com
      |
      v
Website Crawler
      |
      v
OKF v0.2 Knowledge Base
      |
      v
OKF Agent
      |
      v
Groq API
      |
      v
openai/gpt-oss-120b
      |
      v
Answer
```

## Experimental Principle

The OKF Agent must own knowledge discovery.

Do **not** introduce into the OKF implementation:

- Embeddings
- Vector databases
- Semantic/vector retrieval
- External RAG
- Search APIs

The goal is to test whether **structured OKF knowledge + agentic navigation** behaves differently from the existing vector-based RAG system.

---

# Phase 1 — Create Repository

**Dependency:** None  
**Execution:** Start here

Create:

```text
infomagnus-okf/
|
├── okf/
│   ├── index.md
│   ├── log.md
│   ├── company/
│   ├── services/
│   ├── solutions/
│   ├── industries/
│   ├── technologies/
│   ├── capabilities/
│   ├── case-studies/
│   └── insights/
|
├── agent/
│   ├── src/
│   ├── prompts/
│   └── tools/
|
├── ingestion/
│   ├── crawler/
│   ├── extractor/
│   └── converter/
|
├── validation/
|
├── evaluation/
│   ├── questions/
│   └── results/
|
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

### Important

The `okf/` directory is the actual OKF bundle.

The following are implementation tooling and are not part of the OKF bundle:

```text
agent/
ingestion/
validation/
evaluation/
```

---

# Phase 2 — Configure Groq

**Dependency:** Phase 1  
**Execution:** Can run in parallel with Phase 3

Use:

```text
Provider: Groq
Model: openai/gpt-oss-120b
```

Create `.env`:

```env
GROQ_API_KEY=your_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

Create `.env.example`:

```env
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
```

Add to `.gitignore`:

```gitignore
.env
node_modules/
dist/
```

Install the SDK:

```powershell
npm install groq-sdk dotenv
```

The API key stays local to this repository and must not be committed.

---

# Phase 3 — Define the InfoMagnus Knowledge Model

**Dependency:** None  
**Execution:** Can run in parallel with Phase 2

Create:

```text
knowledge-model.md
```

Define the initial concept types:

```text
Organization
Service
Solution
Industry
Technology
Capability
CaseStudy
Insight
Outcome
```

Define the relationships.

Example:

```text
Service -> supports -> Capability
Service -> uses -> Technology
Service -> serves -> Industry
Service -> demonstrated_by -> CaseStudy

Solution -> supports -> Capability
Solution -> uses -> Technology

CaseStudy -> demonstrates -> Service
CaseStudy -> demonstrates -> Outcome

Insight -> discusses -> Technology
Insight -> discusses -> Service
```

The purpose is to define **what constitutes knowledge**, rather than simply converting webpages into Markdown.

### Deliverable

```text
knowledge-model.md
```

---

# Phase 4 — Crawl infomagnus.com

**Dependency:** Phase 3  
**Execution:** Sequential

Build the website crawler.

For every relevant page capture:

```text
URL
Title
Headings
Body content
Internal links
External links
Metadata
```

Generate:

```text
site-inventory.json
```

Example:

```json
{
  "url": "https://www.infomagnus.com/...",
  "title": "Application Modernization",
  "candidate_type": "Service",
  "links_to": [
    "..."
  ]
}
```

Do not generate OKF yet.

The purpose of this phase is to establish a complete source inventory.

---

# Phase 5 — Classify Website Content

**Dependency:** Phase 4  
**Execution:** Sequential

Classify each page/content item as one of:

```text
New concept
Existing concept
Supporting evidence
Reference-only content
```

Examples:

```text
/service/...       -> Service
/solutions/...     -> Solution
/industries/...    -> Industry
/case-studies/...  -> CaseStudy
/insights/...      -> Insight
```

Avoid creating duplicate concepts where multiple pages describe the same underlying entity.

### Deliverable

A classified website inventory that maps source pages to candidate OKF concepts.

---

# Phase 6 — Generate Initial OKF Bundle

**Dependency:** Phase 5  
**Execution:** Sequential

Generate an initial corpus of approximately:

```text
50–100 concepts
```

Suggested structure:

```text
okf/
├── index.md
├── log.md
├── company/
├── services/
├── solutions/
├── industries/
├── technologies/
├── capabilities/
├── case-studies/
└── insights/
```

Example concept:

```markdown
---
type: Service
title: Application Modernization
description: ...
resource: https://www.infomagnus.com/...
sources:
  - resource: https://www.infomagnus.com/...
status: current
---

# Application Modernization

...

## Related concepts

- [GitHub Migration](../services/github-migration.md)
- [GitHub Copilot](../technologies/github-copilot.md)
- [SONYX](../solutions/sonyx.md)
```

Relationships should be evidence-based.

Do not let the model invent relationships.

---

# Phase 7 — Build the OKF Index Structure

**Dependency:** Phase 6  
**Execution:** Can run in parallel with Phase 8

Create hierarchical indexes:

```text
okf/index.md
okf/services/index.md
okf/solutions/index.md
okf/industries/index.md
okf/technologies/index.md
okf/capabilities/index.md
okf/case-studies/index.md
okf/insights/index.md
```

The indexes should enable progressive discovery:

```text
Root index
    |
    v
Category index
    |
    v
Concept
    |
    v
Related concept
```

Do not require the model to receive the entire repository.

---

# Phase 8 — Build the OKF Validator

**Dependency:** Phase 6  
**Execution:** Can run in parallel with Phase 7

Implement automated validation.

Validate:

```text
YAML parsing
Required type field
Markdown structure
Internal links
File references
Index structure
Reserved files
Duplicate concepts
Invalid sources
OKF v0.2 requirements
```

Command:

```powershell
npm run validate
```

Expected result:

```text
OKF validation passed
```

---

# Phase 9 — Semantic Validation

**Dependency:** Phase 6  
**Execution:** Can run in parallel with Phase 7 and Phase 8

Review representative concepts manually.

Check:

```text
Concept accuracy
Relationship accuracy
Source accuracy
Duplicate concepts
Missing concepts
Unsupported claims
Incorrect classifications
```

Use provenance metadata where appropriate.

### Deliverable

Validated initial OKF corpus.

---

# Phase 10 — Build OKF Agent Tools

**Dependency:** Phase 6  
**Execution:** Can run in parallel with Phases 7–9

Create:

```text
agent/
├── src/
│   └── tools/
│       ├── list-concepts.ts
│       ├── read-concept.ts
│       ├── search-concepts.ts
│       └── follow-links.ts
```

Core operations:

```text
list_concepts()
read_concept(path)
search_concepts(query)
follow_links(path)
```

### Important Experimental Constraint

`search_concepts()` must not use embeddings or vector search.

Use:

```text
Concept title
Concept type
Description
Tags
Index references
Lexical matching
```

This preserves the distinction between OKF navigation and the existing vector RAG implementation.

---

# Phase 11 — Build the OKF Agent Loop

**Dependency:** Phase 10  
**Execution:** Sequential

The agent workflow should be:

```text
User Question
      |
      v
GPT-OSS 120B
      |
      v
Tool Call
      |
      v
OKF Tool Executes
      |
      v
Tool Result
      |
      v
GPT-OSS 120B
      |
      +---- another tool call ----+
      |                           |
      +---------------------------+
      |
      v
Final Answer
```

Set a maximum number of agent steps:

```text
MAX_AGENT_STEPS=10
```

This prevents infinite tool loops.

---

# Phase 12 — Define the OKF Agent System Prompt

**Dependency:** Phase 11

Create:

```text
agent/prompts/system.md
```

Core instructions:

```text
You are an OKF knowledge agent.

The repository contains an Open Knowledge Format v0.2 knowledge base.

Treat the OKF bundle as structured knowledge, not merely as a
collection of Markdown files.

Use the indexes for discovery.

Identify relevant concepts before answering.

Read the relevant concepts.

Follow explicit relationships between concepts when required.

Use source and provenance metadata when available.

Do not invent concepts, facts, or relationships.

For multi-hop questions, traverse the relevant concept relationships.

Answer only from knowledge discovered through the OKF tools.

Use supporting concepts and sources when producing the final answer.
```

---

# Phase 13 — Connect OKF Agent to GPT-OSS 120B

**Dependency:** Phase 11  
**Execution:** Can run in parallel with Phase 12

Configure:

```text
Provider = Groq
Model = openai/gpt-oss-120b
```

The agent should send the relevant OKF information to the model only after the agent has discovered it.

Do not send the entire OKF repository on every request.

---

# Phase 14 — Build Local CLI

**Dependency:** Phase 13  
**Execution:** Sequential

Create a simple command:

```powershell
npm run okf
```

Example:

```text
OKF Agent
Model: openai/gpt-oss-120b

> Which services are related to application modernization?
```

The CLI should display:

```text
Question
Tool calls
Concepts discovered
Relationships followed
Final answer
```

This provides an easy way to verify that the agent is genuinely navigating OKF.

---

# Phase 15 — Expand the OKF Knowledge Base

**Dependency:** Phases 8 and 9  
**Execution:** Sequential

Once the 50–100 concept version is validated, process the remaining relevant website content.

Perform:

```text
Deduplication
Concept consolidation
Relationship cleanup
Source cleanup
Metadata cleanup
Staleness review
```

Target:

```text
infomagnus-okf-v1
```

Do not scale up before the initial corpus is validated.

---

# Phase 16 — Create Evaluation Dataset

**Dependency:** Phase 3  
**Execution:** Can run in parallel with almost all other phases

Create approximately:

```text
50 questions
```

Suggested categories:

```text
10 — Simple factual
10 — Relationship
10 — Multi-hop
10 — Cross-domain
10 — Deep-content
```

Focus heavily on questions that require navigating relationships.

Examples:

```text
Which services are related to application modernization?

Which technologies are associated with a specific capability?

Which case studies demonstrate a specific service?

Which solutions are relevant to a particular industry?

How are a service, capability, technology and case study related?
```

Store:

```text
evaluation/evaluation-set.json
```

---

# Phase 17 — Instrument the OKF Agent

**Dependency:** Phase 14  
**Execution:** Can run in parallel with Phase 15 and Phase 16

Capture:

```text
Question
Tool calls
Concepts discovered
Concepts read
Links followed
Sources used
Final answer
Latency
Input tokens
Output tokens
```

Example:

```json
{
  "question": "...",
  "concepts": [
    "services/application-modernization.md",
    "technologies/github-copilot.md"
  ],
  "links_followed": 4,
  "answer": "...",
  "latency_ms": 2140
}
```

This will allow the experiment to show **how the OKF agent reached an answer**, not just what answer it produced.

---

# Phase 18 — Run OKF Evaluation

**Dependency:** Phases 13, 16, 17  
**Execution:** Sequential

Run the full evaluation set through the OKF Agent.

Capture:

```text
Answer
Concepts used
Relationships traversed
Sources used
Latency
Token usage
```

Generate:

```text
evaluation/results/okf-results.json
```

---

# Phase 19 — Compare with Existing RAG

**Dependency:** Phase 18  
**Execution:** Final step

The existing vector-based RAG remains unchanged.

Run the exact same questions against both systems.

```text
                    Same questions
                          |
             +------------+------------+
             |                         |
             v                         v
       Existing RAG                OKF Agent
                                      |
                                  Groq 120B
```

Compare:

```text
Answer correctness
Groundedness
Citation accuracy
Relationship accuracy
Multi-hop success
Hallucination rate
Latency
Token consumption
```

The objective is to determine **where OKF performs differently from your existing vector-based RAG**.

---

# Parallelization Plan

## Start Immediately

These can begin in parallel:

```text
Phase 1 — Repository setup
Phase 2 — Groq configuration
Phase 3 — Knowledge model
Phase 16 — Evaluation question design
```

## After Knowledge Model

```text
Phase 3
   |
   +---- Phase 4 — Website crawl
   |
   +---- Phase 16 — Evaluation dataset
```

## After Initial Website Inventory

```text
Phase 4
   |
   v
Phase 5 — Content classification
   |
   v
Phase 6 — Initial OKF generation
```

## Once Initial OKF Exists

These can run in parallel:

```text
Phase 7  — Index structure
Phase 8  — Structural validator
Phase 9  — Semantic validation
Phase 10 — OKF Agent tools
Phase 12 — Agent system prompt
```

## After Agent Tools Exist

```text
Phase 10
   |
   v
Phase 11 — Agent loop
   |
   v
Phase 13 — Groq integration
   |
   v
Phase 14 — CLI
```

## Final Sequence

```text
Validated OKF
      +
Working OKF Agent
      +
Evaluation dataset
      |
      v
OKF Evaluation
      |
      v
Comparison with Existing RAG
```

---

# Recommended Execution Order

For the actual implementation, follow this order:

```text
1. Create repository
2. Configure Groq
3. Define knowledge model
4. Crawl infomagnus.com
5. Classify website content
6. Generate 50–100 OKF concepts
7. Build hierarchical indexes
8. Build OKF validator
9. Perform semantic validation
10. Build OKF tools
11. Build agent loop
12. Write OKF Agent system prompt
13. Connect GPT-OSS 120B
14. Build CLI
15. Test manually
16. Expand OKF to full website
17. Instrument the agent
18. Build/finalize evaluation dataset
19. Run OKF benchmark
20. Compare against existing RAG
```

---

# Final Repository Structure

```text
infomagnus-okf/
|
├── okf/
│   ├── index.md
│   ├── log.md
│   ├── company/
│   ├── services/
│   ├── solutions/
│   ├── industries/
│   ├── technologies/
│   ├── capabilities/
│   ├── case-studies/
│   └── insights/
|
├── agent/
│   ├── src/
│   │   ├── agent.ts
│   │   ├── loop.ts
│   │   ├── groq.ts
│   │   └── tools/
│   │       ├── list-concepts.ts
│   │       ├── read-concept.ts
│   │       ├── search-concepts.ts
│   │       └── follow-links.ts
│   └── prompts/
│       └── system.md
|
├── ingestion/
│   ├── crawler/
│   ├── extractor/
│   └── converter/
|
├── validation/
|
├── evaluation/
│   ├── evaluation-set.json
│   └── results/
|
├── knowledge-model.md
├── site-inventory.json
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

# Success Criteria

The project is complete when:

```text
[ ] infomagnus.com has been represented as an OKF v0.2 bundle
[ ] OKF validates successfully
[ ] Concepts have explicit relationships
[ ] Sources/provenance are captured
[ ] OKF Agent can navigate concepts
[ ] Agent can perform multi-hop traversal
[ ] Agent uses GPT-OSS 120B through Groq
[ ] No embeddings/vector DB are used by the OKF Agent
[ ] Agent behavior is instrumented
[ ] Fixed evaluation set exists
[ ] OKF results can be compared against the existing RAG
```

---

# Core Experimental Boundary

```text
Existing RAG:
    Website -> Chunking -> Embeddings -> Vector DB -> RAG -> LLM

OKF:
    Website -> Concepts -> OKF -> OKF Agent -> LLM
```

Keep these two pipelines independent until the final comparison.

---

# Recommended MVP

The fastest meaningful implementation is:

```text
1. Create repository
2. Configure Groq
3. Define knowledge model
4. Crawl website
5. Generate 50–100 OKF concepts
6. Validate OKF
7. Build OKF tools
8. Build OKF Agent
9. Connect GPT-OSS 120B
10. Run manual questions
11. Expand the corpus
12. Run benchmark
```

The key principle is:

> **First prove that the knowledge representation works. Then scale the corpus and optimize the agent.**
