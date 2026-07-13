import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SimStore } from "../simStore.js";
import type { SimRunner } from "../simRunner.js";

interface SimParams {
  id: string;
}

interface SimulateBody {
  patch?: string;
  radiant?: string[];
  dire?: string[];
}

const TEAM_SIZE = 5;

function validateDraft(body: SimulateBody): string | null {
  if (!body.patch || typeof body.patch !== "string") {
    return "patch is required";
  }
  for (const side of ["radiant", "dire"] as const) {
    const team = body[side];
    if (
      !Array.isArray(team) ||
      team.length !== TEAM_SIZE ||
      team.some((k) => typeof k !== "string" || !k.trim())
    ) {
      return `${side} must be ${TEAM_SIZE} hero keys`;
    }
  }
  const all = [...body.radiant!, ...body.dire!];
  if (new Set(all).size !== all.length) {
    return "a hero can only be drafted once";
  }
  return null;
}

// Simulation results: list, fetch, and — when a runner is configured — create.
// POST runs the Python engine for a custom draft and returns the new sim id.
export function simulationRoutes(
  store: SimStore,
  runSim?: SimRunner,
): FastifyPluginAsync {
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

    app.post<{ Body: SimulateBody }>("/sims", async (req, reply) => {
      if (!runSim) {
        return reply
          .code(501)
          .send({ error: "simulation runner not configured" });
      }
      const body = req.body ?? {};
      const invalid = validateDraft(body);
      if (invalid) {
        return reply.code(400).send({ error: invalid });
      }

      const seed = 1 + Math.floor(Math.random() * 9_999_999);
      try {
        await runSim({
          patch: body.patch!,
          radiant: body.radiant!,
          dire: body.dire!,
          seed,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const status = detail.includes("unknown hero key") ? 400 : 500;
        return reply
          .code(status)
          .send({ error: "simulation failed", detail: detail.slice(-400) });
      }

      const id = `${body.patch}-seed${seed}`;
      if (!store.getSim(id)) {
        return reply
          .code(500)
          .send({ error: `sim ran but ${id} was not exported` });
      }
      return reply.code(201).send({ id });
    });
  };
}
