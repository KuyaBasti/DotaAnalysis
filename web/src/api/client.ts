import type { HeroesResponse, PatchesResponse } from "../types";

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

export function listPatches(): Promise<PatchesResponse> {
  return getJSON<PatchesResponse>("/patches");
}

export function getHeroes(patchId: string): Promise<HeroesResponse> {
  return getJSON<HeroesResponse>(`/patches/${patchId}/heroes`);
}
