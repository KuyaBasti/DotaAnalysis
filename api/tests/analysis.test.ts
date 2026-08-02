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

describe("bracket-aware draft evaluation", () => {
  it("scores with the requested bracket's model", async () => {
    const app = makeApp();
    const body = { radiant: ["juggernaut"], dire: ["lich"], patch_id: "7.39c" };
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { ...body, bracket: "low" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bracket).toBe("low");
    await app.close();
  });

  it("defaults to the blended model", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { radiant: ["juggernaut"], dire: ["lich"], patch_id: "7.39c" },
    });
    expect(res.json().bracket).toBe("all");
    await app.close();
  });

  it("rejects an unknown bracket", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/draft",
      payload: { radiant: ["juggernaut"], dire: ["lich"], patch_id: "7.39c", bracket: "immortal" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// Fixture weights: juggernaut +1.0, crystal_maiden 0.0, lich -1.0, intercept 0.
describe("draft explanation", () => {
  async function explain(payload: Record<string, unknown>) {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/explain",
      payload: { patch_id: "7.39c", ...payload },
    });
    await app.close();
    return res;
  }

  it("returns one contribution per drafted hero", async () => {
    const res = await explain({
      radiant: ["juggernaut", "crystal_maiden"],
      dire: ["lich"],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contributions).toHaveLength(3);
    const ids = body.contributions
      .map((c: { hero_id: number }) => c.hero_id)
      .sort((a: number, b: number) => a - b);
    expect(ids).toEqual([5, 8, 31]);
    const teams = Object.fromEntries(
      body.contributions.map((c: { hero_id: number; team: string }) => [c.hero_id, c.team]),
    );
    expect(teams).toEqual({ 8: "radiant", 5: "radiant", 31: "dire" });
  });

  it("agrees with the win probability the draft route reports", async () => {
    const payload = { radiant: ["juggernaut"], dire: ["lich"], patch_id: "7.39c" };
    const app = makeApp();
    const [draft, explained] = await Promise.all([
      app.inject({ method: "POST", url: "/analysis/draft", payload }),
      app.inject({ method: "POST", url: "/analysis/explain", payload }),
    ]);
    expect(explained.json().radiant_win_probability).toBe(
      draft.json().radiant_win_probability,
    );
    await app.close();
  });

  it("scores an average hero at zero", async () => {
    // crystal_maiden's weight is 0.0 — the model has no opinion about her, so
    // swapping her for an average hero changes nothing.
    const res = await explain({
      radiant: ["juggernaut", "crystal_maiden"],
      dire: ["lich"],
    });
    const cm = res
      .json()
      .contributions.find((c: { hero_id: number }) => c.hero_id === 5);
    expect(cm.swing).toBe(0);
  });

  it("reads a strong hero as positive on whichever side they are drafted", async () => {
    // The swing is from the hero's OWN team's point of view, so juggernaut
    // helps his team the same amount on either side.
    const onRadiant = await explain({ radiant: ["juggernaut"], dire: ["lich"] });
    const onDire = await explain({ radiant: ["lich"], dire: ["juggernaut"] });
    const jugg = (res: { json: () => { contributions: { hero_id: number; swing: number }[] } }) =>
      res.json().contributions.find((c) => c.hero_id === 8)!.swing;
    expect(jugg(onRadiant)).toBeCloseTo(14.97, 1);
    expect(jugg(onDire)).toBeCloseTo(14.97, 1);
  });

  it("marks a hero who hurts their own team as negative", async () => {
    // lich's weight is -1.0, so he is a liability wherever he is drafted.
    const res = await explain({ radiant: ["juggernaut"], dire: ["lich"] });
    const lich = res
      .json()
      .contributions.find((c: { hero_id: number }) => c.hero_id === 31);
    expect(lich.swing).toBeLessThan(0);
  });

  it("sorts by absolute swing, biggest mover first", async () => {
    const res = await explain({
      radiant: ["juggernaut", "crystal_maiden"],
      dire: ["lich"],
    });
    const swings = res
      .json()
      .contributions.map((c: { swing: number }) => Math.abs(c.swing));
    expect(swings).toEqual([...swings].sort((a: number, b: number) => b - a));
  });

  it("rejects an unknown hero and an unknown bracket", async () => {
    expect((await explain({ radiant: ["not_a_hero"], dire: ["lich"] })).statusCode).toBe(400);
    expect(
      (await explain({ radiant: ["juggernaut"], dire: ["lich"], bracket: "immortal" }))
        .statusCode,
    ).toBe(400);
  });

  it("503s when no model is loaded", async () => {
    const app = makeApp(path.join(fixturesDir, "no-such-dir"));
    const res = await app.inject({
      method: "POST",
      url: "/analysis/explain",
      payload: { radiant: ["juggernaut"], dire: ["lich"] },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
