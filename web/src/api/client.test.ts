import { afterEach, describe, expect, it, vi } from "vitest";
import { getHeroes, listPatches } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("lists patches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ patches: ["7.39c"] }), { status: 200 }),
      ),
    );
    expect(await listPatches()).toEqual({ patches: ["7.39c"] });
  });

  it("requests the heroes path for a patch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ patch_id: "7.39c", heroes: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getHeroes("7.39c");
    expect(fetchMock).toHaveBeenCalledWith("/patches/7.39c/heroes");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("nope", { status: 500, statusText: "Error" }),
      ),
    );
    await expect(listPatches()).rejects.toThrow();
  });
});

describe("latestPatch", () => {
  it("picks the newest patch label, not the first", async () => {
    const { latestPatch } = await import("./client");
    expect(latestPatch(["7.39c", "7.41d"])).toBe("7.41d");
    expect(latestPatch(["7.41d", "7.39c"])).toBe("7.41d");
    expect(latestPatch([])).toBeUndefined();
  });
});
