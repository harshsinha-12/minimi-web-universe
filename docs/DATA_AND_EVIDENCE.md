# Data and evidence controls

Implemented November 12, 2026. This document describes the shipped local code; live verification limits are in [EVALUATION.md](EVALUATION.md).

## Historical dates

The date resolver uses the request timezone, falling back to UTC for an invalid zone. `last week`/`previous week` means the previous Monday–Sunday; `this week` means the current Monday–Sunday. `three days ago`, `3 days ago` and `two weeks ago` resolve the corresponding local day. `last N days`/`past N days` includes today. `between 3 November and 7 November`, `from 3 to 7 November`, month-first dates and ISO ranges include both endpoint days. An omitted start year can cross December–January. Invalid dates and reversed ranges return no window. Internally every window is start-inclusive/end-exclusive in UTC, with calendar-day arithmetic through DST.

## Inspectable claim support and comparisons

Answers that used external sources receive a separate tool-free review after generation. Application code fetches up to eight supplied HTTPS source URLs through the existing SSRF-protected, DNS-pinned, size/time-limited fetcher, extracts up to 14000 visible-text characters per page, and retains the observation time, final URL and text hash. This is an application helper; hosted OpenAI web search remains the answer model's sole tool.

The review uses [Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs) and asks for up to 30 material claim records, including uncited claims. Application validation maps exact visible Markdown text back to original offsets, rejects paraphrases as unsupported, strips known UTM tracking parameters while retaining substantive URL queries, and checks exact answer spans, attached native citations, exact contiguous page quotes and verbatim extracted values/effective dates. A missing quote, missing native citation, unsupported extraction, failed fetch, refusal, timeout or malformed output cannot become a supported claim. Native citations omitted by the reviewer get explicit unchecked records. A warning is appended when the review is unavailable or finds unsupported/contradictory claims.

`evidence_audits` stores the versioned audit and bounded source snapshots. `claim_support` and `comparisons` also persist individual records in the same transaction as the assistant answer. The message API returns its audit; expand **Page support** beneath an answer to inspect claim spans, quotes, source links, reasons and comparison dimensions. Extraction and entailment remain model judgements; “supported checked claims” never means exhaustive factual proof. Truncated, dynamic, blocked or non-HTML pages can leave claims unverified. The review adds an API call and up to 18 seconds within the existing turn deadline.

Historical comparisons use saved audited observations; refetching a current page does not verify an old price. Comparable price observations must explicitly match plan, region, currency, billing period and unit. Missing/different dimensions yield `not_comparable`; unsupported old/current evidence yields `unverified`. Compatible supported observations yield `changed` or `still_supported`. A previously contradicted baseline with a supported current observation can yield `earlier_answer_wrong`. Records retain old/current values, claim IDs, baseline message/conversation links, observation time and reasons. Effective dates require quoted support and are separate from observation dates. Existing unaudited transcripts remain available as conversation history but cannot silently become a verified historical baseline.

## Edit and delete controls

- Pencil/trash controls on user and assistant messages call `PATCH`/`DELETE /api/messages/:id`. Edits update the selected message; existing replies remain as written and are not regenerated.
- Conversation-list trash controls call `DELETE /api/conversations/:id` after a confirmation.
- Memory pencils call `PATCH /api/memory` with `{ id, text }`. The version increments and the correction is marked **edited by you**. Explicit overrides survive automatic consolidation and retain their original source trail; that trail does not imply the original message contained the edited text.
- Forgetting a derived memory retains transcripts and continues excluding its original supporting messages from future synthesis. Tombstones store opaque hashes; forgotten text is not retained in them or resent to the synthesis model.

All mutation routes enforce session ownership and same-origin browser requests. Input is trimmed and limited to 12000 characters. Source edit/delete retracts dependent derived memories and manual overrides, updates FTS5 and thread titles, advances history/memory revisions, fences owner inference/index/synthesis work, removes affected source events and invalidates saved research. Owner research artifacts, audits and lookup caches are conservatively cleared because they may contain a copied baseline from another thread. Other original transcripts remain available; deleting one message does not redact independently written replies or exported copies.

## Cleanup and operation

The application and worker require the same persistent SQLite file. Restart both after upgrading so the old insert-only FTS/index lifecycle cannot keep running. Migrations are additive; source update/delete triggers keep FTS in sync.

Redis context keys become unreadable immediately through owner revisions, and cached candidates are rehydrated from current SQL. Mutation routes attempt physical eviction; `cache_cleanup` retries through the worker when Redis is unavailable. Old keys also expire within five minutes. An already-running cache write can outlive an eviction; its old revision is still unreadable and its TTL bounds retention.

Before a Pinecone upsert, `vector_records` commits write intent including host, namespace and IDs. Edits allocate a new generation, so cleanup for earlier text cannot remove a restored version. Source mutation atomically queues recorded IDs in `vector_cleanup`; jobs survive transcript removal and retry provider outages without dropping the request. Cleanup waits for an in-flight indexing lease to expire. Reads reject deleted messages/stale fingerprints immediately even while physical cleanup is pending. The worker drains cleanup independently of automatic memory/semantic enablement, using the configured provider credentials. Run `npm run worker` in production, even when automatic memory is disabled.

Legacy `message:chunk` IDs are migrated from the retained index job configuration using the upgrade's configured host and namespace prefix. Keep those settings for migration. Earlier namespaces/hosts discarded before this upgrade were not recorded by the old implementation and require operator cleanup; this implementation does not claim to enumerate them.

Inspect pending work with `SELECT owner FROM cache_cleanup` and `SELECT id,host,namespace,due_at,attempts FROM vector_cleanup`. Logical application deletion and provider cleanup do not sanitize SQLite free pages/WAL, backups, downloaded exports or provider retention outside the application's controls. Backup retention and physical-media erasure remain deployment responsibilities.
