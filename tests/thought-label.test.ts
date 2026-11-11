import { describe, expect, it } from "vitest";
import {
  thoughtDuration,
  thoughtHeading,
} from "../src/components/thought-label";

describe("thought heading", () => {
  it("uses the recorded elapsed time, then the last step", () => {
    expect(thoughtDuration([{ at: 1200 }, { at: 6400 }], 30800)).toBe(30800);
    expect(thoughtDuration([{ at: 1200 }, { at: 6400 }], null)).toBe(6400);
    expect(thoughtDuration([])).toBeNull();
  });
  it("labels a running turn and a finished one", () => {
    expect(thoughtHeading(true, 1200)).toBe("Working");
    expect(thoughtHeading(false, 30800)).toBe("Thought for 30.8s");
    expect(thoughtHeading(false, null)).toBe("Thought");
  });
});
