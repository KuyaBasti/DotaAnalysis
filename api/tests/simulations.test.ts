import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function makeApp() {
  return buildApp({
    snapshotDir: fixturesDir,
    simDir: fixturesDir,
    modelsDir: fixturesDir,
  });
}

describe("simulations api", () => {
  it("lists exported sims", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/sims" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sims).toContain("7.39c-seed42");
    await app.close();
  });

  it("returns a sim result by id", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/sims/7.39c-seed42" });
    expect(res.statusCode).toBe(200);
    const sim = res.json();
    expect(sim.summary.winner).toBe("dire");
    expect(sim.timeline[0].type).toBe("game_start");
    await app.close();
  });

  it("404s for an unknown sim", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/sims/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
