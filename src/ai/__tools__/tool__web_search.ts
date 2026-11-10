import type { Tool } from "openai/resources/responses/responses";

// This is the complete model-facing tool registry. Retrieval and evals are application code.
export function webSearchTools(allowed: boolean, recheck: boolean): Tool[] {
  return allowed
    ? [
        {
          type: "web_search",
          external_web_access: true,
          search_context_size: recheck ? "high" : "medium",
        },
      ]
    : [];
}
