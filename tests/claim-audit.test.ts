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
  type EvidenceAudit,
  type FactRecord,
  type SourceSnapshot,
} from "../src/ai/claim-audit";
import { Store } from "../src/db/store";
import type { Message } from "../src/types";
import { qualifyUnavailableResearch } from "../src/ai/qualify-research";
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
  it("rejects numeric substrings and dates absent from the cited quote", () => {
    const p = proposal();
    p.claims[0].fact.value = "$9";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("insufficient");
    p.claims[0].fact.value = "$2";
    expect(
      validateClaimProposal(p, answer, citations, [snapshot])[0].status,
    ).toBe("insufficient");
    p.claims[0].fact.value = "$20";
    const wrongDate = { ...p.claims[0].fact, effectiveDate: "2026-11-02" };
    expect(
      validateClaimProposal(
        { claims: [{ ...p.claims[0], fact: wrongDate }] },
        answer,
        citations,
        [snapshot],
      )[0].status,
    ).toBe("insufficient");
  });
  it("accepts the same release day written in different unambiguous date formats", () => {
    const p = proposal();
    const datedFact = {
      ...p.claims[0].fact,
      field: "release date",
      value: "2026-11-01",
      effectiveDate: "November 1, 2026",
    };
    const claim = validateClaimProposal(
      { claims: [{ ...p.claims[0], fact: datedFact }] },
      answer,
      citations,
      [snapshot],
    )[0];
    expect(claim.status).toBe("supported");
    expect(compareClaims([claim], [])).toEqual([]);
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
      {
        ...args,
        client: client(
          JSON.stringify({
            ...proposal(),
            followup: "Check the named vendor’s official billing terms.",
          }),
        ),
      },
      async () => snapshot,
    );
    expect(result.audit).toMatchObject({
      status: "checked",
      sources: [snapshot],
      claims: [{ status: "supported" }],
      comparisons: [{ status: "unverified" }],
    });
    expect(result.followup).toBe(
      "Check the named vendor’s official billing terms.",
    );
  });
  it("audits cited pages before spending time on merely consulted URLs", async () => {
    const fetched: string[] = [];
    await auditAnswer(
      {
        ...args,
        sources: [{ url: "https://example.com/consulted", title: "Other" }],
        client: client(JSON.stringify(proposal())),
      },
      async (pageUrl) => {
        fetched.push(pageUrl);
        return snapshot;
      },
    );
    expect(fetched).toEqual([url]);
  });
  it("keeps an owned transcript quote out of the web claims without shifting citation offsets", async () => {
    const old = message([]);
    const local = `The old chat said $15. [Chat](/?thread=${old.conversationId}#message-${old.id})`;
    const combined = `${local}\n\n${answer}`;
    const offset = local.length + 2;
    const shifted = citations.map((item) => ({
      ...item,
      start: item.start + offset,
      end: item.end + offset,
    }));
    const result = await auditAnswer(
      {
        ...args,
        answer: combined,
        citations: shifted,
        history: [old],
        client: {
          responses: {
            create: async ({ input }: { input: { content: string }[] }) => {
              const body = JSON.parse(input[1].content);
              expect(body.answer).toBe(
                `${" ".repeat(local.length)}\n\n${answer}`,
              );
              expect(body.citations).toEqual(shifted);
              return {
                status: "completed",
                output_text: JSON.stringify(proposal()),
              };
            },
          },
        } as unknown as OpenAI,
      },
      async () => snapshot,
    );
    expect(result.audit.claims[0]).toMatchObject({
      status: "supported",
      start: offset,
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

it("withholds pricing for an unavailable cited page while preserving the other source and offsets", () => {
  const unavailableUrl = "https://example.com/blocked";
  const past =
    "Earlier shortlist: Alpha and Beta. [Chat](/?thread=one#message-two)";
  const text = `${past}\n\nI checked each vendor’s pricing page:\nI checked the current official pricing pages:\n\n| Product | Price |\n| --- | --- |\n| Beta | $99 ([Beta](${unavailableUrl})) |\n| Alpha | ${answer} |`;
  const alpha = {
    ...citations[0],
    start: text.indexOf("[Source]"),
    end: text.indexOf("[Source]") + 8,
  };
  const beta = {
    url: unavailableUrl,
    title: "Beta",
    start: text.indexOf("([Beta]"),
    end: text.indexOf(" |\n| Alpha"),
  };
  const claim = supported();
  const retainedClaim = {
    ...claim,
    start: text.indexOf(claim.claim),
    end: text.indexOf(claim.claim) + claim.claim.length,
  };
  const audit = {
    ...emptyAudit(),
    status: "checked" as const,
    sources: [
      snapshot,
      {
        ...snapshot,
        url: unavailableUrl,
        state: "unavailable" as const,
        text: "",
      },
    ],
    claims: [
      retainedClaim,
      {
        ...retainedClaim,
        id: "past",
        claim: "and Beta",
        start: past.indexOf("and Beta"),
        end: past.indexOf("and Beta") + "and Beta".length,
        historical: true,
        status: "insufficient" as const,
      },
    ],
  };
  const qualified = qualifyUnavailableResearch(
    text,
    [beta, alpha],
    audit,
    true,
  );
  expect(qualified.answer).toContain(past);
  expect(qualified.answer).toContain("Official sources:");
  expect(qualified.answer).not.toContain("I checked each");
  expect(qualified.answer).not.toContain("I checked the current");
  expect(qualified.answer).toContain(
    "| Beta | I couldn’t independently verify the details",
  );
  expect(qualified.answer).not.toContain("$99");
  expect(qualified.answer).toContain("| Alpha | Alpha costs $20");
  expect(
    qualified.citations.map(({ start, end }) =>
      qualified.answer.slice(start, end),
    ),
  ).toEqual([`([example.com](${unavailableUrl}))`, "[Source]"]);
  const [kept] = qualified.audit.claims;
  expect(qualified.answer.slice(kept.start, kept.end)).toBe(kept.claim);
});

it("withholds an unsupported earlier pricing claim without removing the supported current price", () => {
  const text = "Alpha costs $20, while an older listing showed $15. [Source]";
  const historical = "an older listing showed $15.";
  const current = supported();
  const audit: EvidenceAudit = {
    ...emptyAudit(),
    status: "checked",
    sources: [snapshot],
    claims: [
      {
        ...current,
        claim: "Alpha costs $20",
        start: 0,
        end: "Alpha costs $20".length,
      },
      {
        ...current,
        id: "older",
        claim: historical,
        start: text.indexOf(historical),
        end: text.indexOf(historical) + historical.length,
        status: "insufficient",
        historical: true,
      },
    ],
  };
  const result = qualifyUnavailableResearch(
    text,
    [{ ...citations[0], start: text.indexOf("[Source]"), end: text.length }],
    audit,
    true,
  );
  expect(result.answer).toBe("Alpha costs $20. [Source]");
  expect(result.audit.claims).toHaveLength(1);
  expect(
    result.answer.slice(result.citations[0].start, result.citations[0].end),
  ).toBe("[Source]");
});
