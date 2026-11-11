import { describe, expect, it } from "vitest";
import { isNewConversationShortcut } from "../src/components/shortcuts";

describe("new conversation shortcut", () => {
  it("accepts Command-K and Control-K", () => {
    expect(
      isNewConversationShortcut({ metaKey: true, ctrlKey: false, key: "k" }),
    ).toBe(true);
    expect(
      isNewConversationShortcut({ metaKey: false, ctrlKey: true, key: "K" }),
    ).toBe(true);
    expect(
      isNewConversationShortcut({
        metaKey: true,
        ctrlKey: false,
        key: "Dead",
        code: "KeyK",
      }),
    ).toBe(true);
  });
  it("ignores a plain K and Alt combinations", () => {
    expect(
      isNewConversationShortcut({ metaKey: false, ctrlKey: false, key: "k" }),
    ).toBe(false);
    expect(
      isNewConversationShortcut({
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        key: "k",
      }),
    ).toBe(false);
  });
});
