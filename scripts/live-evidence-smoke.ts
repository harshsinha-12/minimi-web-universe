// Opt-in provider check against synthetic captured pages; never reads or writes user history.
import assert from "node:assert/strict";
import OpenAI from "openai";
import { auditAnswer, type SourceSnapshot } from "../src/ai/claim-audit";
if (!process.argv.includes("--live"))
  throw new Error(
    "Pass --live to spend API credits on two synthetic evidence audits.",
  );
const client = new OpenAI({ maxRetries: 0, timeout: 30000 });
const url = "https://example.com/pricing";
const page: SourceSnapshot = {
  id: "fixture",
  url,
  finalUrl: url,
  observedAt: new Date().toISOString(),
  hash: "synthetic",
  state: "fetched",
  text: "Alpha Pro in the United States costs USD 20 per user per month when billed annually. Monthly billing costs USD 25 per user per month. These rates exclude tax.",
};
const cases = [
  {
    name: "supported annual rate",
    answer:
      "Alpha Pro in the United States costs USD 20 per user per month when billed annually. [Source]",
    supported: true,
  },
  {
    name: "incorrect billing period",
    answer:
      "Alpha Pro in the United States costs USD 20 per user per month when billed monthly. [Source]",
    supported: false,
  },
];
for (const fixture of cases) {
  const started = Date.now();
  const { audit } = await auditAnswer(
    {
      client,
      answer: fixture.answer,
      citations: [
        {
          url,
          title: "Synthetic pricing",
          start: fixture.answer.indexOf("[Source]"),
          end: fixture.answer.length,
        },
      ],
      sources: [],
      baseline: [],
      compare: false,
      signal: AbortSignal.timeout(30000),
    },
    async () => page,
  );
  assert.equal(audit.status, "checked", `${fixture.name}: audit unavailable`);
  assert.ok(audit.claims.length > 0);
  if (fixture.supported)
    assert.ok(audit.claims.every((c) => c.status === "supported"));
  else
    assert.ok(
      audit.claims.some(
        (c) => c.status === "contradicted" || c.status === "insufficient",
      ),
    );
  console.log(
    JSON.stringify({
      fixture: fixture.name,
      claims: audit.claims.map((c) => c.status),
      elapsedMs: Date.now() - started,
    }),
  );
}
