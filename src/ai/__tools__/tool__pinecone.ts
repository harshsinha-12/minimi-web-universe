import { Pinecone } from "@pinecone-database/pinecone";
import { settings } from "../../config";

export type VectorMetadata = { messageId: string; fingerprint: string };
export type VectorMatch = {
  id: string;
  score?: number;
  metadata?: VectorMetadata;
};
export interface VectorIndex {
  upsert(
    namespace: string,
    records: { id: string; values: number[]; metadata: VectorMetadata }[],
    signal: AbortSignal,
  ): Promise<void>;
  query(
    namespace: string,
    vector: number[],
    signal: AbortSignal,
  ): Promise<VectorMatch[]>;
}
export function pineconeReady() {
  return (
    settings.semanticEnabled &&
    Boolean(
      process.env.PINECONE_API_KEY &&
      settings.pineconeHost &&
      process.env.OPENAI_API_KEY,
    )
  );
}
export function pineconeIndex(): VectorIndex {
  const index = (signal: AbortSignal) =>
    new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
      maxRetries: 0,
      fetchApi: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        }),
    }).index<VectorMetadata>({ host: settings.pineconeHost });
  return {
    async upsert(namespace, records, signal) {
      await index(signal).upsert({ namespace, records });
    },
    async query(namespace, vector, signal) {
      const response = await index(signal).query({
        namespace,
        vector,
        topK: 16,
        includeMetadata: true,
        includeValues: false,
      });
      return response.matches;
    },
  };
}
