import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SimStore } from "../simStore.js";

interface SimParams {
  id: string;
}

// Read-only access to exported simulation results. The web Match Viewer renders
// these. Returns 404 for an unknown sim id.
export function simulationRoutes(store: SimStore): FastifyPluginAsync {
  return async function (app: FastifyInstance) {
    app.get("/sims", async () => {
      return { sims: store.listSims() };
    });

    app.get<{ Params: SimParams }>("/sims/:id", async (req, reply) => {
      const sim = store.getSim(req.params.id);
      if (!sim) {
        return reply.code(404).send({ error: `unknown sim: ${req.params.id}` });
      }
      return sim;
    });
  };
}
