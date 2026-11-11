import { describe, expect, it } from "vitest";
import { annotateMarkdown } from "../src/ai/evidence";
import { pillSources, sourceList, sourceName } from "../src/ai/source-label";
import { extractPreview } from "../src/server/link-previews";
import type { Citation } from "../src/types";

describe("source pills", () => {
  it("names known publications and subdomains by their brand", () => {
    expect(sourceName("https://www.linkedin.com/posts/job")).toBe("LinkedIn");
    expect(sourceName("https://timesofindia.indiatimes.com/city")).toBe(
      "Times of India",
    );
    expect(sourceName("https://rizevault.razorpay.com/story")).toBe("Razorpay");
    expect(sourceName("https://www.reddit.com/r/typescript")).toBe("Reddit");
    expect(sourceName("https://www.projectminimi.com/")).toBe("minimi");
  });
  it("keeps cited pages first and does not repeat a URL", () => {
    const sources = [
      { url: "https://example.com/extra", title: "Extra" },
      { url: "https://www.linkedin.com/posts/job", title: "Job" },
    ];
    const citations = [
      {
        url: "https://www.linkedin.com/posts/job",
        title: "Job",
        start: 0,
        end: 1,
      },
      {
        url: "https://www.projectminimi.com/",
        title: "minimi",
        start: 2,
        end: 3,
      },
    ];
    expect(pillSources(sources, citations).map((item) => item.url)).toEqual([
      "https://www.linkedin.com/posts/job",
      "https://www.projectminimi.com/",
      "https://example.com/extra",
    ]);
  });
  it("caps the source sheet at twelve unique pages", () => {
    const sources = Array.from({ length: 14 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Page ${index}`,
    }));
    expect(sourceList(sources)).toHaveLength(12);
  });
  it("does not rewrite code when nothing is cited", () => {
    const text =
      "Use refresh().\n\n```python\n    def f():\n        return 1  \n```\n";
    expect(annotateMarkdown(text, [])).toBe(text);
  });
  it("cleans only the citation gap and leaves other whitespace alone", () => {
    const text = "Call refresh().\n    nested\nSee [1] now\nhello  \nworld";
    const start = text.indexOf("[1]");
    expect(
      annotateMarkdown(text, [
        {
          url: "https://example.com",
          title: "Example",
          start,
          end: start + 3,
        },
      ]),
    ).toBe("Call refresh().\n    nested\nSee now\nhello  \nworld");
  });
  it("removes the raw citation text from the answer", () => {
    const text =
      "The team is in Indiranagar.\n(linkedin.com(https://www.linkedin.com/posts/job))";
    const start = text.indexOf("(linkedin");
    const citations: Citation[] = [
      {
        url: "https://www.linkedin.com/posts/job",
        title: "Job",
        start,
        end: text.length,
      },
    ];
    expect(annotateMarkdown(text, citations)).toBe(
      "The team is in Indiranagar.",
    );
  });
  it("prefers a raster site icon over an SVG icon", () => {
    const preview = extractPreview(
      '<link rel="icon" href="/logo.svg"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"><title>LinkedIn</title>',
      "https://www.linkedin.com/posts/job",
    );
    expect(preview.icon).toBe("https://www.linkedin.com/apple.png");
  });
});
