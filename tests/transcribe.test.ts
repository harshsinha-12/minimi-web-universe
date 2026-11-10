import { afterEach, describe, expect, it } from "vitest";
import {
  allowTranscription,
  inspectAudio,
  resetTranscriptionLimits,
} from "../src/server/transcribe";

afterEach(() => resetTranscriptionLimits());

describe("dictation upload checks", () => {
  it("accepts a normal WebM clip and ignores codec parameters", () => {
    expect(
      inspectAudio({ type: "audio/webm;codecs=opus", size: 20_000 }),
    ).toEqual({ mime: "audio/webm", ext: "webm" });
  });
  it.each(["audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"])(
    "accepts %s",
    (type) => {
      expect(inspectAudio({ type, size: 2_000 }).mime).toBe(type);
    },
  );
  it("rejects empty, huge, and non-audio uploads", () => {
    expect(() => inspectAudio({ type: "audio/webm", size: 10 })).toThrow(
      /too short/,
    );
    expect(() => inspectAudio({ type: "audio/webm", size: 8_000_001 })).toThrow(
      /too long/,
    );
    expect(() => inspectAudio({ type: "text/html", size: 2_000 })).toThrow(
      /WebM/,
    );
  });
  it("allows eight clips in ten minutes and then waits", () => {
    const start = Date.parse("2026-11-11T00:00:00Z");
    for (let i = 0; i < 8; i++)
      expect(allowTranscription("owner", start + i)).toBe(true);
    expect(allowTranscription("owner", start + 9)).toBe(false);
    expect(allowTranscription("other", start + 9)).toBe(true);
    expect(allowTranscription("owner", start + 10 * 60 * 1000 + 20)).toBe(true);
  });
});
