import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { settings } from "../../config";
import { Store } from "../../db/store";
import { closeRedis } from "../../cache/redis";
import { evalCases } from "../__data__/data__eval_cases";
import { judgeAnswer } from "../__agents__/agent__judge";
import { runAgent } from "../__agents__/agent__master";
import type { EvalCase } from "./eval__schema";

const args = process.argv.slice(2);
const live = args.includes("--judge") || args.includes("--agent");
if (!live) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run"],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} else {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is required for live evaluations");
  const selected = args.find((arg) => arg.startsWith("--case="))?.slice(7);
  const cases = evalCases.filter(
    (test) =>
      (!selected || test.id === selected) &&
      (!args.includes("--agent") || test.agent),
  );
  if (!cases.length) throw new Error("No matching evaluation cases");
  const report: Record<string, unknown>[] = [];
  let failures = 0;
  for (const test of cases) {
    let candidates: {
      label: string;
      answer: string;
      expectedPass: boolean;
      history?: EvalCase["history"];
    }[];
    try {
      candidates = args.includes("--agent")
        ? [{ label: "agent", ...(await answerCase(test)), expectedPass: true }]
        : [
            { label: "good", answer: test.good, expectedPass: true },
            { label: "bad", answer: test.bad, expectedPass: false },
          ];
    } catch {
      failures++;
      report.push({
        case: test.id,
        error: "Candidate agent failed or violated the tool policy; not scored",
      });
      continue;
    }
    for (const candidate of candidates) {
      try {
        const result = await judgeAnswer(
          { ...test, history: candidate.history ?? test.history },
          candidate.answer,
        );
        const agrees = result.passed === candidate.expectedPass;
        if (!agrees) failures++;
        report.push({ case: test.id, ...candidate, ...result, agrees });
        console.log(
          JSON.stringify({
            case: test.id,
            candidate: candidate.label,
            passed: result.passed,
            score: result.score,
            agrees,
          }),
        );
      } catch (error) {
        failures++;
        const reason =
          error instanceof Error && error.message.startsWith("Judge ")
            ? error.message
            : "Judge unavailable or invalid verdict; not scored";
        report.push({ case: test.id, label: candidate.label, error: reason });
        console.error(`${test.id}/${candidate.label}: ${reason}`);
      }
    }
  }
  mkdirSync(".data/evals", { recursive: true });
  const path = `.data/evals/${args.includes("--agent") ? "agent" : "judge-calibration"}-${Date.now()}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        mode: args.includes("--agent")
          ? "production-history-agent"
          : "judge-calibration",
        answerModel: settings.model,
        judgeModel: settings.judgeModel,
        failures,
        report,
      },
      null,
      2,
    ),
  );
  console.log(
    `Saved ${report.length} results to ${path}; ${failures} failures.`,
  );
  await closeRedis();
  process.exitCode = failures ? 1 : 0;
}

async function answerCase(test: EvalCase) {
  const store = new Store(":memory:");
  try {
    const owner = `eval-${randomUUID()}`;
    const thread = store.createConversation(owner);
    for (let i = 0; i < test.history.length; i++) {
      const record = test.history[i];
      if (record.role !== "user")
        throw new Error("Agent fixture must begin with user history");
      const { run } = store.begin(
        owner,
        thread,
        randomUUID(),
        record.text,
        record.at,
      );
      const next = test.history[i + 1];
      const answer =
        next?.role === "assistant" ? (i++, next.text) : "Understood.";
      store.finish(owner, run.id, answer, [], [], [], {});
      // Persist the fixture's historical exchange time, rather than the machine's current time.
      store.db
        .prepare(
          "UPDATE messages SET created_at=? WHERE run_id=? AND role='assistant'",
        )
        .run(record.at, run.id);
    }
    const target = store.createConversation(owner);
    const { run } = store.begin(owner, target, randomUUID(), test.question);
    await runAgent({
      store,
      owner,
      conversationId: target,
      runId: run.id,
      question: test.question,
      timezone: "Asia/Kolkata",
      forceSearch: false,
      signal: AbortSignal.timeout(settings.deadline),
      emit: () => {},
    });
    const finished = store.run(owner, run.id);
    if (finished?.status !== "completed")
      throw new Error("Candidate agent failed to complete");
    if (Number(finished.metrics.searchActions ?? 0) > 0)
      throw new Error("Candidate violated no-search instruction");
    return {
      answer: store
        .messages(owner, target)
        .find((message) => message.role === "assistant")!.content,
      history: store.messages(owner, thread).map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        text: message.content,
        at: message.createdAt,
      })),
    };
  } finally {
    store.close();
  }
}
