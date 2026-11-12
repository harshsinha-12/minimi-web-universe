import type { EvidenceAudit } from "../ai/claim-audit";
export function EvidenceDetails({ audit }: { audit: EvidenceAudit }) {
  return (
    <details className="evidence-details">
      <summary>
        Page support ·{" "}
        {audit.status === "unavailable"
          ? "unavailable"
          : `${audit.claims.filter((c) => c.status === "supported").length}/${audit.claims.length} checked claims supported`}
      </summary>
      <p className="muted">
        Independent model review of fetched page text. Coverage is bounded;
        support is a judgement, not a guarantee. Checked{" "}
        {new Date(audit.checkedAt).toLocaleString()}.
      </p>
      {audit.claims.map((claim) => (
        <article key={claim.id}>
          <strong>{claim.status.replaceAll("_", " ")}</strong> · {claim.claim}
          <p>{claim.reason}</p>
          {claim.evidenceQuote && (
            <blockquote>{claim.evidenceQuote}</blockquote>
          )}
          {claim.url && (
            <a href={claim.url} target="_blank" rel="noopener noreferrer">
              Cited page
            </a>
          )}
        </article>
      ))}
      {audit.comparisons.map((comparison) => (
        <article key={comparison.id}>
          <strong>
            {comparison.subject}: {comparison.status.replaceAll("_", " ")}
          </strong>
          <p>{comparison.reason}</p>
          <p>
            Earlier:{" "}
            {comparison.baselineFact?.value ?? "no verified observation"} ·
            Current: {comparison.currentFact.value}
          </p>
          <p className="muted">
            {[
              comparison.currentFact.plan,
              comparison.currentFact.region,
              comparison.currentFact.currency,
              comparison.currentFact.billingPeriod,
              comparison.currentFact.unit,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {comparison.baselineObservedAt && (
            <p className="muted">
              Baseline observed{" "}
              {new Date(comparison.baselineObservedAt).toLocaleString()}
            </p>
          )}
          {comparison.baselineMessageId && (
            <a
              href={`/?thread=${comparison.baselineConversationId}#message-${comparison.baselineMessageId}`}
            >
              Historical observation
            </a>
          )}
          {comparison.effectiveDate && (
            <p>
              Effective date supported by current evidence:{" "}
              {comparison.effectiveDate}
            </p>
          )}
        </article>
      ))}
    </details>
  );
}
