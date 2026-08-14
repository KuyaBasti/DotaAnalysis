// Pure, testable core of the playback viewer. Everything the player shows is a
// function of one number — the clock (game seconds elapsed). No React in here so
// the narration and "state as of time T" logic can be unit-tested directly.

import type { TimelineEvent } from "../../types";

export type Side = "radiant" | "dire" | null;

export interface Beat {
  text: string;
  side: Side;
}

export interface Score {
  radiant: number;
  dire: number;
}

export function clamp(t: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, t));
}

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Every event that has happened at or before the clock (the match "so far").
export function eventsUpTo(
  timeline: TimelineEvent[],
  clock: number,
): TimelineEvent[] {
  return timeline.filter((e) => e.t <= clock);
}

// Net worth as of the clock: carried from the latest economy tick that has fired.
export function scoreAt(timeline: TimelineEvent[], clock: number): Score {
  const score: Score = { radiant: 0, dire: 0 };
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type === "economy") {
      score.radiant = Number(e.payload.radiant_net_worth ?? score.radiant);
      score.dire = Number(e.payload.dire_net_worth ?? score.dire);
    }
  }
  return score;
}

export interface FallenStructure {
  structure: string; // "tier-1 tower" | ... | "barracks" | "ancient"
  lane: string | null; // top | mid | bot; null for the ancient (and old sims)
}

// Structures each side has LOST as of the clock. Objective events name the
// destroying team, so the victim is the other side — that's whose map dot
// goes dark.
export function fallenStructuresAt(
  timeline: TimelineEvent[],
  clock: number,
): { radiant: FallenStructure[]; dire: FallenStructure[] } {
  const fallen = { radiant: [] as FallenStructure[], dire: [] as FallenStructure[] };
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type !== "objective") continue;
    const victim = String(e.payload.team) === "radiant" ? "dire" : "radiant";
    fallen[victim].push({
      structure: String(e.payload.structure),
      lane: e.payload.lane == null ? null : String(e.payload.lane),
    });
  }
  return fallen;
}

export interface HeroDot {
  hero: string;
  side: "radiant" | "dire";
  x: number;
  y: number;
}

function dotList(v: unknown, side: "radiant" | "dire"): HeroDot[] {
  if (!Array.isArray(v)) return [];
  return v.map((h) => ({
    hero: String((h as Record<string, unknown>).hero ?? ""),
    side,
    x: Number((h as Record<string, unknown>).x ?? 50),
    y: Number((h as Record<string, unknown>).y ?? 50),
  }));
}

function dotsOf(e: TimelineEvent): HeroDot[] {
  return [
    ...dotList(e.payload.radiant_heroes, "radiant"),
    ...dotList(e.payload.dire_heroes, "dire"),
  ];
}

// Hero map positions as of the clock, interpolated between the surrounding
// position snapshots so dots glide instead of teleporting each tick. Empty for
// sims exported before the engine emitted positions.
export function positionsAt(timeline: TimelineEvent[], clock: number): HeroDot[] {
  let prev: TimelineEvent | null = null;
  let next: TimelineEvent | null = null;
  for (const e of timeline) {
    if (e.type !== "positions") continue;
    if (e.t <= clock) prev = e;
    else {
      next = e;
      break;
    }
  }
  if (!prev) return next ? dotsOf(next) : [];
  if (!next || next.t === prev.t) return dotsOf(prev);

  const frac = (clock - prev.t) / (next.t - prev.t);
  const target = new Map(dotsOf(next).map((d) => [`${d.side}:${d.hero}`, d]));
  return dotsOf(prev).map((d) => {
    const to = target.get(`${d.side}:${d.hero}`);
    if (!to) return d;
    return {
      ...d,
      x: d.x + (to.x - d.x) * frac,
      y: d.y + (to.y - d.y) * frac,
    };
  });
}

export interface HeroScore {
  hero: string;
  netWorth: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  items: string[];
}

function heroList(v: unknown): HeroScore[] {
  if (!Array.isArray(v)) return [];
  return v.map((h) => {
    const r = h as Record<string, unknown>;
    return {
      hero: String(r.hero ?? ""),
      netWorth: Number(r.net_worth ?? 0),
      level: Number(r.level ?? 1),
      kills: Number(r.kills ?? 0),
      deaths: Number(r.deaths ?? 0),
      assists: Number(r.assists ?? 0),
      items: Array.isArray(r.items) ? (r.items as string[]) : [],
    };
  });
}

