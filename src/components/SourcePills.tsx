"use client";
import { useEffect, useState } from "react";
import type { Citation, Source } from "../types";
import { sourceList, sourceName } from "../ai/source-label";

type Detail = { title: string; description: string; name: string };

export function SourcePills({
  messageId,
  sources,
  citations,
}: {
  messageId: string;
  sources: Source[];
  citations: Citation[];
}) {
  const items = sourceList(sources, citations);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetch(`/api/messages/${messageId}/source-pills`, {
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : { pills: [] }))
      .then((data: { pills?: Array<Detail & { index: number }> }) => {
        const next: Record<number, Detail> = {};
        for (const pill of data.pills ?? []) next[pill.index] = pill;
        setDetails(next);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [messageId, open]);
  if (!items.length) return null;
  const extra = Math.max(0, items.length - 3);
  return (
    <div className="source-cluster">
      <button
        type="button"
        className="source-cluster-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="source-stack" aria-hidden="true">
          {items.slice(0, 3).map((item, index) => (
            <PillLogo
              key={item.url}
              src={`/api/messages/${messageId}/source-icon?source=${index}`}
              name={sourceName(item.url, item.title)}
            />
          ))}
        </span>
        {extra > 0 && <span className="source-extra">+{extra}</span>}
        <span>
          {items.length} {items.length === 1 ? "Source" : "Sources"}
        </span>
      </button>
      {open && (
        <div className="source-sheet" role="region" aria-label="Sources">
          {items.map((item, index) => {
            const detail = details[index];
            const name = detail?.name || sourceName(item.url, item.title);
            const title = detail?.title || item.title || name;
            const description =
              detail?.description && detail.description !== title
                ? detail.description
                : "";
            const line = title !== name ? title : description;
            return (
              <a
                className="source-card"
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <PillLogo
                  src={`/api/messages/${messageId}/source-icon?source=${index}`}
                  name={name}
                />
                <span className="source-card-copy">
                  <strong>{name}</strong>
                  {line && <em>{line}</em>}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PillLogo({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="source-pill-mark" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
    );
  return (
    // An owned, SSRF-checked logo endpoint.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setFailed(true)} />
  );
}
