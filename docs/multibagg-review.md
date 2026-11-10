# MultiBagg reference review

Inspected November 10, 2026 at `/Users/harshsinha/VS Code/multibagg/multibagg`; checkout HEAD was `eeb4412e4`. Findings describe the local working files, which may differ from production. The checkout contains existing local changes; it was read only. No database, production endpoint, or provider call was exercised.

This is a focused review of the relevant agent, search, history, streaming, and evaluation paths, not a comprehensive audit. The private code was used to learn patterns, not copied into this submission. The local source links below are for development traceability and will not resolve for public GitHub readers.

## Verified execution path

```text
Ask Iris useStreamingChat
  -> GET generate-answer/ask-ai
  -> getChatHistory(sessionId)
  -> executeMasterAgent / classifyIntent
  -> domain agent or executeGeneralAgent
  -> getPerplexitySearchResultsBatch for web requests
  -> stream answer, sources and metadata
  -> client POST chat-data to persist question and answer
```

For the general-agent path, the request's web toggle controls whether web search is exposed; enabling it also exposes a chart tool. The agent has a five-iteration loop, parallel tool execution, fallback handling, and cost tracking. The broader product routes to stock, ETF, IPO, portfolio, index, screener, sector, discovery, and watchlist agents. These are sensible domain boundaries for a finance product; they are unnecessary for minimi's single-tool assignment.

## Patterns to carry forward

| Observed pattern                                                          | Evidence                                                                                                                                 | Planned use in minimi                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Central intent dispatch and parallel independent context loading          | [Master agent](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__agents__/agent__master.ts:55>)               | One readable orchestrator; parallelize only independent work rather than importing domain agents |
| Batched searches with per-request failure handling and context allocation | [Web search implementation](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__tools__/tools__general.ts:281>) | Use bounded research and explicit partial coverage; provider changes to OpenAI hosted search     |
| Source identity deduplication                                             | [Source merge helper](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/helper.ts:290>)                         | Stable identities plus versioned observations; retain native citation relationships              |
| Bounded iterations, streaming, cost capture, fallback paths               | [General agent](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__agents__/agent__general.ts:88>)             | Keep deadlines, usage traces, and cancellation; add targeted evidence checks                     |
| Persisted questions, answers, sources, timestamps, latency and cost       | [Chat schema](</Users/harshsinha/VS Code/multibagg/multibagg/packages/db/prisma/schema.prisma:169>)                                      | Separate messages, runs, observations, and comparisons while retaining provenance                |

## Specific improvements justified by this code

| Observation in inspected code                                                                                                                                    | Why it matters here                                                                                                                         | Planned improvement                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `getChatHistory` scopes to one session, selects question/answer/sources, then slices the last five exchanges; source context is added only for the last exchange | Older or cross-thread questions, original dates, and earlier supporting evidence can be absent from model context                           | Retrieve owned history across threads by date and topic; preserve timestamps, message IDs, original list order, and linked evidence |
| The Perplexity query is rewritten with company name and “for India”                                                                                              | This reflects finance-product assumptions and can bias general research                                                                     | Neutral research briefs; carry geography only when the user's task requires it                                                      |
| Results sort by provider date and retain at most two results per domain                                                                                          | Newer or more diverse does not necessarily mean more authoritative; several official pages may be needed                                    | Ask hosted search to prioritize direct evidence and use focused official-domain passes when necessary                               |
| Web contexts use numbered snippets while sources are merged/deduplicated separately                                                                              | This is a place to test citation identity consistency across repeated searches; it is a potential risk, not a reproduced incorrect citation | Preserve OpenAI's native annotations tied to exact answer text and immutable source observations                                    |
| A Google search plus page-text path exists with a fallback comment, but the inspected general-agent dispatch calls Perplexity directly                           | The existence of a helper does not establish active failover                                                                                | Document actual error behavior; use only OpenAI web search under the user's latest constraint                                       |
| The page-text helper caches results for seven days and extracts/truncates body text                                                                              | That alternate path would be unsuitable as fresh proof of today's pricing without a refresh policy                                          | No direct crawler in this design; bypass application answer caching on freshness checks and label retrieval limits                  |
| General-agent reflection text discourages further questions and mentioning sources                                                                               | Clarification and citations are necessary for missing history or ambiguous facts                                                            | Permit precise clarification and require usable citations for externally checked claims                                             |
| The client posts the final answer to a separate persistence endpoint after consuming the stream                                                                  | Durable history on this path depends on a second browser request succeeding                                                                 | Persist the incoming turn and final outcome on the server; make retries idempotent                                                  |
| The subjective judge explicitly says not to verify facts and accepts missing sources                                                                             | A convincing wrong answer can score well on that rubric                                                                                     | Use evidence-aware correctness checks; keep conversation quality separate from factual support                                      |

These observations identify differences between the inspected path and minimi's needs. They do not establish production incident frequency or benchmark performance.

## Exact source pointers

- [History construction](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/fetcherUtils.ts:68>), [history length and cache lifetime](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/config.ts:245>).
- [Search tool schema and Perplexity batch](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__tools__/tools__general.ts:243>), [alternate Google/page-text path](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/fetcherUtils.ts:157>).
- [Entry route](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/generate-answer/ask-ai/route.ts:108>), [general-agent search dispatch](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__agents__/agent__general.ts:101>), [reflection and iteration behavior](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__agents__/agent__general.ts:138>).
- [Client-side final persistence](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/ask-iris/_components/hooks/useStreamingChat.ts:598>), [persistence route](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/chat-data/route.ts:128>).
- [Subjective evaluation rubric](</Users/harshsinha/VS Code/multibagg/multibagg/apps/web/app/api/v1/chatbot/__evals__/eval__subjective.ts:60>).

## What is intentionally different

The minimi design uses OpenAI hosted search, not Perplexity, Google Custom Search, or a custom crawler. Application helpers improve context, objectives, and comparison quality but cannot directly control hosted search's private retrieval pipeline. Only returned metadata and cited model output are observable; do not claim raw-page access or independent reranking of hidden results.

The planned advantage over this inspected path is better temporal context and evidence handling, with fewer domain-specific moving parts. That advantage still needs to be demonstrated by the evaluations in [plan.md](../plan.md).
