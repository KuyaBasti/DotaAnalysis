import path from "node:path";
import { fileURLToPath } from "node:url";

// config.ts compiles to either api/src (tsx/vitest) or api/dist (built); both
// are one level under api/, so the repo root is two levels up in both cases.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export interface Config {
  host: string;
  port: number;
  repoRoot: string;
  snapshotDir: string;
  simDir: string;
  modelsDir: string;
}

export function loadConfig(): Config {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
    repoRoot,
    snapshotDir:
      process.env.DM_SNAPSHOT_DIR ?? path.join(repoRoot, "data", "snapshots"),
    simDir: process.env.DM_SIM_DIR ?? path.join(repoRoot, "data", "sims"),
    modelsDir: process.env.DM_MODELS_DIR ?? path.join(repoRoot, "data", "models"),
  };
}
