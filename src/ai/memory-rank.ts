import type { Memory } from "../types";

export type ProfileMode = "personal" | "vanilla";

const profileKinds = new Set([
  "preference",
  "constraint",
  "project",
  "decision",
  "plan",
]);
const stop = new Set(
  "a an the of and or to for in on is are was were be been being what how does do did with about from this that it its who when where why which into over after before than then can may just your you we our their not should use".split(
    " ",
  ),
);

function terms(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length > 3 && !stop.has(term)),
  );
}

export function rankMemories(memories: Memory[], question: string, limit = 5) {
  const asked = terms(question);
  return memories
    .flatMap((memory) => {
      const words = terms(`${memory.kind} ${memory.text}`);
      let overlap = 0;
      for (const word of asked) if (words.has(word)) overlap++;
      const profile = profileKinds.has(memory.kind);
      if (!profile && overlap === 0) return [];
      const score =
        (memory.userEdited ? 100 : 0) +
        overlap * 10 +
        (profile ? 2 : 0) +
        (memory.kind === "preference" || memory.kind === "constraint" ? 1 : 0);
      return [{ memory, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memory.createdAt.localeCompare(a.memory.createdAt),
    )
    .slice(0, limit)
    .map(({ memory }) => memory);
}

export function profileGuidance(profile: ProfileMode) {
  if (profile === "vanilla")
    return "Profile mode: vanilla. No background preferences are loaded. Use this conversation and its attachments. Use earlier chats only when the user asked about them.";
  return "Profile mode: personal. The notes below are the few preferences, constraints, projects, and decisions ranked for this question. A userEdited note is a direct correction and outranks an older note. Ignore a note that is missing, expired, or forgotten.";
}
