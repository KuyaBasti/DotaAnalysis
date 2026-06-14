import fs from "node:fs";
import path from "node:path";
import type { PatchSnapshot } from "./types.js";

// Snapshot files on disk are named snapshot.<patch_id>.json (written by the
// Python ingestion CLI). This captures the patch id from that name.
const FILE_RE = /^snapshot\.(.+)\.json$/;

export interface SnapshotStore {
  /** Patch ids for which a snapshot file exists, sorted ascending. */
  listPatches(): string[];
  /** Load (and cache) a snapshot, or null if no file exists for the id. */
  getSnapshot(patchId: string): PatchSnapshot | null;
}

export function createSnapshotStore(snapshotDir: string): SnapshotStore {
  // Snapshots are immutable, so caching parsed files is safe for the process
  // lifetime.
  const cache = new Map<string, PatchSnapshot>();

  function listPatches(): string[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(snapshotDir);
    } catch {
      return []; // dir missing => no patches ingested yet
    }
    return entries
      .map((name) => FILE_RE.exec(name)?.[1])
      .filter((id): id is string => Boolean(id))
      .sort();
  }

  function getSnapshot(patchId: string): PatchSnapshot | null {
    const cached = cache.get(patchId);
    if (cached) return cached;

    const file = path.join(snapshotDir, `snapshot.${patchId}.json`);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const snapshot = JSON.parse(raw) as PatchSnapshot;
    cache.set(patchId, snapshot);
    return snapshot;
  }

  return { listPatches, getSnapshot };
}
