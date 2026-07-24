import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SimStore } from "../simStore.js";
import type { AggregateRunner, SimRunner } from "../simRunner.js";

interface SimParams {
  id: string;
}

interface SimulateBody {
  patch?: string;
  radiant?: string[];
  dire?: string[];
}

interface AggregateBody extends SimulateBody {
  runs?: number;
}

const TEAM_SIZE = 5;
const MAX_RUNS = 500;

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

function engineErrorStatus(detail: string): number {
  return detail.includes("unknown hero key") ? 400 : 500;
}

// Simulation results: list, fetch, simulate one draft, or Monte-Carlo a draft.
export function simulationRoutes(
  store: SimStore,
  runSim?: SimRunner,
  runAggregate?: AggregateRunner,
): FastifyPluginAsync {
  return async function (app: FastifyInstance) {
    app.get("/sims", async () => {
      return { sims: store.listSims() };
    });

    // Monte Carlo: run the draft N times → win/duration distribution + a
    // representative game (exported so it's watchable via GET /sims/:id).
    app.post<{ Body: AggregateBody }>("/sims/aggregate", async (req, reply) => {
      if (!runAggregate) {
        return reply.code(501).send({ error: "aggregate runner not configured" });
      }
      const body = req.body ?? {};
      const invalid = validateDraft(body);
      if (invalid) {
        return reply.code(400).send({ error: invalid });
      }
      const runs = Math.min(MAX_RUNS, Math.max(1, Math.floor(body.runs ?? 200)));
      const seed = 1 + Math.floor(Math.random() * 9_999_999);
      try {
        const aggregate = await runAggregate({
          patch: body.patch!,
          radiant: body.radiant!,
          dire: body.dire!,
          runs,
          seed,
        });
        return reply.code(200).send(aggregate);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return reply
          .code(engineErrorStatus(detail))
          .send({ error: "aggregation failed", detail: detail.slice(-400) });
      }
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
        return reply
          .code(engineErrorStatus(detail))
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
