// Pure, testable core of the playback viewer. Everything the player shows is a
// function of one number — the clock (game seconds elapsed). No React in here so
// the narration and "state as of time T" logic can be unit-tested directly.

import type { TimelineEvent } from "../../types";
import { ROSHAN_PIT, structurePoint } from "./mapGeometry";

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

// ---------------------------------------------------------------------------
// Hero identity
// ---------------------------------------------------------------------------

// The ten heroes in this match, by display name (the timeline carries display
// names, not the snapshot's hero keys). Read off the first event that lists a
// roster, so it is available before the clock has advanced.
export function rosterOf(timeline: TimelineEvent[]): {
  radiant: string[];
  dire: string[];
} {
  for (const e of timeline) {
    if (e.type !== "positions" && e.type !== "economy") continue;
    const names = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((h) => String((h as Record<string, unknown>).hero ?? "")).filter(Boolean)
        : [];
    const radiant = names(e.payload.radiant_heroes);
    const dire = names(e.payload.dire_heroes);
    if (radiant.length || dire.length) return { radiant, dire };
  }
  return { radiant: [], dire: [] };
}

// Candidate two-letter tags for a hero, best first: the initials of the first
// two words ("Crystal Maiden" -> CM), then the first letter paired with each
// later letter ("Lich" -> LI, LC, LH).
function tagCandidates(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (words.length >= 2 && words[0][0] && words[1][0]) {
    out.push((words[0][0] + words[1][0]).toUpperCase());
  }
  const letters = name.replace(/[^A-Za-z]/g, "");
  const first = (letters[0] ?? "?").toUpperCase();
  for (let i = 1; i < letters.length; i++) {
    out.push((first + letters[i]).toUpperCase());
  }
  return out;
}

// A short tag per hero, unique WITHIN this match's ten — the identity token
// reused on the map dot, the scoreboard row, the net-worth label and the feed.
// Assignment is greedy in roster order, so it is deterministic: the same match
// always yields the same tags, and a Lich/Lion pair resolves to LI/LO.
export function heroTags(timeline: TimelineEvent[]): Map<string, string> {
  const { radiant, dire } = rosterOf(timeline);
  const tags = new Map<string, string>();
  const taken = new Set<string>();
  for (const hero of [...radiant, ...dire]) {
    if (tags.has(hero)) continue;
    const pick =
      tagCandidates(hero).find((c) => !taken.has(c)) ??
      `${(hero[0] ?? "?").toUpperCase()}${taken.size}`;
    taken.add(pick);
    tags.set(hero, pick);
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Map placement
// ---------------------------------------------------------------------------

export interface PlacedDot extends HeroDot {
  px: number; // drawn position, nudged out of a pile so labels stay readable
  py: number;
  nudged: boolean; // drawn far enough from the truth to deserve a leader line
}

const MERGE_RADIUS = 6.0; // closer than this and dots start pushing apart
const MERGE_FLOOR = 1.0; // at or below this the push is at full strength
const MAX_SHIFT = 4.0; // hard cap: a dot never lies by more than 4% of the map
const NUDGE_VISIBLE = 1.5; // beyond this the drawn dot earns a leader line

// Push crowded dots apart so ten labelled tokens stay readable, without ever
// lying by much. The displacement is a CONTINUOUS function of how close the
// nearest neighbour is, so dots ease apart as heroes converge rather than
// popping; the bearing is fixed per slot, so it is deterministic (this is
// presentational state and must stay rng-free, like the engine's own).
export function spreadDots(dots: HeroDot[]): PlacedDot[] {
  return dots.map((d, i) => {
    let nearest = Infinity;
    for (let j = 0; j < dots.length; j++) {
      if (j === i) continue;
      const o = dots[j];
      const dist = Math.hypot(d.x - o.x, d.y - o.y);
      if (dist < nearest) nearest = dist;
    }
    const crowding = clamp(
      (MERGE_RADIUS - nearest) / (MERGE_RADIUS - MERGE_FLOOR),
      0,
      1,
    );
    const shift = crowding * MAX_SHIFT;
    const angle = (i * 2 * Math.PI) / Math.max(dots.length, 1);
    return {
      ...d,
      px: clamp(d.x + Math.cos(angle) * shift, 3, 97),
      py: clamp(d.y + Math.sin(angle) * shift, 3, 97),
      nudged: shift > NUDGE_VISIBLE,
    };
  });
}

// ---------------------------------------------------------------------------
// Events on the map
// ---------------------------------------------------------------------------

export interface Casualty {
  hero: string;
  side: "radiant" | "dire";
  t: number; // when they fell
  x: number; // where they fell (the fight's own coordinates)
  y: number;
}

// Heroes named as casualties in a fight within the last `windowSec` game
// seconds — the exact names the feed narrates, so the log line and the dots
// that hollow out are the same heroes.
export function casualtiesAt(
  timeline: TimelineEvent[],
  clock: number,
  windowSec = 40,
): Map<string, Casualty> {
  const out = new Map<string, Casualty>();
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type !== "fight" || e.t < clock - windowSec) continue;
    const x = Number(e.payload.x ?? 50);
    const y = Number(e.payload.y ?? 50);
    for (const side of ["radiant", "dire"] as const) {
      for (const hero of asNames(e.payload[`${side}_deaths`])) {
        out.set(hero, { hero, side, t: e.t, x, y });
      }
    }
  }
  return out;
}

