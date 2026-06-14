import Fastify, { type FastifyInstance } from "fastify";
import { createSnapshotStore } from "./snapshotStore.js";
import { patchRoutes } from "./routes/patches.js";

export interface BuildAppOptions {
  snapshotDir: string;
  logger?: boolean;
}

// Builds the Fastify instance without starting a listener, so tests can drive
// it via app.inject() and main.ts can own the listen() call.
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const store = createSnapshotStore(opts.snapshotDir);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(patchRoutes(store));

  return app;
}
