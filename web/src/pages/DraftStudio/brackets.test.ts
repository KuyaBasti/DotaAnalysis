import { describe, expect, it } from "vitest";
import { BRACKET_KEYS, BRACKET_LABELS, bracketLabel } from "./brackets";

describe("brackets", () => {
  it("labels every key the API accepts", () => {
    // Mirrors pipeline/features/brackets.py and api winProbModel BRACKETS.
    expect([...BRACKET_KEYS]).toEqual(["all", "low", "mid", "high"]);
    for (const k of BRACKET_KEYS) {
      expect(BRACKET_LABELS[k]).toBeTruthy();
    }
  });

  it("falls back gracefully for missing or unknown values", () => {
    expect(bracketLabel("low")).toBe("Herald–Crusader");
    expect(bracketLabel(undefined)).toBe("All ranks"); // older aggregates
    expect(bracketLabel("immortal")).toBe("immortal"); // unknown passes through
  });
});
