# minimi continuation handoff — 11 November 2026

## Start here

Continue the existing project; do not rebuild it from scratch. Read `AGENTS.md`, `README.md`, `DESIGN.md`, `plan.md` section 16, and `docs/architecture.md`. User asked for this portable handoff for another cloud agent.

Local checkout: `/Users/harshsinha/VS Code/minimi-web-universe`. Reference only: `/Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/`. Do not change MultiBagg or copy its credentials/private source. `docs/multibagg-review.md` records the reference findings if that checkout is unavailable.

**Git handoff:** the user has now requested categorical local commits. The intended phases are setup/tooling, persistence, agents/memory, UI, evaluations, and docs. Inspect `git log --oneline -8` and `git status --short` for the completed phase commits before continuing. No push, deployment or hiring submission is authorized by this handoff. A cloud agent needs the committed repository snapshot; local ignored data will not be present. `.env`, `.data`, SQLite files and dependencies must not be uploaded. Preserve `USER_CONTEXT.md` and concurrent logging/lint/format changes. Do not treat user context as chat history.

## User's requirements and decisions

- minimi hiring challenge: best conversational web-search agent architecture, Node JS/TS, `npm install`, `npm run dev`, `.env.example`, public GitHub repo and one-page DESIGN.
- Exact historical recall and historical-vs-current checks matter: original questions, ordered shortlists, dates/timezones, comparable pricing plans/regions/billing periods, missing-history honesty.
- Use **OpenAI hosted web search only** as the chat agent's external tool. Internal memory/retrieval and tool-free sub-agents are application functions. No second search provider.
- Follow MultiBagg-like `__agents__`, `__tools__`, `__prompts__`, `__evals__`, `__data__` separation. These are implemented under `src/ai/`.
- Existing OpenAI key reuse is explicitly authorized. Redis credentials exist locally. Never display or commit keys. A cloud environment must configure its own secret environment; the local `.env` is deliberately excluded from the handoff.
- **User will add Pinecone keys later. Leave it disabled.** Do not provision an account/index or pretend its live behavior was verified.
- User wants image-like source previews, likely Open Graph cards. New implementation is present; verification is unfinished.
- Dreaming inspired background memory design; this is our implementation, not access to ChatGPT's Dreaming V3 internals.

## Actual implementation

- Next.js 16/React 19/TypeScript, Node >=22.13. Native `better-sqlite3` means Node runtime, not Edge. Read installed Next docs before route changes.
- `npm run dev`: `scripts/dev.mjs` starts Next and the background memory worker.
- Default answer model `gpt-6-astra`; memory/review/judge default `gpt-5.4-mini`. `.env.example` documents overrides.
- `src/ai/__agents__/agent__master.ts`: bounded Responses API loop, streamed ordinary answers, held/reviewed historical rechecks, native citations, returned search artifacts, status and usage. Three maximum research passes, 90-second default deadline. Uses existing Responses implementation; do not migrate APIs merely for a refactor.
- `src/ai/claim-audit.ts`: independent tool-free structured review against bounded fetched page snapshots; exact answer/quote/native-citation checks, persisted support records and deterministic compatible-price comparisons. See [data and evidence controls](DATA_AND_EVIDENCE.md).
- `agent__research_review.ts`: conditional tool-free coverage review, distinct from offline eval.
- `agent__memory.ts`: tool-free synthesis with exact quoted user-message sources, schema in `src/memory/schema.ts`.
- `agent__judge.ts`: offline structured verdicts on recall, temporal reasoning, grounding and usefulness. Explicit critical violations veto an overall pass. Exact candidate quotes and valid evidence IDs are checked.
- `src/db/store.ts`: owner-scoped original messages, conversations/runs/events, FTS5, provider artifacts, memory versions/outbox, leases/revisions/source exclusions. Database defaults `.data/minimi.sqlite`. Redis is a five-minute derived-context cache and wake-up mechanism.
- `src/ai/context.ts`: exact timezone intervals, FTS5, recent messages, source-linked memories, optional semantic retrieval, reciprocal rank fusion and original-exchange hydration. Fixed missing non-keyword preference recall during live evaluation.
- `src/memory/index-jobs.ts`: transactional SQL trigger enqueues completed messages. Claims/retries/fenced leases persist; index configuration changes reindex finished jobs.
- `src/memory/vector-cleanup.ts`: persisted write manifests, legacy-ID migration and retryable deletion outbox; per-edit vector generations avoid deleting restored text. Cache cleanup also polls independently of automatic memory synthesis.
- `src/memory/semantic.ts`: bounded overlapping Unicode chunks; embeddings via existing OpenAI key; Pinecone BYOV index, opaque owner namespaces; store only IDs/fingerprints as vector metadata; hydrate matches from authoritative SQL and reject stale/foreign/excluded sources. Query failures fall back to lexical/date context.
- `src/ai/__tools__/tool__web_search.ts`: complete model-facing tool list. Embeddings/Pinecone adapters in this folder are not offered to the model.
- `src/server/logger.ts` and logging changes were added concurrently in the workspace. Preserve them. Pino, lint/format/Husky config also exist.

