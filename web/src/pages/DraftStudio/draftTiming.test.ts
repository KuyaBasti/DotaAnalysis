import { afterEach, describe, expect, it, vi } from "vitest";
import { draftTiming } from "../../api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESPONSE = {
  patch_id: "7.39c",
  minutes: [5, 10, 15, 20, 25, 30],
  radiant: {
    curve_rel: [0, 0.02, 0.04, 0.06, 0.08, 0.1],
    scaling_sum: 0.08,
    measured: 5,
    heroes: [{ hero: "juggernaut", hero_id: 8, scaling: 0.08, n: 50, gated: true }],
  },
  dire: {
    curve_rel: [0, -0.01, -0.02, -0.03, -0.04, null],
    scaling_sum: -0.04,
    measured: 5,
    heroes: [{ hero: "lich", hero_id: 31, scaling: -0.04, n: 40, gated: true }],
  },
  verdict: "radiant",
  margin: 0.12,
};

describe("draftTiming", () => {
  it("POSTs both lineups and returns per-side curves with the verdict", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(RESPONSE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await draftTiming(["juggernaut"], ["lich"], "7.39c");

    expect(result.verdict).toBe("radiant");
    // null-tailed curves survive the round trip — the chart stops the line
    // where the data ends rather than inventing a minute-30 value.
    expect(result.dire.curve_rel[5]).toBeNull();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/analysis/timing");
    expect(JSON.parse(init?.body as string)).toEqual({
      radiant: ["juggernaut"],
      dire: ["lich"],
      patch_id: "7.39c",
    });
  });
});
