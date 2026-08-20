import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types";
import {
  aegisAt,
  casualtiesAt,
  clamp,
  describeEvent,
  heroNetworthSeries,
  heroTags,
  mapMarkersAt,
  spreadDots,
  eventsUpTo,
  fallenStructuresAt,
  heroScoresAt,
  mmss,
  positionsAt,
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

describe("positionsAt", () => {
  const tl: TimelineEvent[] = [
    { t: 30, type: "positions", payload: {
      radiant_heroes: [{ hero: "Axe", x: 10, y: 80 }],
      dire_heroes: [{ hero: "Lich", x: 90, y: 20 }],
    } },
    { t: 60, type: "positions", payload: {
      radiant_heroes: [{ hero: "Axe", x: 20, y: 60 }],
      dire_heroes: [{ hero: "Lich", x: 80, y: 40 }],
    } },
  ];

  it("interpolates between surrounding snapshots", () => {
    const dots = positionsAt(tl, 45); // halfway between ticks
    const axe = dots.find((d) => d.hero === "Axe");
    expect(axe).toMatchObject({ side: "radiant", x: 15, y: 70 });
    const lich = dots.find((d) => d.hero === "Lich");
    expect(lich).toMatchObject({ side: "dire", x: 85, y: 30 });
  });

  it("holds the last snapshot at the end and handles pre-first-tick", () => {
    expect(positionsAt(tl, 300).find((d) => d.hero === "Axe")).toMatchObject({ x: 20, y: 60 });
    expect(positionsAt(tl, 0).find((d) => d.hero === "Axe")).toMatchObject({ x: 10, y: 80 });
    expect(positionsAt([], 60)).toEqual([]);
  });
});

describe("fallenStructuresAt", () => {
  const tl: TimelineEvent[] = [
    { t: 600, type: "objective", payload: { team: "dire", structure: "tier-1 tower", lane: "top" } },
    { t: 900, type: "objective", payload: { team: "radiant", structure: "barracks", lane: "bot" } },
    { t: 1200, type: "objective", payload: { team: "dire", structure: "ancient" } },
  ];

  it("attributes losses to the victim side, up to the clock", () => {
    const at10 = fallenStructuresAt(tl, 600);
    expect(at10.radiant).toEqual([{ structure: "tier-1 tower", lane: "top" }]);
    expect(at10.dire).toEqual([]);

    const at20 = fallenStructuresAt(tl, 1200);
    expect(at20.radiant).toEqual([
      { structure: "tier-1 tower", lane: "top" },
      { structure: "ancient", lane: null },
    ]);
    expect(at20.dire).toEqual([{ structure: "barracks", lane: "bot" }]);
  });
});

describe("heroScoresAt", () => {
  it("carries per-hero net worths from the latest economy tick", () => {
    const tl: TimelineEvent[] = [
      { t: 30, type: "economy", payload: {
        radiant_net_worth: 300, dire_net_worth: 100,
        radiant_heroes: [{ hero: "Axe", net_worth: 200, level: 2 }, { hero: "Lion", net_worth: 100, level: 1 }],
        dire_heroes: [{ hero: "Lich", net_worth: 100, level: 1 }],
      } },
      { t: 60, type: "economy", payload: {
        radiant_net_worth: 500, dire_net_worth: 400,
        radiant_heroes: [{ hero: "Axe", net_worth: 350, level: 3 }, { hero: "Lion", net_worth: 150, level: 2 }],
        dire_heroes: [{ hero: "Lich", net_worth: 400, level: 6 }],
      } },
    ];
    expect(heroScoresAt(tl, 45).radiant).toMatchObject([
      { hero: "Axe", netWorth: 200, level: 2 },
      { hero: "Lion", netWorth: 100, level: 1 },
    ]);
    expect(heroScoresAt(tl, 90).dire).toMatchObject([
      { hero: "Lich", netWorth: 400, level: 6 },
    ]);
  });

  it("returns empty lists for sims without per-hero data", () => {
    const tl: TimelineEvent[] = [
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
    // Mirrors fight_v0's affine scale: a 10k lead at 30k total gold is a
    // scale of 1,475 + 0.0638 * 30,000 = 3,389 => ~0.950 favorite.
    const big = winProbSeries([
      { t: 30, type: "economy", payload: { radiant_net_worth: 20000, dire_net_worth: 10000 } },
    ]);
    expect(big[0].radiant).toBeCloseTo(0.9503, 3);
  });

  it("carries the latest probability up to the clock", () => {
    expect(winProbAt(TIMELINE, 0)).toBe(0.5); // before any tick: even odds
    expect(winProbAt(TIMELINE, 700)).toBeCloseTo(
      1 / (1 + Math.exp(200 / (1475 + 0.0638 * 600))),
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

  it("announces first blood", () => {
    const beat = describeEvent({
      t: 60,
      type: "fight",
      payload: { winner: "radiant", radiant_deaths: [], dire_deaths: ["Lich"], first_blood: true },
    });
    expect(beat.text).toBe("Radiant win a teamfight — Lich falls 🩸 first blood!");
  });

  it("announces level milestones with ult callout at 6", () => {
    expect(describeEvent({
      t: 360,
      type: "level_up",
      payload: { team: "dire", hero: "Storm Spirit", level: 6 },
    })).toEqual({ text: "Storm Spirit reaches level 6 — ultimate online!", side: "dire" });
    expect(describeEvent({
      t: 1200,
      type: "level_up",
      payload: { team: "radiant", hero: "Juggernaut", level: 12 },
    }).text).toBe("Juggernaut reaches level 12");
  });

  it("announces comeback bounties", () => {
    const beat = describeEvent({
      t: 1,
      type: "fight",
      payload: { winner: "dire", radiant_deaths: ["Axe"], dire_deaths: [], comeback: true },
    });
    expect(beat.text).toBe("Dire win a teamfight — Axe falls 💰 comeback bounty!");
  });

  it("narrates an item completion", () => {
    const beat = describeEvent({
      t: 780,
      type: "item",
      payload: { team: "radiant", hero: "Phantom Assassin", item: "Battle Fury", nth: 1 },
    });
    expect(beat).toEqual({ text: "Phantom Assassin completes Battle Fury", side: "radiant" });
  });

  it("calls out the Ancient and Roshan", () => {
    expect(describeEvent(TIMELINE[6]).text).toBe("Dire destroy the Ancient");
    expect(describeEvent(TIMELINE[5]).text).toBe("Dire slay Roshan — Aegis claimed");
  });

  it("names the lane a structure fell in", () => {
    expect(describeEvent({
      t: 600,
      type: "objective",
      payload: { team: "radiant", structure: "tier-1 tower", lane: "mid" },
    }).text).toBe("Radiant destroy the mid tier-1 tower");
  });
});

// --- hero identity, map placement, and the per-hero economy view ------------

const ROSTER: TimelineEvent[] = [
  {
    t: 30,
    type: "positions",
    payload: {
      radiant_heroes: [
        { hero: "Juggernaut", x: 60, y: 80 },
        { hero: "Crystal Maiden", x: 62, y: 82 },
        { hero: "Lich", x: 20, y: 30 },
      ],
      dire_heroes: [
        { hero: "Lion", x: 40, y: 20 },
        { hero: "Phantom Assassin", x: 42, y: 22 },
      ],
    },
  },
  {
    t: 30,
    type: "economy",
    payload: {
      radiant_net_worth: 3000,
      dire_net_worth: 2000,
      radiant_heroes: [
        { hero: "Juggernaut", net_worth: 1500, level: 5 },
        { hero: "Crystal Maiden", net_worth: 900, level: 4 },
        { hero: "Lich", net_worth: 600, level: 4 },
      ],
      dire_heroes: [
        { hero: "Lion", net_worth: 1100, level: 4 },
        { hero: "Phantom Assassin", net_worth: 900, level: 5 },
      ],
    },
  },
];

describe("heroTags", () => {
  it("gives every hero a unique two-letter tag, resolving collisions", () => {
    const tags = heroTags(ROSTER);
    expect(tags.get("Crystal Maiden")).toBe("CM"); // initials when multi-word
    expect(tags.get("Phantom Assassin")).toBe("PA");
    expect(tags.get("Juggernaut")).toBe("JU");
    // Lich takes LI; Lion must fall through to its next candidate.
    expect(tags.get("Lich")).toBe("LI");
    expect(tags.get("Lion")).not.toBe("LI");
    expect(new Set([...tags.values()]).size).toBe(tags.size);
  });

  it("is deterministic across calls", () => {
    expect([...heroTags(ROSTER)]).toEqual([...heroTags(ROSTER)]);
  });
});

describe("spreadDots", () => {
  // Start well inside the map: dots are clamped to [3, 97], so a fixture that
  // runs off the edge would measure the clamp instead of the declutter.
  const pile = (n: number, gap: number) =>
    Array.from({ length: n }, (_, i) => ({
      hero: `H${i}`,
      side: (i % 2 === 0 ? "radiant" : "dire") as "radiant" | "dire",
      x: 15 + i * gap,
      y: 50,
    }));

  it("never moves a dot further than the 4-unit cap", () => {
    for (const d of spreadDots(pile(10, 0))) {
      expect(Math.hypot(d.px - d.x, d.py - d.y)).toBeLessThanOrEqual(4.0001);
    }
  });

  it("leaves well-separated dots exactly where the engine put them", () => {
    for (const d of spreadDots(pile(4, 20))) {
      expect(d.px).toBeCloseTo(d.x, 6);
      expect(d.py).toBeCloseTo(d.y, 6);
      expect(d.nudged).toBe(false);
    }
  });

  it("moves smoothly as heroes converge — no popping between frames", () => {
    // Ten heroes collapse onto one point over 60 frames. A discontinuous
    // declutter would jump; this asserts every frame is a small step.
    let previous = spreadDots(pile(10, 3));
    for (let frame = 1; frame <= 60; frame++) {
      const gap = 3 * (1 - frame / 60);
      const next = spreadDots(pile(10, gap));
      next.forEach((d, i) => {
        const jump = Math.hypot(d.px - previous[i].px, d.py - previous[i].py);
        expect(jump).toBeLessThan(1.5);
      });
      previous = next;
    }
  });

  it("is rng-free: the same input always places dots identically", () => {
    expect(spreadDots(pile(10, 1))).toEqual(spreadDots(pile(10, 1)));
  });
});

describe("casualtiesAt", () => {
  it("names the fallen from the fight, at the fight's own coordinates", () => {
    const tl: TimelineEvent[] = [
      { t: 300, type: "fight", payload: { winner: "dire", x: 55, y: 45, radiant_deaths: ["Axe"], dire_deaths: [] } },
    ];
    const fallen = casualtiesAt(tl, 310);
    expect(fallen.get("Axe")).toMatchObject({ side: "radiant", x: 55, y: 45, t: 300 });
  });

  it("forgets a death once its window has passed", () => {
    const tl: TimelineEvent[] = [
      { t: 300, type: "fight", payload: { winner: "dire", x: 55, y: 45, radiant_deaths: ["Axe"], dire_deaths: [] } },
    ];
    expect(casualtiesAt(tl, 500).size).toBe(0);
    expect(casualtiesAt(tl, 250).size).toBe(0); // and never shows one early
  });
});

describe("mapMarkersAt", () => {
  it("marks fights where they happened and carries the feed's own wording", () => {
    const markers = mapMarkersAt(TIMELINE, 380);
    const fight = markers.find((m) => m.kind === "fight");
    expect(fight?.label).toBe(describeEvent(TIMELINE[2]).text);
    expect(fight?.deaths).toBe(1);
  });

  it("places an objective marker on the structure that fell", () => {
    const markers = mapMarkersAt(TIMELINE, 500);
    const obj = markers.find((m) => m.kind === "objective");
    // Dire destroyed it, so it is a RADIANT structure that is now down.
    expect(obj).toBeTruthy();
    expect(obj!.side).toBe("dire");
  });

  it("expires markers, and never shows one before it fires", () => {
    expect(mapMarkersAt(TIMELINE, 350).some((m) => m.kind === "fight")).toBe(false);
    expect(mapMarkersAt(TIMELINE, 900).some((m) => m.kind === "fight")).toBe(false);
  });
});

describe("aegisAt", () => {
  it("holds while the aegis lives and lapses afterwards", () => {
    expect(aegisAt(TIMELINE, 700)?.side).toBe("dire");
    expect(aegisAt(TIMELINE, 1000)).toBeNull();
    expect(aegisAt(TIMELINE, 100)).toBeNull();
  });
});

describe("heroNetworthSeries", () => {
  it("gives one series per hero, tagged with side and draft slot", () => {
    const series = heroNetworthSeries(ROSTER);
    expect(series).toHaveLength(5);
    const jug = series.find((s) => s.hero === "Juggernaut");
    expect(jug).toMatchObject({ side: "radiant", slot: 0 });
    expect(jug!.points).toEqual([{ t: 30, netWorth: 1500 }]);
  });
});