## Source previews: newest work needing verification

- `src/server/preview-fetch.ts`: HTTPS only; rejects private/literal/loopback destinations and credentials/nonstandard ports; validates public DNS inside the actual connection lookup; max two redirects; time and size limits; no cookies; restricted HTML/raster MIME types.
- `src/server/link-previews.ts`: non-executing HTML parser extracts OG/Twitter/title/description/image; at most three persisted source URLs; bounded five-minute in-process public-metadata cache.
- Owned routes: `GET /api/messages/[id]/previews` and `GET /api/messages/[id]/preview-image?source=0` (indices 0–2). No arbitrary URL parameter. Raster image is proxied after destination validation.
- `src/components/SourcePreviews.tsx` appears when research details are expanded in `ChatApp.tsx`; card CSS appended to `app/globals.css`. Original source list remains the fallback.
- These previews enrich the UI only and are not research evidence. Some sites omit OG tags or block metadata requests.
- Unit tests in `tests/previews.test.ts`. A live Wispr Flow metadata and image smoke check passed (Open Graph title and a 154177-byte JPEG). Owned-message endpoint access tests and browser visual verification remain pending. The production build and 83 deterministic tests passed with these endpoints. TypeScript passed. Browser and owned-endpoint verification remain pending.

## Commands and evaluation interpretation

```sh
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run dev
# Optional live spending with configured OpenAI key:
npm run eval:judge
npm run eval:agent
npm run eval:judge -- --case=billing-units
npx tsx scripts/live-smoke.ts
npx tsx scripts/live-scenarios.ts
```

`npm run eval` runs all deterministic tests without API calls. `eval:judge` is **judge calibration** on known good/bad synthetic answers, not agent accuracy. `eval:agent` runs the actual production orchestrator on four isolated history fixtures, then the judge; it does not yet benchmark the full live-search research distribution. Reports are ignored `.data/evals/*.json`. No fixtures are written to a real UI user's identity. Runner closes Redis before exiting.

Verified after source-preview additions: 83 tests, typecheck, and production build passed. Final lint and TypeScript checks passed. Latest post-fix production-agent run: all four cases passed (ordered shortlist, missing history, explicit region correction, plan not completed). Report `.data/evals/agent-1794340529726.json` is local-only. Initial judge calibration had 13 scored agreements and one unscored invalid verdict; a targeted two-answer billing-unit rerun passed. Do not hide invalid verdicts or present the first calibration as 14/14.

Earlier complete implementation passed build, 46 tests, live OpenAI/Redis checks and small synthetic web-search scenarios; see `docs/EVALUATION.md`. Those earlier checks do not prove the newest preview/refactor code. Pinecone has no configured key/host and has not been exercised live.

Dependency audit currently reports 10 moderate development-tool findings rooted in minimatch; earlier zero-vulnerability result predates added lint tooling. Do not blindly downgrade Next or apply `npm audit fix --force`. Inspect current audit; preserve user tooling preferences.

## Deployment and remaining quality work

SQLite is authoritative today. Works on one host with a persistent volume shared by app/worker. Serverless/multi-host deployment needs a managed Postgres migration; Pinecone and Redis do not replace canonical SQL. No migration or deployment performed.

Next priorities are in `plan.md` section 16: finish preview QA and refactor verification; expand human-reviewed quality data and judge calibration; live-test Pinecone after keys arrive; compare memory/semantic ablations; choose deployment and migrate SQL if necessary; package/review for public submission. Message/conversation edit/delete, direct memory editing, bounded page-support review and structured comparison records are implemented. Account recovery/auth, live Pinecone verification, browser/responsive sign-off, load/crash campaigns and a held-out research benchmark remain incomplete. Audit verdicts remain model judgements rather than independent human labels.

Stop task-owned development services when finished. Do not stop unrelated user processes. Browser automation was unreliable in prior local work; the previous desktop UI was visually inspected, but the newest cards need their own QA.

## Local commit phases

1. `b1f3c0e` — setup, dependencies, config, secret/data ignore rules, lint/format/Husky.
2. `20ec60f` — owner-scoped persistence, sessions, logging, durable jobs, cache and dates.
3. `3d1b6c3` — modular agent/prompt/tool layer and optional hybrid semantic memory.
4. `8ed4c32` — chat UI/routes and Open Graph preview feature.
5. `bfbb018` — evidence-aware judge, fixtures, production-agent evaluations and regressions.
6. Final `docs:` commit — current plan, architecture diagrams, design, evaluation record and this handoff. Find its hash using `git log -1 --oneline`.

These commits are on local `main`; origin is `https://github.com/harshsinha-12/minimi-web-universe.git`. They have not been pushed. The pre-existing `USER_CONTEXT.md` is intentionally left untracked. Final checks: 83 tests, lint, typecheck and production build passed; four synthetic production-agent history cases passed. No Pinecone live check or preview browser sign-off has been completed.
