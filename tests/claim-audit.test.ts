import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import {
  auditAnswer,
  auditPageUrl,
  compareClaims,
  emptyAudit,
  validateClaimProposal,
  type ClaimSupport,
  type FactRecord,
  type SourceSnapshot,
} from "../src/ai/claim-audit";
import { Store } from "../src/db/store";
import type { Message } from "../src/types";
const url = "https://example.com/pricing";
const answer =
  "Alpha costs $20 per user per month in the US, billed monthly. [Source]";
const citations = [
  {
    url,
    title: "Pricing",
    start: answer.indexOf("[Source]"),
    end: answer.length,
  },
];
const snapshot: SourceSnapshot = {
  id: "page-1",
  url,
  finalUrl: url,
  observedAt: "2026-11-12T12:00:00Z",
  text: "Alpha Pro costs $20 per user per month in the US, billed monthly. Effective 1 November 2026.",
  hash: "hash",
  state: "fetched",
};
const fact: FactRecord = {
  subject: "Alpha",
  field: "price",
  value: "$20",
  plan: "Pro",
  region: "US",
  currency: "USD",
  billingPeriod: "monthly",
  unit: "user/month",
  effectiveDate: null,
};
const proposal = () => ({
  claims: [
    {
      claim: answer.slice(0, citations[0].start).trim(),
      fact: { ...fact },
      url,
      evidenceQuote: snapshot.text,
      verdict: "supported",
      reason: "Same plan and billing basis.",
    },
  ],
});
function supported(): ClaimSupport {
  return validateClaimProposal(proposal(), answer, citations, [snapshot])[0];
}
function message(claims: ClaimSupport[]): Message {
  return {
    id: randomUUID(),
    conversationId: "thread",
    role: "assistant",
    content: "old observation",
    createdAt: "2026-11-01T12:00:00Z",
    status: "completed",
    citations: [],
    sources: [],
    runId: null,
    evidence: {
      ...emptyAudit(),
      status: "checked",
      sources: [snapshot],
      claims,
    },
  };
}
describe("independent claim-support validation", () => {
  it("maps unformatted reviewer text to its exact Markdown source span", () => {
    const p = proposal();
    const markdown = answer.replace(
      "Alpha costs $20",
      "**Alpha** costs **$20**",
    );
    const c = [
      {
        ...citations[0],
        start: markdown.indexOf("[Source]"),
        end: markdown.length,
      },
    ];
    const claim = validateClaimProposal(p, markdown, c, [snapshot])[0];
    expect(claim.status).toBe("supported");
    expect(markdown.slice(claim.start, claim.end)).toBe(claim.claim);
  });
  it("recognizes OpenAI tracking parameters while preserving substantive URL queries", () => {
    const p = proposal();
    expect(
      validateClaimProposal(
        p,
        answer,
        [{ ...citations[0], url: url + "?utm_source=openai" }],
        [snapshot],
      )[0].status,
    ).toBe("supported");
    expect(auditPageUrl(url + "?plan=pro&utm_source=openai&region=US")).toBe(
      url + "?plan=pro&region=US",
    );
  });
  it("retains exact answer offsets and a captured evidence quote", () =>
    expect(supported()).toMatchObject({
      claim: proposal().claims[0].claim,
      start: 0,
      end: citations[0].start - 1,
      status: "supported",
      sourceId: "page-1",
      evidenceQuote: snapshot.text,
    }));
  it("rejects a fabricated review span without losing other valid review items", () => {
    const p = proposal();
    p.claims[0].claim = "not in the answer";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0],
    ).toMatchObject({ status: "insufficient", claim: answer, fact: null });
  });
  it("downgrades an invented supporting quote", () => {
    const p = proposal();
    p.claims[0].evidenceQuote = "Not in the page";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("insufficient");
  });
  it("does not accept a valid quote from an unrelated cited URL", () => {
    const p = proposal();
    p.claims[0].url = "https://example.com/other";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("unavailable");
  });
  it("requires a native citation attached to the exact page", () =>
    expect(
      validateClaimProposal(proposal(), answer, [], [snapshot])[0].status,
    ).toBe("insufficient"));
  it("does not reuse a citation across paragraphs", () => {
    const text =
      proposal().claims[0].claim + "\n\nDifferent paragraph. [Source]";
    expect(
      validateClaimProposal(
        proposal(),
        text,
        [
          {
            ...citations[0],
            start: text.indexOf("[Source]"),
            end: text.length,
          },
        ],
        [snapshot],
      )[0].status,
    ).toBe("insufficient");
  });
  it("requires extracted amounts and effective dates to appear verbatim in evidence", () => {
    const p = proposal();
    p.claims[0].fact.value = "$9";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("insufficient");
    p.claims[0].fact.value = "$20";
    p.claims[0].fact.effectiveDate = "2026-11-01" as never;
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("insufficient");
  });
  it("preserves contradictory verdicts and treats fetch failures as unavailable", () => {
    const p = proposal();
    p.claims[0].verdict = "contradicted";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("contradicted");
    expect(
      validateClaimProposal(proposal(), answer, citations, [
        { ...snapshot, state: "unavailable", text: "" },
      ])[0].status,
    ).toBe("unavailable");
  });
  it("marks citations omitted by the model as unchecked", () =>
    expect(
      validateClaimProposal({ claims: [] }, answer, citations, [snapshot])[0],
    ).toMatchObject({ status: "insufficient", evidenceQuote: null }));
});
describe("auditable historical comparisons", () => {
  it("records changed values only for independently supported compatible observations", () => {
    const old = supported();
    old.fact = { ...fact, value: "$15" };
    const baseline = message([old]);
    expect(compareClaims([supported()], [baseline])[0]).toMatchObject({
      status: "changed",
      baselineMessageId: baseline.id,
      oldClaimId: old.id,
      currentClaimId: expect.any(String),
      effectiveDate: null,
    });
  });
  it.each(["billingPeriod", "region", "currency", "plan", "unit"] as const)(
    "rejects incompatible %s",
    (dimension) => {
      const old = supported();
      old.fact = { ...fact, [dimension]: "different" };
      expect(compareClaims([supported()], [message([old])])[0].status).toBe(
        "not_comparable",
      );
    },
  );
  it("does not infer matching dimensions when a pricing unit is missing", () => {
    const old = supported();
    old.fact = { ...fact, unit: null };
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "not_comparable",
    );
  });
  it("does not infer a historical price from a saved assistant answer without evidence", () =>
    expect(
      compareClaims(
        [supported()],
        [{ ...message([]), content: "Alpha was $15" }],
      )[0].status,
    ).toBe("unverified"));
  it("leaves a comparison unverified when either observation lacks support", () => {
    const old = supported();
    old.status = "insufficient";
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "unverified",
    );
  });
  it("recognizes equal numeric prices and historical corrections", () => {
    const old = supported();
    old.fact = { ...fact, value: "$20.00" };
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "still_supported",
    );
    old.fact = { ...fact, value: "USD 20" };
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "still_supported",
    );
    old.fact = { ...fact, value: "from USD 20" };
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "unverified",
    );
    old.status = "contradicted";
    expect(compareClaims([supported()], [message([old])])[0].status).toBe(
      "earlier_answer_wrong",
    );
  });
});
describe("audit orchestration failure handling", () => {
  const args = {
    answer,
    citations,
    sources: [],
    baseline: [],
    compare: true,
    signal: AbortSignal.timeout(5000),
  };
  function client(output: string, status = "completed") {
    return {
      responses: {
        create: async () => ({
          status,
          output_text: output,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    } as unknown as OpenAI;
  }
  it("runs tool-free structured review and preserves captured pages", async () => {
    const result = await auditAnswer(
      { ...args, client: client(JSON.stringify(proposal())) },
      async () => snapshot,
    );
    expect(result.audit).toMatchObject({
      status: "checked",
      sources: [snapshot],
      claims: [{ status: "supported" }],
      comparisons: [{ status: "unverified" }],
    });
  });
  it.each(["bad json", JSON.stringify({ claims: [{ madeUp: true }] })])(
    "fails closed for malformed output",
    async (output) =>
      expect(
        (
          await auditAnswer(
            { ...args, client: client(output) },
            async () => snapshot,
          )
        ).audit.status,
      ).toBe("unavailable"),
  );
  it("does not validate or publish a partial structured response", async () => {
    const result = await auditAnswer(
      { ...args, client: client(JSON.stringify(proposal()), "incomplete") },
      async () => snapshot,
    );
    expect(result.audit).toMatchObject({
      status: "unavailable",
      claims: [],
      comparisons: [],
    });
  });
  it("does not call the model when every page is unavailable", async () => {
    const throwing = {
      responses: {
        create: async () => {
          throw new Error("must not call");
        },
      },
    } as unknown as OpenAI;
    expect(
      (
        await auditAnswer({ ...args, client: throwing }, async () => ({
          ...snapshot,
          state: "unavailable",
          text: "",
        }))
      ).audit.status,
    ).toBe("unavailable");
  });
});

describe("persisted evidence provenance", () => {
  it("commits support and comparison records with the answer and isolates their owner", () => {
    const store = new Store(":memory:");
    try {
      const thread = store.createConversation("alice");
      const { run } = store.begin(
        "alice",
        thread,
        randomUUID(),
        "What changed?",
      );
      const claim = supported();
      const audit = {
        ...emptyAudit(),
        status: "checked" as const,
        sources: [snapshot],
        claims: [claim],
        comparisons: compareClaims([claim], []),
      };
      const saved = store.finish(
        "alice",
        run.id,
        answer,
        citations,
        [],
        [],
        {},
        "completed",
        null,
        audit,
      )!;
      expect(store.message("alice", saved.id)?.evidence).toEqual(audit);
      expect(store.message("bob", saved.id)).toBeNull();
      expect(
        store.db
          .prepare("SELECT id FROM claim_support WHERE message_id=?")
          .all(saved.id),
      ).toEqual([{ id: claim.id }]);
      expect(
        store.db
          .prepare("SELECT id FROM comparisons WHERE message_id=?")
          .all(saved.id),
      ).toHaveLength(1);
      store.deleteMessage("alice", saved.id);
      for (const table of ["evidence_audits", "claim_support", "comparisons"])
        expect(store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
