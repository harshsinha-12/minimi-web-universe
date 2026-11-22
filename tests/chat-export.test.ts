import { describe, expect, it } from "vitest";
import { chatFileName, formatChat } from "../src/components/chat-export";

describe("chat export", () => {
  it("writes the conversation as labeled text and skips empty turns", () => {
    expect(
      formatChat([
        { role: "user", content: "  Who plays today? " },
        { role: "assistant", content: "" },
        { role: "assistant", content: "India plays New Zealand." },
      ]),
    ).toBe("You\nWho plays today?\n\nminimi\nIndia plays New Zealand.");
  });
  it("appends portable source links for cited answers", () => {
    expect(
      formatChat([
        {
          role: "assistant",
          content: "Price [1]",
          citations: [
            {
              url: "https://example.com/pricing",
              title: "Official pricing",
              start: 6,
              end: 9,
            },
          ],
          sources: [
            { url: "https://example.com/pricing", title: "Official pricing" },
          ],
        },
      ]),
    ).toBe(
      "minimi\nPrice [Official pricing](https://example.com/pricing)\n\nSources\n- [Example: Official pricing](https://example.com/pricing)",
    );
  });
  it("builds a safe file name from the thread title", () => {
    expect(chatFileName("India vs New Zealand?")).toBe(
      "india-vs-new-zealand.md",
    );
    expect(chatFileName("???")).toBe("minimi-chat.md");
  });
});
