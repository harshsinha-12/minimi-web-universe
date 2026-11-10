import type { StreamEvent } from "../types";
export async function consumeEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function drain(final = false) {
    let match: RegExpMatchArray | null;
    while ((match = buffer.match(/\r?\n\r?\n/))) {
      const at = match.index!;
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + match[0].length);
      const payload = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (payload) onEvent(JSON.parse(payload));
    }
    if (final && buffer.trim() && !buffer.trim().startsWith(":"))
      throw new Error("The response stream was interrupted.");
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain(true);
  } finally {
    reader.releaseLock();
  }
}
