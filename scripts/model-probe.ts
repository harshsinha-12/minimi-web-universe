import "../src/config";
import OpenAI from "openai";
import { normalizeResponse } from "../src/ai/evidence";
const client = new OpenAI({ maxRetries: 0, timeout: 45000 });
const start = Date.now();
try {
  const response = await client.responses.create({
    model: "gpt-6-astra",
    store: false,
    tools: [{ type: "web_search", external_web_access: true }],
    tool_choice: "required",
    max_tool_calls: 3,
    max_output_tokens: 1200,
    input:
      "Check the official PostgreSQL website for the current stable major version and whether a newer major version is a release candidate. Cite your sources. Answer in two sentences.",
  });
  const n = normalizeResponse(response);
  console.log(
    JSON.stringify(
      {
        model: response.model,
        status: response.status,
        elapsedMs: Date.now() - start,
        answer: n.text,
        citations: n.citations.length,
        tokens: n.usage?.total_tokens,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log(
    e instanceof OpenAI.APIError
      ? `OpenAI: HTTP ${e.status} (${e.code ?? "unknown"})`
      : "Probe failed",
  );
  process.exitCode = 1;
}
