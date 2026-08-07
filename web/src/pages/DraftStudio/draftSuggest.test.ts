import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestPicks } from "../../api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESPONSE = {
  patch_id: "7.39c",
  bracket: "low",
  side: "radiant",
  rank_by: "fit",
  suggestions: [
    { hero: "pudge", hero_id: 14, swing: 7.9, fit: 3.0 },
    { hero: "lich", hero_id: 31, swing: 6.0, fit: 1.6 },
  ],
};

describe("suggestPicks", () => {
  it("POSTs the draft, side and ordering, and returns ranked candidates", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(RESPONSE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await suggestPicks(
      ["juggernaut"],
      ["sniper"],
      "radiant",
      "fit",
      "7.39c",
      "low",
    );

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].hero).toBe("pudge");
    // fit is carried separately from the total so the panel can show both.
    expect(result.suggestions[0].fit).toBe(3.0);
    expect(result.rank_by).toBe("fit");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/analysis/suggest");
    expect(JSON.parse(init?.body as string)).toEqual({
      radiant: ["juggernaut"],
      dire: ["sniper"],
      side: "radiant",
      rank_by: "fit",
      patch_id: "7.39c",
      bracket: "low",
    });
  });
});
