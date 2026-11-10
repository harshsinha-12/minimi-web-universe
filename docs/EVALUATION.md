# Verification record

Recorded November 11, 2026. This is a local engineering check, not a leaderboard result or proof of parity with leading chatbots.

## Automated coverage

The regression suite exercises the production store, date resolver, context builder, search policy, citation normalizer, memory-proposal schema, and SSE decoder. It covers:

- Owner isolation, cross-thread retrieval, date-only recall, more than fifty dated messages, and source hydration.
- Local midnight, year rollover, daylight saving changes, invalid dates, and strictly previous weekdays.
- Duplicate submissions, overlapping runs, terminal-state protection, and durable answer/outbox creation.
- Fabricated quotes, foreign-owner sources, stale input revisions, expired worker leases, abandoned-job recovery, expired memory, forgetting, and preservation of unrelated memories.
- Explicit no-search requests, fragmented UTF-8/SSE, truncated streams, citation offsets, and incomplete provider responses.
- Browser same-origin checks when the public host differs from Next's internal request URL.

The final verification pass completed **46 tests**, `npm run typecheck`, and `npm run build` successfully. Dependency auditing reported zero known vulnerabilities after upgrading the test runner. These checks do not substitute for the broader quality benchmark below.

## Live checks actually run

Existing OpenAI credentials authenticated. Redis authentication and a temporary expiring key write/read passed; the temporary key was removed. Model visibility and a direct `gpt-6-astra` hosted-search request succeeded. The memory worker produced source-linked entries in the local database.

The following are individual observed HTTP timings, including local request overhead. They are not p50/p95 estimates. The CRM cases use explicitly synthetic history under a separate identity.

| Scenario                                             | Model / configuration                  | Observed result                                                                                                                     | HTTP duration |
| ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Current PostgreSQL major version                     | Initial `gpt-5.4` integration          | Completed with one native citation and consulted-source metadata                                                                    | 8.8 s         |
| Missing November 3 conversation                      | Initial integration                    | Stated the missing history; no search and no invented conversation                                                                  | 6.0 s         |
| Recall synthetic November 3 shortlist across threads | `gpt-6-astra`                          | Returned the exact five-tool question and an original-message link                                                                  | 4.5 s         |
| Resolve the shortlist's second option                | `gpt-6-astra`                          | Correctly returned Pipedrive with a historical link; no search                                                                      | 3.4 s         |
| Remember a concise-answer preference                 | `gpt-6-astra`                          | Brief acknowledgement; no search                                                                                                    | 2.7 s         |
| Recheck all five CRM tools                           | `gpt-6-astra`, revised coverage policy | Five official pricing citations; correctly left change claims unverified without an old verified baseline; correct local check date | 27.6 s        |

An earlier CRM attempt took 49.3 s and was unnecessarily verbose. Both the model and coverage policy changed before the later attempt, so the difference cannot be attributed to one change. The later answer also stated that Zoho's paid amounts were not readable rather than inventing a rate.

Desktop visual inspection confirmed the cream/lavender layout and serif headings. Browser submission testing exposed an origin-host mismatch; it was reproduced through HTTP, fixed, and given a regression test. Full responsive/mobile interaction sign-off has not been completed. The browser automation bridge was unreliable during portions of this run.

## Boundaries and remaining evaluation

These are smoke tests, not an independently annotated quality benchmark. Citation presence is measured; semantic entailment of every claim is not automatically proven. The conditional reviewer sees returned artifacts, not hidden raw search pages. Structured comparison classifications are currently instructions to the model, not a separate verified fact database.

Memory support checks establish exact span ownership and revision validity, not that every interpretation of a span is correct. Corrections accompany older memories as raw context while consolidation catches up. Forgetting derived memory excludes its supporting messages from future synthesis and retains original transcripts; full transcript deletion is not yet exposed.

No controlled memory ablation, adversarial web-page campaign, load test, crash-injection campaign, cost benchmark, or private minimi evaluation has been completed. The larger evaluation framework and detailed logical schemas in the plan remain targets beyond this working implementation.

## November 11 modular refactor and judge checkpoint

Post-refactor and source-preview checks: **83 deterministic tests passed**, TypeScript checking passed, and the production build passed, including both new preview endpoints. Final lint and TypeScript checks also passed. The tests cover semantic job transaction rollback, lease fencing, provider-failure retry, configuration reindexing, tenant/hash/exclusion hydration, Unicode chunking, ranking fusion, judge validation, preview metadata parsing, private destination rejection, and source limits.

The first judge calibration run produced 13 scored agreements and one invalid/unscored verdict across 14 synthetic candidates. A targeted rerun of both billing-unit candidates passed. This is calibration on authored examples, not independent accuracy measurement. The first production-agent evaluation exposed missing non-keyword preference retrieval; after fixing retrieval and supplying original IDs to the judge, the four production history fixtures all passed in the latest run. These are ordered shortlist, missing history, explicit preference correction and planned-vs-completed events.

Pinecone has no configured key/host and is disabled; only its adapter contracts/job lifecycle have been tested locally. A live Wispr Flow Open Graph metadata fetch and 154177-byte JPEG image proxy fetch passed. The new cards still need owned-endpoint access tests and browser QA. No new browser verification or deployment is claimed. Current npm audit reports moderate findings in development lint tooling rooted in minimatch; the earlier zero-findings statement predates that tooling. Do not apply a breaking audit downgrade automatically.
