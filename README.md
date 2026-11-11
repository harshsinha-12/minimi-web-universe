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
- The composer microphone transcribes speech with OpenAI (`TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`) and inserts editable text. Audio is not stored, and this call is not a chat tool.
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

The steps an answer took stay at the top of the reply. Cited sources sit under the answer as a logo stack; opening it lists each page with its logo, name, and one line of title or description. The latest answer can copy itself, copy the chat, download the chat as Markdown, or share the chat text. There is no public link: sharing uses the browser share sheet, or copies the text when that sheet is unavailable. The raw citation URL is not repeated in the answer text. Logos and descriptions are loaded through owned message endpoints with the same public-HTTPS and connection-time DNS checks. A missing logo falls back to the site’s initial. These pills do not add a second agent tool or establish factual support.

A repeated question in the same conversation can skip a new web search when every saved source page revalidates unchanged. Requested URLs stay in the cache identity, so two questions that differ only by link do not share a result. Questions that depend on words such as “it” or “that” always search. The shortcut is limited to 20 minutes for prices, news, releases, and similar volatile questions, and to seven days otherwise. A changed page, an explicit web-search request, or a historical recheck searches again. `SEARCH_REUSE=false` disables the shortcut. Page text is public source content, stored only as a short excerpt and a hash. A preview snapshot keeps the validators from its own fetch and does not overwrite a newer page observation.

For continuation, read [the current plan](plan.md#16-current-plan-and-next-agent-handoff--11-november-2026) and [cloud-agent handoff](docs/HANDOFF.md).
