import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Store } from "../src/db/store";
import type { Message } from "../src/types";
import {
  compareClaims,
  validateClaimProposal,
  type EvidenceAudit,
  type FactRecord,
  type SourceSnapshot,
} from "../src/ai/claim-audit";
import {
  researchChecks,
  researchEvidence,
} from "../src/ai/__evals__/eval__research";

const pricingUrl = "https://example.com/challenge-pricing";
const oldDate = "2026-11-03T06:00:00Z";
const newDate = "2026-11-11T06:00:00Z";
const oldFact: FactRecord = {
  subject: "ExampleHost",
  field: "price",
  value: "USD 20",
  plan: "Team",
  region: "US",
  currency: "USD",
  billingPeriod: "monthly",
  unit: "workspace/month",
  effectiveDate: null,
};

function capture(fact: FactRecord, observedAt: string, fetched = true) {
  const quote = `${fact.subject} ${fact.plan} costs ${fact.value} per ${fact.unit} in ${fact.region}, billed ${fact.billingPeriod}.`;
  const answer = `${quote} [Source]`;
  const citations = [
    {
      url: pricingUrl,
      title: "Pricing",
      start: quote.length + 1,
      end: answer.length,
    },
  ];
  const source: SourceSnapshot = {
    id: `page-${observedAt}`,
    url: pricingUrl,
    finalUrl: fetched ? pricingUrl : null,
    observedAt,
    text: fetched ? quote : "",
    hash: null,
    state: fetched ? "fetched" : "unavailable",
  };
  const evidence: EvidenceAudit = {
    version: 1,
    checkedAt: observedAt,
    status: "checked",
    coverage: "bounded",
    sources: [source],
    claims: validateClaimProposal(
      {
        claims: [
          {
            claim: quote,
            fact,
            url: pricingUrl,
            evidenceQuote: quote,
            verdict: "supported",
            reason: "Frozen fixture.",
          },
        ],
      },
      answer,
      citations,
      [source],
    ),
    comparisons: [],
  };
  return { answer, citations, evidence };
}

describe("frozen challenge pricing comparisons", () => {
  it.each([
    {
      name: "changed on matching terms",
      difference: { value: "USD 25" },
      expected: "changed",
    },
    {
      name: "same price in a different format",
      difference: { value: "USD 20.00" },
      expected: "still_supported",
    },
    {
      name: "annual billing",
      difference: { value: "USD 15", billingPeriod: "annually" },
      expected: "not_comparable",
    },
    {
      name: "different region",
      difference: { value: "USD 25", region: "India" },
      expected: "not_comparable",
    },
    {
      name: "missing verified baseline",
      difference: { value: "USD 25" },
      expected: "unverified",
      omitBaseline: true,
    },
    {
      name: "unavailable current page",
      difference: { value: "USD 25" },
      expected: "unverified",
      unavailable: true,
    },
  ])("$name", ({ difference, expected, omitBaseline, unavailable }) => {
    const store = new Store(":memory:");
    try {
      const owner = "challenge-eval";
      const thread = store.createConversation(owner);
      const { run } = store.begin(
        owner,
        thread,
        randomUUID(),
        "What was the hosting price?",
        oldDate,
      );
      const old = capture(oldFact, oldDate);
      const baseline = store.finish(
        owner,
        run.id,
        old.answer,
        old.citations,
        [],
        [],
        {},
        "completed",
        null,
        omitBaseline ? undefined : old.evidence,
      );
      expect(baseline).not.toBeNull();
      const current = capture(
        { ...oldFact, ...difference },
        newDate,
        !unavailable,
      );
      const comparisons = compareClaims(
        current.evidence.claims,
        store
          .messages(owner, thread)
          .filter(({ role }) => role === "assistant"),
      );
      expect(comparisons).toMatchObject([
        {
          status: expected,
          baselineMessageId: omitBaseline ? null : baseline?.id,
          effectiveDate: null,
        },
      ]);
    } finally {
      store.close();
    }
  });
});

it("requires native primary-source citations, captured evidence, and a matching thread and message", () => {
  const captured = capture(oldFact, oldDate);
  const message: Message = {
    id: "answer",
    conversationId: "new-chat",
    role: "assistant",
    content: `${captured.answer} [Earlier chat](/?thread=old-thread#message-original)`,
    createdAt: newDate,
    status: "completed",
    citations: captured.citations,
    sources: [{ url: pricingUrl, title: "Pricing" }],
    runId: null,
    evidence: captured.evidence,
  };
  const history = [
    {
      id: "original",
      conversationId: "old-thread",
      role: "user" as const,
      text: "What was the price?",
      at: oldDate,
    },
  ];
  const expected = { primaryDomains: [["example.com"]] };
  expect(
    researchChecks(expected, message, 1, history).every(({ passed }) => passed),
  ).toBe(true);
  const wrongCitation = {
    ...message,
    citations: [
      { ...captured.citations[0], url: "https://example.com.invalid/pricing" },
    ],
  };
  expect(researchEvidence(wrongCitation)).toEqual([]);
  expect(
    researchChecks(expected, wrongCitation, 0, [
      { ...history[0], conversationId: "other-thread" },
    ]).map(({ passed }) => passed),
  ).toEqual([false, false, false, false]);
});
