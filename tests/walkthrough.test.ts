import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { buildContext } from "../src/ai/context";
import {
  compareClaims,
  type ClaimSupport,
  type FactRecord,
} from "../src/ai/claim-audit";
import { resolvePageLinks } from "../src/ai/page-links";
import type { Message } from "../src/types";

vi.mock("../src/cache/redis", () => ({
  cached: async (_key: string, load: () => unknown) => load(),
}));

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

const when = "2026-11-03T08:00:00.000Z";
const price = (value: string, billingPeriod: string): FactRecord => ({
  subject: "HubSpot",
  field: "price",
  value,
  plan: "Starter",
  region: "United States",
  currency: "USD",
  billingPeriod,
  unit: "seat",
  effectiveDate: null,
});

function claim(fact: FactRecord): ClaimSupport {
  return {
    id: randomUUID(),
    claim: `HubSpot Starter is ${fact.value} per seat.`,
    start: 0,
    end: 10,
    fact,
    sourceId: "page",
    url: "https://www.hubspot.com/pricing",
    evidenceQuote: `${fact.value} per seat per month`,
    status: "supported",
    reason: "The pricing page states the amount.",
  };
}

function baseline(store: Store, thread: string, fact: FactRecord): Message {
  const saved = store
    .messages("alice", thread)
    .find((item) => item.role === "assistant")!;
  return {
    ...saved,
    evidence: {
      version: 1,
      checkedAt: when,
      status: "checked",
      coverage: "bounded",
      claims: [claim(fact)],
      comparisons: [],
      sources: [],
    },
  };
}

describe("hiring walkthrough", () => {
  it("recovers the dated shortlist, compares matching price terms, rereads a pasted page, and applies the corrected preference", async () => {
    const started = Date.now();
    const store = new Store(":memory:");
    stores.push(store);
    store.owner("alice");
    const thread = store.createConversation("alice");
    const asked = store.begin(
      "alice",
      thread,
      randomUUID(),
      "For our 20-person sales team, the shortlist in order is HubSpot, Pipedrive and Attio.",
      when,
    );
    store.finish(
      "alice",
      asked.run.id,
      "Recorded HubSpot, Pipedrive, and Attio.",
      [],
      [],
      [],
      {},
    );
    const recalled = await buildContext(
      store,
      "alice",
      thread,
      "What did I ask on 3 November 2026?",
      "UTC",
      new Date("2026-11-22T00:00:00Z"),
    );
    expect(
      recalled.messages.some((message) =>
        message.content.includes("HubSpot, Pipedrive and Attio"),
      ),
    ).toBe(true);

    const old = baseline(store, thread, price("$20", "monthly"));
    const sameTerms = compareClaims([claim(price("$25", "monthly"))], [old]);
    const otherPeriod = compareClaims([claim(price("$25", "annual"))], [old]);
    expect(sameTerms[0]).toMatchObject({
      status: "changed",
      currentFact: {
        plan: "Starter",
        region: "United States",
        billingPeriod: "monthly",
      },
    });
    expect(otherPeriod[0].status).toBe("not_comparable");

    const page = store.begin(
      "alice",
      thread,
      randomUUID(),
      "Please read the attached page.",
      undefined,
      ["https://www.postgresql.org/docs/current/release.html"],
    );
    expect(
      resolvePageLinks(
        store.messages("alice", thread),
        page.run.id,
        "What does this page say about release history?",
      ),
    ).toEqual(["https://www.postgresql.org/docs/current/release.html"]);

    const preference = store
      .messages("alice", thread)
      .find((message) => message.content.includes("shortlist"))!;
    store.schedule("alice", true);
    store.completeMemory(store.claimJob()!, [
      {
        kind: "preference",
        text: "Prefers the US price list",
        sources: [{ messageId: preference.id, quote: "20-person sales team" }],
        validUntil: null,
      },
    ]);
    const note = store.memories("alice")[0];
    store.editMemory("alice", note.id, "Prefers the India price list");
    const personal = await buildContext(
      store,
      "alice",
      store.createConversation("alice"),
      "Which price list should I use?",
      "UTC",
      new Date("2026-11-22T00:00:00Z"),
      undefined,
      "personal",
    );
    expect(personal.memories[0]?.text).toBe("Prefers the India price list");
    expect(personal.memories[0]?.userEdited).toBe(true);
    const vanilla = await buildContext(
      store,
      "alice",
      store.createConversation("alice"),
      "Which price list should I use?",
      "UTC",
      new Date("2026-11-22T00:00:00Z"),
      undefined,
      "vanilla",
    );
    expect(vanilla.memories).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
