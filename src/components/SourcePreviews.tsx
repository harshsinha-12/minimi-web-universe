"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

type Preview = {
  url: string;
  title: string;
  description: string;
  domain: string;
  image: string | null;
};
export function SourcePreviews({ messageId }: { messageId: string }) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/messages/${messageId}/previews`, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : { previews: [] }))
      .then((data) => setPreviews(data.previews))
      .catch(() => {});
    return () => abort.abort();
  }, [messageId]);
  if (!previews.length) return null;
  return (
    <div className="source-previews" aria-label="Source link previews">
      {previews.map((preview) => (
        <a
          className="source-preview"
          key={preview.url}
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {preview.image && <PreviewImage src={preview.image} />}
          <div>
            <span className="preview-domain">
              {preview.domain}
              <ArrowUpRight size={12} />
            </span>
            <strong>{preview.title}</strong>
            {preview.description && <p>{preview.description}</p>}
          </div>
        </a>
      ))}
    </div>
  );
}
function PreviewImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  // An owned, SSRF-checked proxy endpoint; next/image's remote optimizer is unnecessary.
  return failed ? null : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
