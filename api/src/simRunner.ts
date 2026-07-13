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
