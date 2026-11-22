import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { settings } from "../../config";
import { Store } from "../../db/store";
import { closeRedis } from "../../cache/redis";
import { evalCases } from "../__data__/data__eval_cases";
import { judgeAnswer } from "../__agents__/agent__judge";
import { runAgent } from "../__agents__/agent__master";
import { researchChecks, researchEvidence } from "./eval__research";
import type { EvalCase } from "./eval__schema";
import type { Citation, Run } from "../../types";

type AgentCandidate = {
  answer: string;
  history: EvalCase["history"];
  evidence: EvalCase["evidence"];
  checks: { name: string; passed: boolean }[];
  citations: Citation[];
  metrics: Run["metrics"];
};

const args = process.argv.slice(2);
const agent = args.includes("--agent");
const live = args.includes("--judge") || agent;
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
  const suite =
    args.find((arg) => arg.startsWith("--suite="))?.slice(8) ?? "history";
  if (
    !["history", "research"].includes(suite) ||
    (!agent && suite !== "history")
  )
    throw new Error("Use --suite=history or --suite=research with --agent");
  const selected = args.find((arg) => arg.startsWith("--case="))?.slice(7);
  const cases = evalCases.filter(
    (test) =>
      (!selected || test.id === selected) &&
      Boolean(test.research) === (suite === "research") &&
      (!agent || test.agent),
  );
  if (!cases.length) throw new Error("No matching evaluation cases");
  const report: Record<string, unknown>[] = [];
  const durations: number[] = [];
  const startedAt = new Date().toISOString();
  let failures = 0;
  let unscored = 0;
  for (const test of cases) {
    let candidates: ({
      label: string;
      answer: string;
      expectedPass: boolean;
    } & Partial<AgentCandidate>)[];
    try {
      candidates = agent
        ? [{ label: "agent", ...(await answerCase(test)), expectedPass: true }]
        : [
            { label: "good", answer: test.good, expectedPass: true },
            { label: "bad", answer: test.bad, expectedPass: false },
          ];
    } catch (error) {
      failures++;
      unscored++;
      report.push({
        case: test.id,
        error:
          error instanceof Error
            ? error.message
            : "Candidate agent failed; not scored",
      });
      continue;
    }
    for (const candidate of candidates) {
      const elapsed = candidate.metrics?.elapsedMs;
      if (typeof elapsed === "number") durations.push(elapsed);
      try {
        const result = await judgeAnswer(
          {
            ...test,
            history: candidate.history ?? test.history,
            evidence: candidate.evidence ?? test.evidence,
          },
          candidate.answer,
        );
        const passed =
          result.passed &&
          (candidate.checks?.every((check) => check.passed) ?? true);
        const agrees = passed === candidate.expectedPass;
        if (!agrees) failures++;
        report.push({
          case: test.id,
          ...candidate,
          ...result,
          judgePassed: result.passed,
          passed,
          agrees,
        });
        console.log(
          JSON.stringify({
            case: test.id,
            candidate: candidate.label,
            passed,
            score: result.score,
            agrees,
            failedChecks: candidate.checks
              ?.filter((check) => !check.passed)
              .map((check) => check.name),
          }),
        );
      } catch (error) {
        failures++;
        unscored++;
        const reason =
          error instanceof Error && error.message.startsWith("Judge ")
            ? error.message
            : "Judge unavailable or invalid verdict; not scored";
        report.push({ case: test.id, ...candidate, error: reason });
        console.error(`${test.id}/${candidate.label}: ${reason}`);
      }
    }
  }
  mkdirSync(".data/evals", { recursive: true });
  const mode = agent ? `production-${suite}-agent` : "judge-calibration";
  const path = `.data/evals/${mode}-${Date.now()}.json`;
  durations.sort((a, b) => a - b);
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        mode,
        startedAt,
        answerModel: settings.model,
        reasoningEffort: settings.reasoning?.effort ?? null,
        judgeModel: settings.judgeModel,
        latencyMs: {
          sampleCount: durations.length,
          p50: durations[Math.ceil(durations.length * 0.5) - 1] ?? null,
          p95: durations[Math.ceil(durations.length * 0.95) - 1] ?? null,
        },
        failures,
        scoredFailures: failures - unscored,
        unscored,
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

async function answerCase(test: EvalCase): Promise<AgentCandidate> {
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
        .run(next?.role === "assistant" ? next.at : record.at, run.id);
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
      forceSearch: Boolean(test.research),
      useSearchCache: false,
      signal: AbortSignal.timeout(settings.deadline),
      emit: () => {},
    });
    const finished = store.run(owner, run.id);
    if (finished?.status !== "completed")
      throw new Error(finished?.error ?? "Candidate agent failed to complete");
    const message = store
      .messages(owner, target)
      .find((entry) => entry.role === "assistant");
    if (!message) throw new Error("Completed run has no persisted answer");
    const searchActions = Number(finished.metrics.searchActions ?? 0);
    const history = store.messages(owner, thread).map((entry) => ({
      id: entry.id,
      conversationId: entry.conversationId,
      role: entry.role,
      text: entry.content,
      at: entry.createdAt,
    }));
    const checks = test.research
      ? researchChecks(test.research, message, searchActions, history)
      : [{ name: "no web search", passed: searchActions === 0 }];
    return {
      answer: message.content,
      history,
      evidence: test.research ? researchEvidence(message) : test.evidence,
      checks,
      citations: message.citations,
      metrics: finished.metrics,
    };
  } finally {
    store.close();
  }
}
