"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Citation, Source } from "../types";
import { sourceList, sourceName } from "../ai/source-label";

type Detail = { title: string; description: string; name: string };

export function detailsForMessage(
  loaded: { messageId: string; details: Record<number, Detail> } | null,
  messageId: string,
) {
  return loaded?.messageId === messageId ? loaded.details : {};
}

export function SourcePills({
  messageId,
  sources,
  citations,
  pinecone,
  open,
  onToggle,
}: {
  messageId: string;
  sources: Source[];
  citations: Citation[];
  pinecone?: string[] | null;
  open: boolean;
  onToggle: () => void;
}) {
  const items = sourceList(sources, citations);
  const total = items.length + (pinecone ? 1 : 0);
  if (!total) return null;
  const shown = pinecone ? 2 : 3;
  const extra = Math.max(0, items.length - shown);
  return (
    <div className="source-cluster">
      <button
        type="button"
        className="source-cluster-button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="source-stack" aria-hidden="true">
          {pinecone ? <PineconeMark /> : null}
          {items.slice(0, shown).map((item, index) => (
            <PillLogo
              key={item.url}
              src={`/api/messages/${messageId}/source-icon?source=${index}`}
              name={sourceName(item.url, item.title)}
            />
          ))}
        </span>
        {extra > 0 && <span className="source-extra">+{extra}</span>}
        <span>
          {total} {total === 1 ? "Source" : "Sources"}
        </span>
      </button>
    </div>
  );
}

export function SourcesSidebar({
  messageId,
  sources,
  citations,
  pinecone,
  onClose,
}: {
  messageId: string;
  sources: Source[];
  citations: Citation[];
  pinecone?: string[] | null;
  onClose: () => void;
}) {
  const items = sourceList(sources, citations);
  const total = items.length + (pinecone ? 1 : 0);
  const [loaded, setLoaded] = useState<{
    messageId: string;
    details: Record<number, Detail>;
  } | null>(null);
  const details = detailsForMessage(loaded, messageId);
  useEffect(() => {
    const abort = new AbortController();
    const requestedId = messageId;
    void fetch(`/api/messages/${requestedId}/source-pills`, {
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : { pills: [] }))
      .then((data: { pills?: Array<Detail & { index: number }> }) => {
        if (abort.signal.aborted) return;
        const next: Record<number, Detail> = {};
        for (const pill of data.pills ?? []) next[pill.index] = pill;
        setLoaded({ messageId: requestedId, details: next });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [messageId]);
  return (
    <aside className="sources-sidebar" aria-label="Sources">
      <header>
        <strong>Sources{total ? ` (${total})` : ""}</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close sources"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="sources-sidebar-list">
        {pinecone ? (
          <div className="source-card pinecone-source">
            <PineconeMark />
            <span className="source-card-copy">
              <strong>Pinecone</strong>
              {pinecone.map((line) => (
                <em key={line}>{line}</em>
              ))}
            </span>
          </div>
        ) : null}
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
    </aside>
  );
}

function PineconeMark() {
  return (
    // The official logomark, served from this app.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="pinecone-mark"
      src="/pinecone-logomark-black.svg"
      alt=""
      width={24}
      height={24}
    />
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
