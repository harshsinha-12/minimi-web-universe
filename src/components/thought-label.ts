export function thoughtDuration(
  steps: { at: number }[],
  elapsedMs?: number | null,
) {
  if (
    typeof elapsedMs === "number" &&
    Number.isFinite(elapsedMs) &&
    elapsedMs >= 0
  )
    return elapsedMs;
  if (!steps.length) return null;
  return Math.max(0, steps[steps.length - 1]?.at ?? 0);
}

export function thoughtHeading(running: boolean, elapsedMs: number | null) {
  if (running) return "Working";
  if (elapsedMs == null) return "Thought";
  return `Thought for ${(elapsedMs / 1000).toFixed(1)}s`;
}

export function pineconeSource(steps: { detail: string }[] | undefined) {
  const lines = (steps ?? [])
    .map((step) => step.detail)
    .filter(
      (detail) =>
        (/^Fetched\b/.test(detail) && /\bPinecone\b/.test(detail)) ||
        (/^Saved\b/.test(detail) && /\bPinecone\b/.test(detail)),
    );
  return lines.length ? lines : null;
}
