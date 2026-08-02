import { afterEach, describe, expect, it, vi } from "vitest";
import { explainDraft } from "../../api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESPONSE = {
  patch_id: "7.39c",
  bracket: "low",
  radiant_win_probability: 0.62,
  contributions: [
    { hero: "sniper", hero_id: 35, team: "radiant", swing: 6.2 },
    { hero: "lich", hero_id: 31, team: "dire", swing: -1.4 },
  ],
};

describe("explainDraft", () => {
  it("POSTs the draft with its bracket and returns the breakdown", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(RESPONSE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await explainDraft(["sniper"], ["lich"], "7.39c", "low");

    expect(result.contributions).toHaveLength(2);
    expect(result.contributions[0].hero).toBe("sniper");
    expect(result.contributions[0].swing).toBe(6.2);
    // The bracket comes back so the panel can name the rank it analyzed.
    expect(result.bracket).toBe("low");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/analysis/explain");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      radiant: ["sniper"],
      dire: ["lich"],
      patch_id: "7.39c",
      bracket: "low",
    });
  });
});