// Per-hero net worths as of the clock (from the latest economy tick). Empty
// lists for older sims exported before the engine carried per-hero data.
export function heroScoresAt(
  timeline: TimelineEvent[],
  clock: number,
): { radiant: HeroScore[]; dire: HeroScore[] } {
  let radiant: HeroScore[] = [];
  let dire: HeroScore[] = [];
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type === "economy") {
      radiant = heroList(e.payload.radiant_heroes);
      dire = heroList(e.payload.dire_heroes);
    }
  }
  return { radiant, dire };
}

// Mirrors the engine's fight resolver (fight_v0._PROB_SCALE_BASE /
// _PROB_SCALE_PER_TOTAL): the logistic's scale is affine in total map net
// worth, so a 10k lead on a 30k-gold map is a ~95% favorite while the same
// lead on a 250k map is only ~64%. Keeping the same constants means the strip
// shows the engine's own odds, not a separate model.
const PROB_SCALE_BASE = 1_475;
const PROB_SCALE_PER_TOTAL = 0.0638;

function winProb(radiantNetWorth: number, direNetWorth: number): number {
  const lead = radiantNetWorth - direNetWorth;
  const scale =
    PROB_SCALE_BASE + PROB_SCALE_PER_TOTAL * (radiantNetWorth + direNetWorth);
  return 1 / (1 + Math.exp(-lead / scale));
}

export interface WinProbPoint {
  t: number;
  radiant: number; // P(radiant wins), 0..1
}

export function winProbSeries(timeline: TimelineEvent[]): WinProbPoint[] {
  return timeline
    .filter((e) => e.type === "economy")
    .map((e) => ({
      t: e.t,
      radiant: winProb(
        Number(e.payload.radiant_net_worth ?? 0),
        Number(e.payload.dire_net_worth ?? 0),
      ),
    }));
}

// P(radiant wins) as of the clock: carried from the latest tick that has fired.
export function winProbAt(timeline: TimelineEvent[], clock: number): number {
  let p = 0.5;
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type === "economy") {
      p = winProb(
        Number(e.payload.radiant_net_worth ?? 0),
        Number(e.payload.dire_net_worth ?? 0),
      );
    }
  }
  return p;
}

// Enemy structures each side has destroyed as of the clock.
export function structuresAt(timeline: TimelineEvent[], clock: number): Score {
  const s: Score = { radiant: 0, dire: 0 };
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type !== "objective") continue;
    if (String(e.payload.team) === "radiant") s.radiant += 1;
    else if (String(e.payload.team) === "dire") s.dire += 1;
  }
  return s;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function asNames(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

// Narrate one timeline beat for the live feed, plus which side it favors.
export function describeEvent(e: TimelineEvent): Beat {
  const p = e.payload;
  switch (e.type) {
    case "game_start":
      return { text: "The match begins", side: null };
    case "draft_prior": {
      const prob = Number(p.radiant_win_prob ?? 0.5);
      const side: Side = prob >= 0.5 ? "radiant" : "dire";
      return { text: `The draft favors ${cap(side)}`, side };
    }
    case "fight": {
      const winner = String(p.winner);
      const fallen = [...asNames(p.radiant_deaths), ...asNames(p.dire_deaths)];
      const tail = fallen.length
        ? ` — ${fallen.join(", ")} ${fallen.length > 1 ? "fall" : "falls"}`
        : "";
      const bounty = p.comeback ? " 💰 comeback bounty!" : "";
      const blood = p.first_blood ? " 🩸 first blood!" : "";
      return {
        text: `${cap(winner)} win a teamfight${tail}${blood}${bounty}`,
        side: winner as Side,
      };
    }
    case "level_up": {
      const team = String(p.team);
      const level = Number(p.level);
      const tail = level === 6 ? " — ultimate online!" : "";
      return {
        text: `${String(p.hero)} reaches level ${level}${tail}`,
        side: team as Side,
      };
    }
    case "item": {
      const team = String(p.team);
      return {
        text: `${String(p.hero)} completes ${String(p.item)}`,
        side: team as Side,
      };
    }
    case "roshan": {
      const team = String(p.team);
      return { text: `${cap(team)} slay Roshan — Aegis claimed`, side: team as Side };
    }
    case "objective": {
      const team = String(p.team);
      const structure = String(p.structure);
      const what =
        structure === "ancient"
          ? "the Ancient"
          : p.lane
            ? `the ${String(p.lane)} ${structure}`
            : `a ${structure}`;
      return { text: `${cap(team)} destroy ${what}`, side: team as Side };
    }
    case "game_over":
      return {
        text: `${cap(String(p.winner))} win the game`,
        side: String(p.winner) as Side,
      };
    default:
      return { text: e.type, side: null };
  }
}
