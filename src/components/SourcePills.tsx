"use client";
import { useEffect, useState } from "react";
import type { Citation, Source } from "../types";
import { pillSources, sourceName } from "../ai/source-label";

type Detail = { title: string; description: string };

export function SourcePills({
  messageId,
  sources,
  citations,
}: {
  messageId: string;
  sources: Source[];
  citations: Citation[];
}) {
  const items = pillSources(sources, citations);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/messages/${messageId}/source-pills`, {
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : { pills: [] }))
      .then((data: { pills?: Array<Detail & { index: number }> }) => {
        const next: Record<number, Detail> = {};
        for (const pill of data.pills ?? [])
          next[pill.index] = {
            title: pill.title,
            description: pill.description,
          };
        setDetails(next);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [messageId]);
  if (!items.length) return null;
  return (
    <div className="source-pills" aria-label="Sources">
      {items.map((item, index) => {
        const detail = details[index];
        const title = detail?.title || sourceName(item.url, item.title);
        const description = detail?.description || "";
        return (
          <a
            className="source-pill"
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <PillLogo
              src={`/api/messages/${messageId}/source-icon?source=${index}`}
              name={sourceName(item.url, item.title)}
            />
            <span className="source-pill-copy">
              <strong>{title}</strong>
              {description && <em>{description}</em>}
            </span>
          </a>
        );
      })}
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
