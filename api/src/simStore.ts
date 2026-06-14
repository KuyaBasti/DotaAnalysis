import fs from "node:fs";
import path from "node:path";
import type { SimResult } from "./types.js";

// Sim files on disk are named sim.<id>.json (written by the prototype sim's
// --export). This captures the id from that name.
const FILE_RE = /^sim\.(.+)\.json$/;

export interface SimStore {
  /** Ids of sims that have been exported, sorted ascending. */
  listSims(): string[];
  /** Load (and cache) a sim result, or null if no file exists for the id. */
  getSim(id: string): SimResult | null;
}

export function createSimStore(simDir: string): SimStore {
  const cache = new Map<string, SimResult>();

  function listSims(): string[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(simDir);
    } catch {
      return []; // dir missing => nothing simulated yet
    }
    return entries
      .map((name) => FILE_RE.exec(name)?.[1])
      .filter((id): id is string => Boolean(id))
      .sort();
  }

  function getSim(id: string): SimResult | null {
    const cached = cache.get(id);
    if (cached) return cached;

    const file = path.join(simDir, `sim.${id}.json`);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const sim = JSON.parse(raw) as SimResult;
    cache.set(id, sim);
    return sim;
  }

  return { listSims, getSim };
}
