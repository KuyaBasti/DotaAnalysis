import type {
  DraftEvalResponse,
  HeroesResponse,
  PatchesResponse,
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

export function getHeroes(patchId: string): Promise<HeroesResponse> {
  return getJSON<HeroesResponse>(`/patches/${patchId}/heroes`);
}

export function listSims(): Promise<SimsResponse> {
  return getJSON<SimsResponse>("/sims");
}

export function getSim(id: string): Promise<SimResult> {
  return getJSON<SimResult>(`/sims/${id}`);
}

export function evaluateDraft(
  radiant: string[],
  dire: string[],
  patchId?: string,
): Promise<DraftEvalResponse> {
  return postJSON<DraftEvalResponse>("/analysis/draft", {
    radiant,
    dire,
    patch_id: patchId,
  });
}
