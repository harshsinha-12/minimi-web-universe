import type { Message } from "../../types";
import { auditPageUrl } from "../claim-audit";
import type { EvalCase } from "./eval__schema";

export function researchEvidence(message: Message): EvalCase["evidence"] {
  const cited = new Set(
    message.citations.map(({ url }) => auditPageUrl(url)).filter(Boolean),
  );
  return (message.evidence?.sources ?? [])
    .filter(
      (source) =>
        source.state === "fetched" &&
        source.text &&
        (cited.has(auditPageUrl(source.url)) ||
          (source.finalUrl && cited.has(auditPageUrl(source.finalUrl)))),
    )
    .map(({ id, url, text, observedAt }) => ({
      id,
      url,
      excerpt: text,
      observedAt,
    }));
}

export function researchChecks(
  expected: NonNullable<EvalCase["research"]>,
  message: Message,
  searchActions: number,
  history: EvalCase["history"],
) {
  const hosts = message.citations.flatMap(({ url }) => {
    const canonical = auditPageUrl(url);
    return canonical ? [new URL(canonical).hostname] : [];
  });
  const hasOwnedReference = Array.from(
    message.content.matchAll(/\/\?thread=([\w-]+)#message-([\w-]+)/g),
  ).some(([, threadId, messageId]) =>
    history.some(
      (record) => record.conversationId === threadId && record.id === messageId,
    ),
  );
  const comparisons = message.evidence?.comparisons ?? [];
  return [
    { name: "hosted search", passed: searchActions > 0 },
    { name: "exact history link", passed: hasOwnedReference },
    ...expected.primaryDomains.map((domains) => ({
      name: `native citation from ${domains.join(" or ")}`,
      passed: domains.some((domain) =>
        hosts.some((host) => host === domain || host.endsWith(`.${domain}`)),
      ),
    })),
    {
      name: "persisted cited-page evidence",
      passed: researchEvidence(message).length > 0,
    },
    ...(expected.comparison
      ? [
          {
            name: `persisted ${expected.comparison} comparison`,
            passed:
              comparisons.length > 0 &&
              comparisons.every(({ status }) => status === expected.comparison),
          },
        ]
      : []),
  ];
}
