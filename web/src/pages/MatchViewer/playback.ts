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

export interface HeroScore {
  hero: string;
  netWorth: number;
}

function heroList(v: unknown): HeroScore[] {
  if (!Array.isArray(v)) return [];
  return v.map((h) => ({
    hero: String((h as Record<string, unknown>).hero ?? ""),
    netWorth: Number((h as Record<string, unknown>).net_worth ?? 0),
  }));
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

// Mirrors the engine's fight resolver (fight_v0._PROB_SCALE): a 10k net-worth
// lead makes the leader a ~73% favorite. Keeping the same constant means the
// strip shows the engine's own odds, not a separate model.
const PROB_SCALE = 10_000;

export interface WinProbPoint {
  t: number;
  radiant: number; // P(radiant wins), 0..1
}

export function winProbSeries(timeline: TimelineEvent[]): WinProbPoint[] {
  return timeline
    .filter((e) => e.type === "economy")
    .map((e) => {
      const lead =
        Number(e.payload.radiant_net_worth ?? 0) -
        Number(e.payload.dire_net_worth ?? 0);
      return { t: e.t, radiant: 1 / (1 + Math.exp(-lead / PROB_SCALE)) };
    });
}

// P(radiant wins) as of the clock: carried from the latest tick that has fired.
export function winProbAt(timeline: TimelineEvent[], clock: number): number {
  let p = 0.5;
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type === "economy") {
      const lead =
        Number(e.payload.radiant_net_worth ?? 0) -
        Number(e.payload.dire_net_worth ?? 0);
      p = 1 / (1 + Math.exp(-lead / PROB_SCALE));
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
      return {
        text: `${cap(winner)} win a teamfight${tail}${bounty}`,
        side: winner as Side,
      };
    }
    case "roshan": {
      const team = String(p.team);
      return { text: `${cap(team)} slay Roshan — Aegis claimed`, side: team as Side };
    }
    case "objective": {
      const team = String(p.team);
      const structure = String(p.structure);
      const what = structure === "ancient" ? "the Ancient" : `a ${structure}`;
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
