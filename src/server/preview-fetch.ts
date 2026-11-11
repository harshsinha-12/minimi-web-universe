import { get } from "node:https";
import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

export function isPublicAddress(value: string) {
  try {
    return ipaddr.parse(value).range() === "unicast";
  } catch {
    return false;
  }
}
export function previewURL(raw: string, base?: string) {
  const url = new URL(raw, base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Unsupported preview URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  )
    throw new Error("Private preview URL");
  url.hash = "";
  return url;
}
export function canonicalPageUrl(raw: string) {
  try {
    return previewURL(raw).href;
  } catch {
    return null;
  }
}
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (
      !addresses.length ||
      addresses.some((record) => !isPublicAddress(record.address))
    )
      return callback(new Error("Private destination rejected"), "", 4);
    // Pin this connection to the checked DNS answer; no validation/fetch DNS race.
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};
export type PreviewResource = {
  body: Buffer;
  type: string;
  url: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
};
function header(
  response: { headers: Record<string, string | string[] | undefined> },
  name: string,
) {
  const value = response.headers[name];
  return typeof value === "string" ? value : null;
}
export function fetchPreviewResource(
  raw: string,
  kind: "html" | "image",
  signal: AbortSignal,
  redirects = 0,
  validators?: { etag?: string | null; lastModified?: string | null },
): Promise<PreviewResource> {
  const url = previewURL(raw);
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        lookup: publicLookup,
        agent: false,
        signal,
        headers: {
          "User-Agent": "minimi-link-preview/1.0",
          Accept:
            kind === "html"
              ? "text/html"
              : "image/avif,image/webp,image/png,image/jpeg,image/gif",
          "Accept-Encoding": "identity",
          ...(redirects === 0 && validators?.etag
            ? { "If-None-Match": validators.etag }
            : {}),
          ...(redirects === 0 && validators?.lastModified
            ? { "If-Modified-Since": validators.lastModified }
            : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location &&
          redirects < 2
        ) {
          response.destroy();
          try {
            resolve(
              fetchPreviewResource(
                previewURL(response.headers.location, url.href).href,
                kind,
                signal,
                redirects + 1,
              ),
            );
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (status === 304 && redirects === 0 && validators) {
          response.destroy();
          resolve({
            body: Buffer.alloc(0),
            type: "",
            url: url.href,
            status: 304,
            etag: header(response, "etag") ?? validators.etag ?? null,
            lastModified:
              header(response, "last-modified") ??
              validators.lastModified ??
              null,
          });
          return;
        }
        const type = String(response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const allowed =
          kind === "html"
            ? ["text/html", "application/xhtml+xml"]
            : [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif",
                "image/avif",
              ];
        if (status !== 200 || !allowed.includes(type)) {
          response.destroy();
          reject(new Error("Preview unavailable"));
          return;
        }
        const chunks: Buffer[] = [];
        const limit = kind === "html" ? 512000 : 2000000;
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            request.destroy(new Error("Preview exceeds size budget"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            type,
            url: url.href,
            status,
            etag: header(response, "etag"),
            lastModified: header(response, "last-modified"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(3000, () =>
      request.destroy(new Error("Preview timed out")),
    );
    request.on("error", reject);
  });
}
