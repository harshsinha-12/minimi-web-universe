# minimi — a little more context

A conversational research agent for the minimi hiring challenge. It remembers actual conversations, checks changing facts using **OpenAI hosted web search**, and distinguishes an earlier answer from current evidence.

## Run locally

Requires Node.js 22.13 or newer. Create `.env` using [.env.example](.env.example) if it does not exist, and set `OPENAI_API_KEY`. Existing `.env` files are preserved.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). The dev command starts the web app and consolidation worker together. SQLite migrations run automatically. Optional Redis credentials enable context caching and worker wake-ups; a Redis outage falls back to SQLite.

Default answer model: `gpt-6-astra`. Memory synthesis and conditional coverage review use `gpt-5.4-mini`. Both are configurable. `npm run check:services` verifies model visibility and performs a temporary Redis write/read. It does not print credentials.

## What works

- Streamed chat, Markdown, inline citations, consulted-source links, stop, history navigation, and research traces.
- Owner-scoped, durable messages and idempotent turns in SQLite; original message links support historical answers.
- Cross-thread retrieval using dates, FTS5, recent context, source-linked memories, and optional Pinecone semantic recall. Relative dates use the request's local timezone.
- Live OpenAI web search is the only agent-facing tool. Internal retrieval and memory synthesis are application functions.
- Rechecks can make up to two targeted follow-up passes after a conditional coverage review. Candidate rechecks are held until publication so provisional drafts do not appear as final answers.
- Background memory consolidation with exact user-message support, versioned snapshots, applicability expiry, durable outbox, fenced leases, revision checks, bounded retries, and source exclusions for forgotten memory.
- Inspect memories, open their source conversations, request a refresh, or forget derived context. Correct a preference by saying so in chat; raw recent corrections accompany older memory while consolidation catches up.

The visual direction draws from [minimi](https://www.projectminimi.com/) and [Wispr Flow](https://wisprflow.ai/). This is an independent challenge submission, not their product.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run eval
```

`npm run eval` runs all deterministic tests without API requests. `npm run eval:judge` calibrates the evidence-aware judge on synthetic good/bad answers; `npm run eval:agent` evaluates the production agent on isolated historical fixtures. These live evaluation commands spend API credits and write ignored reports to `.data/evals/`. Judge calibration is not an agent quality benchmark. Other live checks:

```sh
npx tsx scripts/live-smoke.ts
npx tsx scripts/live-scenarios.ts
```

The scenario script creates an isolated browser identity and a **synthetic** dated CRM shortlist. It never inserts fixture history into the normal UI user's identity. Local outputs go to ignored `.data/evals/`.

## Architecture and evidence

- [One-page DESIGN.md](DESIGN.md)
- [Architecture diagrams, memory flow, and responsibility chart](docs/architecture.md)
- [Build plan and dependency chart](plan.md)
- [Verification results and limitations](docs/EVALUATION.md)
- [Challenge requirements](CHALLENGE_BRIEF.md)
- [MultiBagg reference findings](docs/multibagg-review.md)

## Data and deployment boundaries

Messages, returned provider artifacts, runs, and memory versions live in `.data/minimi.sqlite` (override `DATABASE_PATH`). This file and all credentials are ignored by Git. An HTTP-only opaque browser cookie scopes access; clearing it creates a new workspace. There is no account recovery or production authentication system.

Relevant context is sent to OpenAI for answers and memory synthesis. Redis may contain temporary conversation context. This is **not** an entirely on-device assistant. Provider requests use `store: false`; the application retains its own returned artifacts, not a complete raw-page archive.

For a production-style local run, use `npm run build`, then `npm start` and `npm run worker` in separate processes. The two processes require shared access to the same SQLite file. Multi-host deployment, transcript editing/deletion controls, full semantic citation verification, and comprehensive held-out quality evaluation remain future work. No deployment or submission has been performed.

## Optional semantic memory and source previews

Pinecone is disabled by default. When keys are available, configure `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, and `PINECONE_ENABLED=true`. Use a dense cosine index matching `EMBEDDING_DIMENSIONS` (1536 for the default `text-embedding-3-small`) and separate environment namespace prefixes. Restart the app/worker. The durable queue indexes completed messages; reads validate original owned records. Pinecone credentials and live verification are pending. Embedding calls send relevant text to OpenAI; enabling indexing stores vectors and source identifiers in Pinecone.

Expanding research details can show up to three Open Graph source cards, including a raster image when provided by the page. Public HTTPS metadata and images are fetched through bounded, owned endpoints with connection-time DNS validation. Preview availability depends on each website; original source links remain available. These cards do not add a second agent tool or establish factual support. Browser visual QA of this new feature remains pending.

For continuation, read [the current plan](plan.md#16-current-plan-and-next-agent-handoff--11-november-2026) and [cloud-agent handoff](docs/HANDOFF.md).
