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

  it("names each hero by key, since callers work in keys", async () => {
    const res = await explain({ radiant: ["juggernaut"], dire: ["lich"] });
    const byKey = Object.fromEntries(
      res.json().contributions.map((c: { hero: string; hero_id: number }) => [c.hero, c.hero_id]),
    );
    expect(byKey).toEqual({ juggernaut: 8, lich: 31 });
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

// A models dir that also carries pair weights. Heroes: juggernaut 8 (+1),
// crystal_maiden 5 (0.0), lich 31 (-1). Synergy {5,8} = +0.5; counter
// "8 on radiant vs 31 on dire" = +0.4; alpha 1.0 blended, 0.0 at Ancient+.
const pairsDir = path.join(fixturesDir, "with-pairs");

describe("synergy and counter terms", () => {
  async function post(url: string, payload: Record<string, unknown>, dir = pairsDir) {
    const app = makeApp(dir);
    const res = await app.inject({
      method: "POST",
      url,
      payload: { patch_id: "7.39c", ...payload },
    });
    await app.close();
    return res;
  }

  const prob = async (payload: Record<string, unknown>, dir = pairsDir) =>
    (await post("/analysis/draft", payload, dir)).json().radiant_win_probability;

  it("raises the win probability when a synergy pair is together", async () => {
    const withPairs = await prob({ radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"] });
    const heroOnly = await prob(
      { radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"] },
      fixturesDir, // same heroes, no pair weights on disk
    );
    expect(withPairs).toBeGreaterThan(heroOnly);
  });

  it("stays antisymmetric: swapping sides mirrors the probability", async () => {
    const straight = await prob({ radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"] });
    const swapped = await prob({ radiant: ["lich"], dire: ["juggernaut", "crystal_maiden"] });
    expect(straight + swapped).toBeCloseTo(1.0, 6);
  });

  it("respects counter orientation", async () => {
    // The counter weight says juggernaut-vs-lich favours juggernaut's side, so
    // it must help whichever side he is on.
    const juggRadiant = await prob({ radiant: ["juggernaut"], dire: ["lich"] });
    const juggRadiantNoPairs = await prob(
      { radiant: ["juggernaut"], dire: ["lich"] },
      fixturesDir,
    );
    expect(juggRadiant).toBeGreaterThan(juggRadiantNoPairs);

    const juggDire = await prob({ radiant: ["lich"], dire: ["juggernaut"] });
    const juggDireNoPairs = await prob({ radiant: ["lich"], dire: ["juggernaut"] }, fixturesDir);
    expect(juggDire).toBeLessThan(juggDireNoPairs);
  });

  it("ignores pair terms for a bracket whose alpha is zero", async () => {
    const high = await prob({ radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"], bracket: "high" });
    const noPairs = await prob(
      { radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"] },
      fixturesDir,
    );
    expect(high).toBeCloseTo(noPairs, 6);
  });

  it("makes a hero's swing depend on who they are drafted with", async () => {
    // Crystal Maiden's own weight is 0.0, so without her synergy partner she
    // moves nothing. Alongside Juggernaut she does — which is the entire point
    // of pair terms: a hero's value is no longer independent of the draft.
    const alone = (await post("/analysis/explain", { radiant: ["crystal_maiden"], dire: ["lich"] }))
      .json()
      .contributions.find((c: { hero: string }) => c.hero === "crystal_maiden");
    const withPartner = (
      await post("/analysis/explain", {
        radiant: ["juggernaut", "crystal_maiden"],
        dire: ["lich"],
      })
    )
      .json()
      .contributions.find((c: { hero: string }) => c.hero === "crystal_maiden");

    expect(alone.swing).toBe(0);
    expect(withPartner.swing).toBeGreaterThan(1);
  });

  it("still explains a draft when no pair weights are on disk", async () => {
    const res = await post("/analysis/explain", { radiant: ["juggernaut"], dire: ["lich"] }, fixturesDir);
    expect(res.statusCode).toBe(200);
    expect(res.json().contributions).toHaveLength(2);
  });
});

describe("hybrid calibration", () => {
  // alpha is chosen on AUC, which is blind to probability scale, so the
  // combined score is rescaled back onto the log-odds scale before serving.
  const calDir = path.join(fixturesDir, "with-pairs-calibrated");

  it("applies the per-bracket rescale, pulling the probability toward 0.5", async () => {
    const draft = { radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"], patch_id: "7.39c" };
    const score = async (dir: string) => {
      const app = makeApp(dir);
      const res = await app.inject({ method: "POST", url: "/analysis/draft", payload: draft });
      await app.close();
      return res.json().radiant_win_probability;
    };
    const uncalibrated = await score(path.join(fixturesDir, "with-pairs"));
    const calibrated = await score(calDir);

    // The fixture's rescale is a=0.5, b=0 — halving the log-odds must move a
    // confident prediction back toward a coin flip, without crossing it.
    expect(calibrated).toBeLessThan(uncalibrated);
    expect(calibrated).toBeGreaterThan(0.5);
  });

  it("leaves a bracket with no rescale entry untouched", async () => {
    const payload = {
      radiant: ["juggernaut", "crystal_maiden"],
      dire: ["lich"],
      patch_id: "7.39c",
      bracket: "mid",
    };
    const app = makeApp(calDir);
    const withCal = await app.inject({ method: "POST", url: "/analysis/draft", payload });
    await app.close();

    const plain = makeApp(path.join(fixturesDir, "with-pairs"));
    const without = await plain.inject({ method: "POST", url: "/analysis/draft", payload });
    await plain.close();

    expect(withCal.json().radiant_win_probability).toBeCloseTo(
      without.json().radiant_win_probability,
      6,
    );
  });
});
