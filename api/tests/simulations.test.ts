import fs from "node:fs";
import os from "node:os";
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

describe("POST /sims (simulate a draft)", () => {
  const RADIANT = ["juggernaut", "crystal_maiden", "axe", "invoker", "lion"];
  const DIRE = ["phantom_assassin", "lich", "tidehunter", "storm_spirit", "witch_doctor"];

  function makeSimApp(tmpDir: string, runner?: (req: unknown) => Promise<void>) {
    return buildApp({
      snapshotDir: fixturesDir,
      simDir: tmpDir,
      modelsDir: fixturesDir,
      simRunner:
        runner ??
        (async (req) => {
          // Fake engine: export a minimal sim file like the CLI would.
          const { patch, seed } = req as { patch: string; seed: number };
          const id = `${patch}-seed${seed}`;
          fs.writeFileSync(
            path.join(tmpDir, `sim.${id}.json`),
            JSON.stringify({ id, summary: { winner: "radiant" }, timeline: [] }),
          );
        }),
    });
  }

  it("simulates a valid draft and returns the new sim id", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-sims-"));
    const app = makeSimApp(tmpDir);
    const res = await app.inject({
      method: "POST",
      url: "/sims",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(id).toMatch(/^7\.41d-seed\d+$/);

    const fetched = await app.inject({ method: "GET", url: `/sims/${id}` });
    expect(fetched.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a short team", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-sims-"));
    const app = makeSimApp(tmpDir);
    const res = await app.inject({
      method: "POST",
      url: "/sims",
      payload: { patch: "7.41d", radiant: RADIANT.slice(0, 4), dire: DIRE },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/radiant must be 5/);
    await app.close();
  });

  it("rejects a hero drafted on both teams", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-sims-"));
    const app = makeSimApp(tmpDir);
    const res = await app.inject({
      method: "POST",
      url: "/sims",
      payload: { patch: "7.41d", radiant: RADIANT, dire: [...DIRE.slice(0, 4), "axe"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/only be drafted once/);
    await app.close();
  });

  it("maps unknown-hero engine failures to 400", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-sims-"));
    const app = makeSimApp(tmpDir, async () => {
      throw new Error("ValueError: unknown hero key: 'nope'");
    });
    const res = await app.inject({
      method: "POST",
      url: "/sims",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("501s when no runner is configured", async () => {
    const app = buildApp({
      snapshotDir: fixturesDir,
      simDir: fixturesDir,
      modelsDir: fixturesDir,
    });
    const res = await app.inject({
      method: "POST",
      url: "/sims",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE },
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });
});
