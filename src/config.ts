import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
export const settings = {
  model: process.env.OPENAI_MODEL || "gpt-6-astra",
  memoryModel: process.env.MEMORY_MODEL || "gpt-5.4-mini",
  database: process.env.DATABASE_PATH || ".data/minimi.sqlite",
  deadline: Number(process.env.AGENT_DEADLINE_MS || 90000),
  memoryIdle: Number(process.env.MEMORY_IDLE_MS || 20000),
  memoryMaxWait: Number(process.env.MEMORY_MAX_WAIT_MS || 120000),
  memoryEnabled: process.env.MEMORY_ENABLED !== "false",
  judgeModel: process.env.JUDGE_MODEL || "gpt-5.4-mini",
  transcribeModel: process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
  semanticEnabled: process.env.PINECONE_ENABLED === "true",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
  pineconeHost: process.env.PINECONE_INDEX_HOST || "",
  pineconePrefix: process.env.PINECONE_NAMESPACE_PREFIX || "minimi-dev",
};
