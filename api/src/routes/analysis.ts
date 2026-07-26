import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SnapshotStore } from "../snapshotStore.js";
import { isBracket, type WinProbModel } from "../winProbModel.js";
import type { DraftEvalRequest } from "../types.js";

// Instant draft evaluation: score a draft with the win-probability model, no
// full simulation. Hero keys are resolved to ids via the snapshot.
export function analysisRoutes(
  snapshots: SnapshotStore,
  model: WinProbModel | null,
): FastifyPluginAsync {
  return async function (app: FastifyInstance) {
    app.post<{ Body: DraftEvalRequest }>(
      "/analysis/draft",
      async (req, reply) => {
        if (!model) {
          return reply
            .code(503)
            .send({ error: "win-probability model not loaded" });
        }

        const { radiant = [], dire = [], patch_id, bracket } = req.body ?? {};
        if (bracket !== undefined && !isBracket(bracket)) {
          return reply.code(400).send({ error: `unknown bracket: ${bracket}` });
        }
        const id = patch_id ?? snapshots.listPatches()[0];
        if (!id) return reply.code(404).send({ error: "no patches available" });
        const snap = snapshots.getSnapshot(id);
        if (!snap) {
          return reply.code(404).send({ error: `unknown patch: ${id}` });
        }

        const heroId = new Map(snap.heroes.map((h) => [h.key, h.id]));
        const missing = [...radiant, ...dire].filter((k) => !heroId.has(k));
        if (missing.length > 0) {
          return reply
            .code(400)
            .send({ error: `unknown hero key(s): ${missing.join(", ")}` });
        }

        const scoredBracket = bracket ?? "all";
        const prob = model.predict(
          radiant.map((k) => heroId.get(k)!),
          dire.map((k) => heroId.get(k)!),
          scoredBracket,
        );
        return {
          patch_id: id,
          bracket: scoredBracket,
          radiant_win_probability: Number(prob.toFixed(4)),
        };
      },
    );
  };
}
