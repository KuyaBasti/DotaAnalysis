import { afterEach, describe, expect, it, vi } from "vitest";
import { getSim, listSims } from "../../api/client";
import { networthSeries } from "./NetworthGraph";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sim client", () => {
  it("lists sims", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ sims: ["7.39c-seed42"] }), { status: 200 }),
      ),
    );
    expect(await listSims()).toEqual({ sims: ["7.39c-seed42"] });
  });

  it("requests the sim path by id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getSim("x");
    expect(fetchMock).toHaveBeenCalledWith("/sims/x");
  });
});

describe("networthSeries", () => {
  it("extracts the per-tick net worth from economy events only", () => {
    const series = networthSeries([
      { t: 0, type: "game_start", payload: {} },
      { t: 30, type: "economy", payload: { radiant_net_worth: 100, dire_net_worth: 120 } },
      { t: 60, type: "fight", payload: { winner: "dire" } },
      { t: 60, type: "economy", payload: { radiant_net_worth: 200, dire_net_worth: 260 } },
    ]);
    expect(series).toEqual([
      { t: 30, radiant: 100, dire: 120 },
      { t: 60, radiant: 200, dire: 260 },
    ]);
  });
});
