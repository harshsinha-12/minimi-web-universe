import OpenAI from "openai";
import { settings } from "../../config";

// Used by application retrieval and the worker, never exposed as a conversational tool.
export async function embedTexts(input: string[], signal: AbortSignal) {
  const response = await new OpenAI({
    maxRetries: 0,
    timeout: 15000,
  }).embeddings.create(
    {
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions,
      encoding_format: "float",
      input,
    },
    { signal },
  );
  const vectors = response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
  if (
    vectors.length !== input.length ||
    vectors.some(
      (v) =>
        v.length !== settings.embeddingDimensions ||
        v.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error("Unexpected embedding dimensions or count");
  return { vectors, tokens: response.usage.total_tokens };
}
