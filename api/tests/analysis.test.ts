import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function makeApp(modelsDir: string = fixturesDir) {
  return buildApp({
    snapshotDir: fixturesDir,
    simDir: fixturesDir,
    modelsDir,
  });
}

describe("draft analysis api", () => {
  it("evaluates a draft into a win probability", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { radiant: ["juggernaut"], dire: ["lich"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.patch_id).toBe("7.39c");
    // fixture weights: juggernaut +1, lich -1 => radiant clearly favored
    expect(body.radiant_win_probability).toBeGreaterThan(0.5);
    await app.close();
  });

  it("400s on an unknown hero key", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { radiant: ["not_a_hero"], dire: ["lich"] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("503s when no model is loaded", async () => {
    const app = makeApp(path.join(fixturesDir, "no-such-dir"));
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { radiant: ["juggernaut"], dire: ["lich"] },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
