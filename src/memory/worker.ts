import { getStore, type Job } from "../db/store";
import { settings } from "../config";
import { redis } from "../cache/redis";
import { synthesize } from "../ai/__agents__/agent__memory";
import { indexNextMessage } from "./semantic";
import { pineconeReady } from "../ai/__tools__/tool__pinecone";
import { componentLogger } from "../server/logger";
const log = componentLogger("memory");
const store = getStore();
let stopping = false;
let busy = false;
async function tick() {
  if (
    stopping ||
    busy ||
    !settings.memoryEnabled ||
    !process.env.OPENAI_API_KEY
  )
    return;
  busy = true;
  let job: Job | null = null;
  try {
    job = store.claimJob();
    if (!job) return;
    const messages = store.jobMessages(job);
    const previous = store.memories(job.owner);
    const result = await synthesize(
      messages,
      previous,
      store.forgotten(job.owner),
      AbortSignal.timeout(55000),
    );
    if (!store.completeMemory(job, result.proposal.entries))
      store.retryJob(
        job,
        "Input changed or unsupported source; retry with current records",
      );
    else
      log.info(
        {
          status: "completed",
          entries: result.proposal.entries.length,
          tokens: result.usage?.total_tokens,
        },
        "memory consolidation completed",
      );
  } catch (err) {
    if (job) store.retryJob(job, "Synthesis unavailable; retry scheduled");
    log.warn({ err }, "memory synthesis failed");
  } finally {
    busy = false;
  }
}
const timer = setInterval(() => void tick(), 3000);
let indexing = false;
async function indexTick() {
  if (stopping || indexing || !pineconeReady()) return;
  indexing = true;
  try {
    const result = await indexNextMessage(store);
    if (result)
      log.info(
        { component: "semantic-memory", ...result },
        "semantic index advanced",
      );
  } catch (err) {
    log.warn({ err }, "semantic indexing failed; job remains queued");
  } finally {
    indexing = false;
  }
}
const indexTimer = setInterval(() => void indexTick(), 1000);
void tick();
void (async () => {
  const connection = await redis();
  if (!connection) return;
  const sub = connection.duplicate();
  sub.on("error", () => {});
  try {
    await sub.connect();
    await sub.subscribe("minimi:memory:wake", () => void tick());
  } catch (err) {
    log.warn(
      { err },
      "memory wake subscription unavailable; polling continues",
    );
  }
})();
log.info("memory worker ready");
for (const event of ["SIGTERM", "SIGINT"])
  process.on(event, () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(indexTimer);
    setTimeout(() => process.exit(0), 300).unref();
  });
