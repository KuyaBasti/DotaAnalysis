import Fastify, { type FastifyInstance } from "fastify";
import { createSnapshotStore } from "./snapshotStore.js";
import { createSimStore } from "./simStore.js";
import { createWinProbModel } from "./winProbModel.js";
import { patchRoutes } from "./routes/patches.js";
import { simulationRoutes } from "./routes/simulations.js";
import { analysisRoutes } from "./routes/analysis.js";

export interface BuildAppOptions {
  snapshotDir: string;
  simDir: string;
  modelsDir: string;
  logger?: boolean;
}

// Builds the Fastify instance without starting a listener, so tests can drive
// it via app.inject() and main.ts can own the listen() call.
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const snapshots = createSnapshotStore(opts.snapshotDir);
  const sims = createSimStore(opts.simDir);
  const winProb = createWinProbModel(opts.modelsDir);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(patchRoutes(snapshots));
  app.register(simulationRoutes(sims));
  app.register(analysisRoutes(snapshots, winProb));

  return app;
}
