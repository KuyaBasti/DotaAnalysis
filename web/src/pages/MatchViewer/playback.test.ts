import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types";
import {
  clamp,
  describeEvent,
  eventsUpTo,
  heroScoresAt,
  mmss,
  scoreAt,
  structuresAt,
  winProbAt,
  winProbSeries,
} from "./playback";

const TIMELINE: TimelineEvent[] = [
  { t: 0, type: "game_start", payload: {} },
  { t: 30, type: "economy", payload: { radiant_net_worth: 100, dire_net_worth: 120 } },
  { t: 360, type: "fight", payload: { winner: "dire", radiant_deaths: ["Invoker"], dire_deaths: [] } },
  { t: 480, type: "objective", payload: { team: "dire", structure: "tier-1 tower" } },
  { t: 600, type: "economy", payload: { radiant_net_worth: 200, dire_net_worth: 400 } },
  { t: 600, type: "roshan", payload: { team: "dire", reward: 2500 } },
  { t: 900, type: "objective", payload: { team: "dire", structure: "ancient" } },
];

describe("clamp", () => {
  it("bounds a value to [lo, hi]", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("mmss", () => {
  it("formats seconds as m:ss and floors fractional time", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(90.7)).toBe("1:30");
    expect(mmss(-3)).toBe("0:00");
  });
});

describe("eventsUpTo", () => {
  it("includes only events at or before the clock", () => {
    expect(eventsUpTo(TIMELINE, 480).map((e) => e.type)).toEqual([
      "game_start",
      "economy",
      "fight",
      "objective",
    ]);
  });
});

describe("scoreAt", () => {
  it("carries the latest economy tick that has fired", () => {
    expect(scoreAt(TIMELINE, 0)).toEqual({ radiant: 0, dire: 0 });
    expect(scoreAt(TIMELINE, 100)).toEqual({ radiant: 100, dire: 120 });
    expect(scoreAt(TIMELINE, 700)).toEqual({ radiant: 200, dire: 400 });
  });
});

describe("structuresAt", () => {
  it("counts each side's destroyed structures up to the clock", () => {
    expect(structuresAt(TIMELINE, 480)).toEqual({ radiant: 0, dire: 1 });
    expect(structuresAt(TIMELINE, 900)).toEqual({ radiant: 0, dire: 2 });
  });
});

describe("heroScoresAt", () => {
  it("carries per-hero net worths from the latest economy tick", () => {
    const tl = [
      { t: 30, type: "economy", payload: {
        radiant_net_worth: 300, dire_net_worth: 100,
        radiant_heroes: [{ hero: "Axe", net_worth: 200 }, { hero: "Lion", net_worth: 100 }],
        dire_heroes: [{ hero: "Lich", net_worth: 100 }],
      } },
      { t: 60, type: "economy", payload: {
        radiant_net_worth: 500, dire_net_worth: 400,
        radiant_heroes: [{ hero: "Axe", net_worth: 350 }, { hero: "Lion", net_worth: 150 }],
        dire_heroes: [{ hero: "Lich", net_worth: 400 }],
      } },
    ];
    expect(heroScoresAt(tl, 45).radiant).toEqual([
      { hero: "Axe", netWorth: 200 },
      { hero: "Lion", netWorth: 100 },
    ]);
    expect(heroScoresAt(tl, 90).dire).toEqual([{ hero: "Lich", netWorth: 400 }]);
  });

  it("returns empty lists for sims without per-hero data", () => {
    const tl = [
      { t: 30, type: "economy", payload: { radiant_net_worth: 100, dire_net_worth: 120 } },
    ];
    expect(heroScoresAt(tl, 60)).toEqual({ radiant: [], dire: [] });
  });
});

describe("winProbSeries / winProbAt", () => {
  it("maps net-worth leads through the engine's logistic", () => {
    const series = winProbSeries(TIMELINE);
    expect(series).toHaveLength(2); // one point per economy tick
    expect(series[0].radiant).toBeLessThan(0.5); // dire ahead 100 vs 120
    // Mirrors fight_v0: a 10k lead => ~0.731 favorite
    const big = winProbSeries([
      { t: 30, type: "economy", payload: { radiant_net_worth: 20000, dire_net_worth: 10000 } },
    ]);
    expect(big[0].radiant).toBeCloseTo(0.731, 3);
  });

  it("carries the latest probability up to the clock", () => {
    expect(winProbAt(TIMELINE, 0)).toBe(0.5); // before any tick: even odds
    expect(winProbAt(TIMELINE, 700)).toBeCloseTo(
      1 / (1 + Math.exp(200 / 10000)),
      6,
    ); // dire up 400-200 at t=600
  });
});

describe("describeEvent", () => {
  it("narrates a teamfight with named casualties", () => {
    expect(describeEvent(TIMELINE[2])).toEqual({
      text: "Dire win a teamfight — Invoker falls",
      side: "dire",
    });
  });

  it("pluralizes multiple casualties", () => {
    const beat = describeEvent({
      t: 1,
      type: "fight",
      payload: { winner: "radiant", radiant_deaths: [], dire_deaths: ["Lich", "Storm Spirit"] },
    });
    expect(beat.text).toBe("Radiant win a teamfight — Lich, Storm Spirit fall");
    expect(beat.side).toBe("radiant");
  });

  it("announces comeback bounties", () => {
    const beat = describeEvent({
      t: 1,
      type: "fight",
      payload: { winner: "dire", radiant_deaths: ["Axe"], dire_deaths: [], comeback: true },
    });
    expect(beat.text).toBe("Dire win a teamfight — Axe falls 💰 comeback bounty!");
  });

  it("calls out the Ancient and Roshan", () => {
    expect(describeEvent(TIMELINE[6]).text).toBe("Dire destroy the Ancient");
    expect(describeEvent(TIMELINE[5]).text).toBe("Dire slay Roshan — Aegis claimed");
  });
});
