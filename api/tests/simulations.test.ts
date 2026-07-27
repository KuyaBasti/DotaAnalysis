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

describe("POST /sims/aggregate (Monte Carlo)", () => {
  const RADIANT = ["juggernaut", "crystal_maiden", "axe", "invoker", "lion"];
  const DIRE = ["phantom_assassin", "lich", "tidehunter", "storm_spirit", "witch_doctor"];

  function makeApp(runner?: (req: unknown) => Promise<unknown>) {
    return buildApp({
      snapshotDir: fixturesDir,
      simDir: fixturesDir,
      modelsDir: fixturesDir,
      aggregateRunner:
        runner ??
        (async (req) => {
          const { patch, runs } = req as { patch: string; runs: number };
          return {
            scenario: { patch_id: patch, radiant: RADIANT, dire: DIRE },
            runs,
            radiant_win_rate: 0.62,
            duration_seconds: { mean: 2000, p25: 1710, median: 1950, p75: 2280 },
            duration_histogram: [{ minute: 30, count: runs }],
            representative_sim_id: `${patch}-seed123`,
          };
        }),
    });
  }

  it("returns an aggregate for a valid draft", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE, runs: 100 },
    });
    expect(res.statusCode).toBe(200);
    const agg = res.json();
    expect(agg.runs).toBe(100);
    expect(agg.radiant_win_rate).toBeCloseTo(0.62);
    expect(agg.representative_sim_id).toBe("7.41d-seed123");
    await app.close();
  });

  it("clamps runs to the max", async () => {
    let seenRuns = 0;
    const app = makeApp(async (req) => {
      seenRuns = (req as { runs: number }).runs;
      return { scenario: {}, runs: seenRuns, radiant_win_rate: 0.5, representative_sim_id: "x" };
    });
    await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE, runs: 99999 },
    });
    expect(seenRuns).toBe(500); // MAX_RUNS
    await app.close();
  });

  it("rejects an invalid draft", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT.slice(0, 4), dire: DIRE },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("501s when no aggregate runner is configured", async () => {
    const app = buildApp({ snapshotDir: fixturesDir, simDir: fixturesDir, modelsDir: fixturesDir });
    const res = await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE },
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });
});

describe("POST /sims/aggregate — bracket", () => {
  const RADIANT = ["juggernaut", "crystal_maiden", "axe", "invoker", "lion"];
  const DIRE = ["phantom_assassin", "lich", "tidehunter", "storm_spirit", "witch_doctor"];

  function appCapturing(seen: { bracket?: string }) {
    return buildApp({
      snapshotDir: fixturesDir,
      simDir: fixturesDir,
      modelsDir: fixturesDir,
      aggregateRunner: async (req) => {
        seen.bracket = (req as { bracket: string }).bracket;
        return { scenario: {}, runs: 1, radiant_win_rate: 0.5, representative_sim_id: "x" };
      },
    });
  }

  it("forwards the requested bracket to the runner", async () => {
    const seen: { bracket?: string } = {};
    const app = appCapturing(seen);
    await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE, bracket: "low" },
    });
    expect(seen.bracket).toBe("low"); // regression: the web sent it, the API dropped it
    await app.close();
  });

  it("defaults to the blended model when no bracket is given", async () => {
    const seen: { bracket?: string } = {};
    const app = appCapturing(seen);
    await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE },
    });
    expect(seen.bracket).toBe("all");
    await app.close();
  });

  it("rejects an unknown bracket", async () => {
    const seen: { bracket?: string } = {};
    const app = appCapturing(seen);
    const res = await app.inject({
      method: "POST",
      url: "/sims/aggregate",
      payload: { patch: "7.41d", radiant: RADIANT, dire: DIRE, bracket: "immortal" },
    });
    expect(res.statusCode).toBe(400);
    expect(seen.bracket).toBeUndefined(); // never reached the engine
    await app.close();
  });
});
