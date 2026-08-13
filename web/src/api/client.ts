import type {
  DraftEvalResponse,
  DraftExplanation,
  DraftSuggestions,
  DraftTiming,
  HeroesResponse,
  PatchesResponse,
  SimAggregate,
  SimResult,
  SimsResponse,
} from "../types";

// Empty base => same-origin (dev server proxies to the API). Override with
// VITE_API_BASE when pointing at a deployed API.
const BASE = import.meta.env.VITE_API_BASE ?? "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

export function listPatches(): Promise<PatchesResponse> {
  return getJSON<PatchesResponse>("/patches");
}

// The newest patch on disk. Dota patch labels sort correctly as strings
// (7.39c < 7.41d), so the latest is the lexicographic max.
export function latestPatch(patches: string[]): string | undefined {
  return [...patches].sort().at(-1);
}

export function getHeroes(patchId: string): Promise<HeroesResponse> {
  return getJSON<HeroesResponse>(`/patches/${patchId}/heroes`);
}

export function listSims(): Promise<SimsResponse> {
  return getJSON<SimsResponse>("/sims");
}

export function getSim(id: string): Promise<SimResult> {
  return getJSON<SimResult>(`/sims/${id}`);
}

export function simulateDraft(
  radiant: string[],
  dire: string[],
  patchId: string,
): Promise<{ id: string }> {
  return postJSON<{ id: string }>("/sims", {
    patch: patchId,
    radiant,
    dire,
  });
}

export function aggregateDraft(
  radiant: string[],
  dire: string[],
  patchId: string,
  runs = 200,
  bracket?: string,
): Promise<SimAggregate> {
  return postJSON<SimAggregate>("/sims/aggregate", {
    patch: patchId,
    radiant,
    dire,
    runs,
    bracket,
  });
}

export function evaluateDraft(
  radiant: string[],
  dire: string[],
  patchId?: string,
  bracket?: string,
): Promise<DraftEvalResponse> {
  return postJSON<DraftEvalResponse>("/analysis/draft", {
    radiant,
    dire,
    patch_id: patchId,
    bracket,
  });
}

/** Ranked candidates for the next pick (Coach Lab). */
export function suggestPicks(
  radiant: string[],
  dire: string[],
  side: "radiant" | "dire",
  rankBy: "swing" | "fit",
  patchId?: string,
  bracket?: string,
): Promise<DraftSuggestions> {
  return postJSON<DraftSuggestions>("/analysis/suggest", {
    radiant,
    dire,
    side,
    rank_by: rankBy,
    patch_id: patchId,
    bracket,
  });
}

/** When each lineup's gold engine peaks (Coach Lab). Farm timing, not win timing. */
export function draftTiming(
  radiant: string[],
  dire: string[],
  patchId?: string,
): Promise<DraftTiming> {
  return postJSON<DraftTiming>("/analysis/timing", {
    radiant,
    dire,
    patch_id: patchId,
  });
}

/** The same win probability, broken down by hero (Coach Lab). */
export function explainDraft(
  radiant: string[],
  dire: string[],
  patchId?: string,
  bracket?: string,
): Promise<DraftExplanation> {
  return postJSON<DraftExplanation>("/analysis/explain", {
    radiant,
    dire,
    patch_id: patchId,
    bracket,
  });
}
