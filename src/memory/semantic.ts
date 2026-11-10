import { createHash } from "node:crypto";
import { settings } from "../config";
import type { Store } from "../db/store";
import type { Message } from "../types";
import { embedTexts } from "../ai/__tools__/tool__embeddings";
import {
  pineconeIndex,
  pineconeReady,
  type VectorIndex,
  type VectorMatch,
} from "../ai/__tools__/tool__pinecone";
import { SemanticJobs } from "./index-jobs";

export const fingerprint = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function semanticKey() {
  return fingerprint(
    JSON.stringify([
      settings.pineconeHost,
      settings.pineconePrefix,
      settings.embeddingModel,
      settings.embeddingDimensions,
      "chunks-v1",
    ]),
  ).slice(0, 20);
}
export const semanticNamespace = (owner: string) =>
  `${settings.pineconePrefix}-${semanticKey()}-${fingerprint(owner).slice(0, 32)}`;
export function chunkMessage(text: string) {
  const points = Array.from(text); // Split Unicode code points without broken surrogate pairs.
  const chunks: string[] = [];
  for (let start = 0; start < points.length; start += 1700) {
    chunks.push(points.slice(start, start + 2000).join(""));
    if (start + 2000 >= points.length) break;
  }
  if (chunks.length > 64)
    throw new Error("Message exceeds semantic indexing budget");
  return chunks;
}
export function hydrateMatches(
  store: Store,
  owner: string,
  matches: VectorMatch[],
): Message[] {
  const excluded = new Set(store.excluded(owner));
  const found = new Map<string, Message>();
  for (const hit of matches) {
    const id = hit.metadata?.messageId;
    if (
      !id ||
      excluded.has(id) ||
      !Number.isFinite(hit.score) ||
      hit.score! < 0.25
    )
      continue;
    const message = store.message(owner, id);
    if (
      message?.status === "completed" &&
      hit.metadata?.fingerprint === fingerprint(message.content)
    )
      found.set(id, message);
    if (found.size >= 8) break;
  }
  return [...found.values()];
}
export async function semanticRecall(
  store: Store,
  owner: string,
  question: string,
  signal = AbortSignal.timeout(2500),
) {
  if (!pineconeReady()) return [];
  try {
    const { vectors } = await embedTexts([question], signal);
    const matches = await pineconeIndex().query(
      semanticNamespace(owner),
      vectors[0],
      signal,
    );
    return hydrateMatches(store, owner, matches);
  } catch {
    return [];
  } // FTS/date/recent retrieval stays available when a provider is slow or down.
}
export async function indexNextMessage(
  store: Store,
  index: VectorIndex = pineconeIndex(),
  embed = embedTexts,
) {
  const jobs = new SemanticJobs(store.db);
  const job = jobs.claim(semanticKey());
  if (!job) return null;
  try {
    const message = store.message(job.owner, job.messageId);
    if (
      !message ||
      message.status !== "completed" ||
      store.excluded(job.owner).includes(job.messageId)
    ) {
      jobs.complete(job);
      return { indexed: false, tokens: 0 };
    }
    const chunks = chunkMessage(message.content);
    if (!chunks.length) {
      jobs.complete(job);
      return { indexed: false, tokens: 0 };
    }
    const signal = AbortSignal.timeout(45000);
    const { vectors, tokens } = await embed(chunks, signal);
    await index.upsert(
      semanticNamespace(job.owner),
      vectors.map((values, i) => ({
        id: `${message.id}:${i}`,
        values,
        metadata: {
          messageId: message.id,
          fingerprint: fingerprint(message.content),
        },
      })),
      signal,
    );
    const committed = jobs.complete(job);
    return { indexed: committed, tokens };
  } catch {
    jobs.retry(job);
    return { indexed: false, tokens: 0 };
  }
}
