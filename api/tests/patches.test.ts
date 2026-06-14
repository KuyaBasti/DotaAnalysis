import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function makeApp() {
  return buildApp({ snapshotDir: fixturesDir });
}

describe("patch data api", () => {
  it("lists available patches from the snapshot dir", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/patches" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ patches: ["7.39c"] });
    await app.close();
  });

  it("returns a single hero (the Stage-2 exit criterion)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/patches/7.39c/heroes/juggernaut",
    });
    expect(res.statusCode).toBe(200);
    const hero = res.json();
    expect(hero.display_name).toBe("Juggernaut");
    expect(hero.primary_attr).toBe("agi");
    await app.close();
  });

  it("returns a single item", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/patches/7.39c/items/black_king_bar",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cost).toBe(4050);
    await app.close();
  });

  it("404s for an unknown hero", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/patches/7.39c/heroes/nope",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("404s for an unknown patch", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/patches/9.99/heroes" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("health check responds ok", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
