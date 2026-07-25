import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SimRequest {
  patch: string;
  radiant: string[];
  dire: string[];
  seed: number;
}

/** Runs one simulation and exports it to the sim dir (throws on failure). */
export type SimRunner = (req: SimRequest) => Promise<void>;

export interface AggregateRequest {
  patch: string;
  radiant: string[];
  dire: string[];
  runs: number;
  seed: number;
}

/** Runs N sims and returns the aggregate JSON (throws on failure). */
export type AggregateRunner = (req: AggregateRequest) => Promise<unknown>;

// Spawns the Python prototype engine (pipeline/) to simulate a custom draft.
// The engine stays in Python — the API is just a thin trigger around its CLI,
// the same seam the future Rust engine will slot into.
export function createPythonSimRunner(repoRoot: string): SimRunner {
  const python =
    process.env.DM_PYTHON ?? path.join(repoRoot, ".venv", "bin", "python");
  return async ({ patch, radiant, dire, seed }) => {
    await execFileAsync(
      python,
      [
        "-m",
        "dm_pipeline.prototype.sim_loop",
        "--seed",
        String(seed),
        "--export",
        "--patch",
        patch,
        "--radiant",
        radiant.join(","),
        "--dire",
        dire.join(","),
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, PYTHONPATH: path.join(repoRoot, "pipeline") },
        timeout: 60_000,
      },
    );
  };
}

// Spawns the Monte-Carlo CLI once for N sims; the aggregate JSON is on stdout,
// and the representative game is exported to the sim dir (watchable).
export function createPythonAggregateRunner(repoRoot: string): AggregateRunner {
  const python =
    process.env.DM_PYTHON ?? path.join(repoRoot, ".venv", "bin", "python");
  return async ({ patch, radiant, dire, runs, seed }) => {
    const { stdout } = await execFileAsync(
      python,
      [
        "-m",
        "dm_pipeline.prototype.montecarlo",
        "--patch",
        patch,
        "--radiant",
        radiant.join(","),
        "--dire",
        dire.join(","),
        "--runs",
        String(runs),
        "--seed",
        String(seed),
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, PYTHONPATH: path.join(repoRoot, "pipeline") },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  };
}
