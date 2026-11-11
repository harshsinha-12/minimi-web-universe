import { createHash } from "node:crypto";
import { Parser } from "htmlparser2";

const skipped = new Set(["script", "style", "noscript", "template"]);

export function visibleText(html: string) {
  let text = "";
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (skipped.has(name)) skip++;
      },
      ontext(value) {
        if (skip === 0) text += ` ${value}`;
      },
      onclosetag(name) {
        if (skipped.has(name) && skip > 0) skip--;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  return text.replace(/\s+/g, " ").trim();
}

export function pageFingerprint(html: string) {
  const text = visibleText(html).slice(0, 50_000);
  return {
    text,
    excerpt: text.slice(0, 700),
    hash: createHash("sha256").update(text).digest("hex"),
  };
}
