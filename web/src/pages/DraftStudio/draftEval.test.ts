import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateDraft } from "../../api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evaluateDraft", () => {
  it("POSTs the draft and returns the win probability", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ patch_id: "7.39c", radiant_win_probability: 0.58 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateDraft(["juggernaut"], ["lich"], "7.39c");

    expect(result.radiant_win_probability).toBe(0.58);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/analysis/draft");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      radiant: ["juggernaut"],
      dire: ["lich"],
      patch_id: "7.39c",
    });
  });
});