export interface MapMarker {
  key: string;
  kind: "fight" | "objective" | "roshan";
  x: number;
  y: number;
  side: Side; // whose beat this was
  t: number;
  age: number; // game seconds since it fired
  life: number; // how long it stays on the map
  label: string; // describeEvent's own text, so map and feed can never drift
  deaths: number;
  emphasis: boolean; // first blood / comeback / the Ancient
}

const FIGHT_LIFE = 90;
const OBJECTIVE_LIFE = 150;
const ANCIENT_LIFE = 240;
const ROSHAN_LIFE = 150;

// Markers for the narrated beats, as of the clock. Pure in the clock, so
// scrubbing backwards re-shows them exactly.
export function mapMarkersAt(
  timeline: TimelineEvent[],
  clock: number,
  lifeScale = 1,
): MapMarker[] {
  const out: MapMarker[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i];
    if (e.t > clock) break;
    const beat = describeEvent(e);
    if (e.type === "fight") {
      const life = FIGHT_LIFE * lifeScale;
      if (e.t < clock - life) continue;
      const deaths =
        asNames(e.payload.radiant_deaths).length +
        asNames(e.payload.dire_deaths).length;
      out.push({
        key: `fight:${i}`,
        kind: "fight",
        x: Number(e.payload.x ?? 50),
        y: Number(e.payload.y ?? 50),
        side: String(e.payload.winner) as Side,
        t: e.t,
        age: clock - e.t,
        life,
        label: beat.text,
        deaths,
        emphasis: Boolean(e.payload.first_blood || e.payload.comeback),
      });
    } else if (e.type === "objective") {
      const structure = String(e.payload.structure);
      const life = (structure === "ancient" ? ANCIENT_LIFE : OBJECTIVE_LIFE) * lifeScale;
      if (e.t < clock - life) continue;
      // The destroyer is named; the structure belongs to the other side.
      const destroyer = String(e.payload.team) as "radiant" | "dire";
      const victim = destroyer === "radiant" ? "dire" : "radiant";
      const at = structurePoint(
        victim,
        structure,
        e.payload.lane == null ? null : String(e.payload.lane),
      );
      if (!at) continue;
      out.push({
        key: `obj:${i}`,
        kind: "objective",
        x: at[0],
        y: at[1],
        side: destroyer,
        t: e.t,
        age: clock - e.t,
        life,
        label: beat.text,
        deaths: 0,
        emphasis: structure === "ancient",
      });
    } else if (e.type === "roshan") {
      const life = ROSHAN_LIFE * lifeScale;
      if (e.t < clock - life) continue;
      out.push({
        key: `rosh:${i}`,
        kind: "roshan",
        x: ROSHAN_PIT[0],
        y: ROSHAN_PIT[1],
        side: String(e.payload.team) as Side,
        t: e.t,
        age: clock - e.t,
        life,
        label: beat.text,
        deaths: 0,
        emphasis: true,
      });
    }
  }
  return out;
}

// Who holds the Aegis, if anyone. Possession is STATE, not a beat: it outlives
// any marker, so the map shows it as a standing pill until it expires.
const AEGIS_SECONDS = 300;

export function aegisAt(
  timeline: TimelineEvent[],
  clock: number,
): { side: "radiant" | "dire"; expiresAt: number } | null {
  let held: { side: "radiant" | "dire"; expiresAt: number } | null = null;
  for (const e of timeline) {
    if (e.t > clock) break;
    if (e.type !== "roshan") continue;
    held = {
      side: String(e.payload.team) as "radiant" | "dire",
      expiresAt: e.t + AEGIS_SECONDS,
    };
  }
  return held && held.expiresAt > clock ? held : null;
}

// ---------------------------------------------------------------------------
// Per-hero net worth
// ---------------------------------------------------------------------------

export interface HeroSeries {
  hero: string;
  side: "radiant" | "dire";
  slot: number; // draft order within the side; drives the dash pattern
  points: { t: number; netWorth: number }[];
}

// One net-worth series per hero across the whole match — the Dota-replay view
// the team totals can't give you (who on a losing side is actually farming).
export function heroNetworthSeries(timeline: TimelineEvent[]): HeroSeries[] {
  const byKey = new Map<string, HeroSeries>();
  for (const e of timeline) {
    if (e.type !== "economy") continue;
    for (const side of ["radiant", "dire"] as const) {
      const heroes = heroList(e.payload[`${side}_heroes`]);
      heroes.forEach((h, slot) => {
        const key = `${side}:${h.hero}`;
        let series = byKey.get(key);
        if (!series) {
          series = { hero: h.hero, side, slot, points: [] };
          byKey.set(key, series);
        }
        series.points.push({ t: e.t, netWorth: h.netWorth });
      });
    }
  }
  return [...byKey.values()];
}
