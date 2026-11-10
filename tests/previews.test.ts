import { describe, expect, it } from "vitest";
import { extractPreview, previewSources } from "../src/server/link-previews";
import { isPublicAddress, previewURL } from "../src/server/preview-fetch";
import type { Message } from "../src/types";

describe("source preview boundaries", () => {
  it("extracts decoded Open Graph metadata and resolves relative images", () => {
    expect(
      extractPreview(
        '<title>Fallback</title><meta content="A &amp; B" property="og:title"><meta property="og:image" content="/cover.png"><meta name="description" content="Useful page">',
        "https://example.com/article",
      ),
    ).toMatchObject({
      title: "A & B",
      description: "Useful page",
      image: "https://example.com/cover.png",
    });
  });
  it("falls back to title and rejects unsafe image destinations", () => {
    expect(
      extractPreview(
        '<title>A page</title><meta property="og:image" content="http://127.0.0.1/private">',
        "https://example.com",
      ),
    ).toMatchObject({ title: "A page", image: null });
  });
  it.each([
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://169.254.169.254/latest/",
    "https://10.1.2.3/",
    "https://localhost/",
    "https://test.local/",
    "http://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:8080/",
  ])("rejects private or unsupported URLs: %s", (url) => {
    expect(() => previewURL(url)).toThrow();
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
  ])("rejects non-public DNS destinations: %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it("accepts public destinations and limits sources to three known URLs", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    const message = {
      citations: [{ url: "https://example.com/1" }],
      sources: [
        { url: "https://example.com/1" },
        { url: "https://example.com/2" },
        { url: "https://example.com/3" },
        { url: "https://example.com/4" },
      ],
    } as Message;
    expect(previewSources(message).map((s) => s.url)).toEqual([
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
    ]);
  });
});
