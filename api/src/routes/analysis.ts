import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import type { SnapshotStore } from "../snapshotStore.js";
import { isBracket, type Bracket, type WinProbModel } from "../winProbModel.js";
import type { DraftEvalRequest } from "../types.js";

interface SuggestBody extends DraftEvalRequest {
  /** Which side is picking. Default radiant. */
  side?: string;
  /** 'swing' (strongest overall) or 'fit' (best with this draft). */
  rank_by?: string;
  limit?: number;
}

const TEAM_SIZE = 5;
const DEFAULT_SUGGESTIONS = 8;
const MAX_SUGGESTIONS = 40;

interface ResolvedDraft {
  patchId: string;
  bracket: Bracket;
  radiantIds: number[];
  direIds: number[];
  /** Reverse of the key→id lookup, for naming heroes in responses. */
  keyOf: Map<number, string>;
  /** Every hero in the patch — the candidate pool for suggestions. */
  rosterIds: number[];
}

// Shared by both analysis routes: validate the bracket, resolve the patch, and
// map hero keys to the numeric ids the model is trained on. On failure it sends
// the error and returns the reply, so the caller just hands that back.
function resolveDraft(
  snapshots: SnapshotStore,
  body: DraftEvalRequest | undefined,
  reply: FastifyReply,
): ResolvedDraft | FastifyReply {
  const { radiant = [], dire = [], patch_id, bracket } = body ?? {};
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

  return {
    patchId: id,
    bracket: bracket ?? "all",
    radiantIds: radiant.map((k) => heroId.get(k)!),
    direIds: dire.map((k) => heroId.get(k)!),
    keyOf: new Map(snap.heroes.map((h) => [h.id, h.key])),
    rosterIds: snap.heroes.map((h) => h.id),
  };
}

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
        const draft = resolveDraft(snapshots, req.body, reply);
        if (!("patchId" in draft)) return draft;

        const prob = model.predict(
          draft.radiantIds,
          draft.direIds,
          draft.bracket,
        );
        return {
          patch_id: draft.patchId,
          bracket: draft.bracket,
          radiant_win_probability: Number(prob.toFixed(4)),
        };
      },
    );

    // Coach Lab: the same number, broken down by hero — who is carrying this
    // draft and who is dragging it, at the rank the player actually plays.
    app.post<{ Body: DraftEvalRequest }>(
      "/analysis/explain",
      async (req, reply) => {
        if (!model) {
          return reply
            .code(503)
            .send({ error: "win-probability model not loaded" });
        }
        const draft = resolveDraft(snapshots, req.body, reply);
        if (!("patchId" in draft)) return draft;

        const { radiant_win_probability, contributions } = model.explain(
          draft.radiantIds,
          draft.direIds,
          draft.bracket,
        );
        return {
          patch_id: draft.patchId,
          bracket: draft.bracket,
          radiant_win_probability,
          // Callers work in hero keys everywhere else; carry the id too, since
          // that's the id space the model is trained on.
          contributions: contributions.map((c) => ({
            hero: draft.keyOf.get(c.hero_id) ?? String(c.hero_id),
            ...c,
          })),
        };
      },
    );

    // Coach Lab: what should this side pick next? Every undrafted hero is
    // scored against the draft so far, so the ranking responds to what is
    // already on the board rather than being a fixed tier list.
    app.post<{ Body: SuggestBody }>(
      "/analysis/suggest",
      async (req, reply) => {
        if (!model) {
          return reply
            .code(503)
            .send({ error: "win-probability model not loaded" });
        }
        const side = req.body?.side ?? "radiant";
        if (side !== "radiant" && side !== "dire") {
          return reply.code(400).send({ error: `unknown side: ${side}` });
        }
        const draft = resolveDraft(snapshots, req.body, reply);
        if (!("patchId" in draft)) return draft;

        if ((side === "radiant" ? draft.radiantIds : draft.direIds).length >= TEAM_SIZE) {
          return reply
            .code(400)
            .send({ error: `${side} already has ${TEAM_SIZE} heroes` });
        }

        const limit = Math.min(
          MAX_SUGGESTIONS,
          Math.max(1, Math.floor(req.body?.limit ?? DEFAULT_SUGGESTIONS)),
        );
        const rankBy = req.body?.rank_by ?? "swing";
        if (rankBy !== "swing" && rankBy !== "fit") {
          return reply.code(400).send({ error: `unknown rank_by: ${rankBy}` });
        }
        const ranked = model.suggest(
          draft.radiantIds,
          draft.direIds,
          side,
          draft.rosterIds,
          draft.bracket,
          rankBy,
        );
        return {
          patch_id: draft.patchId,
          bracket: draft.bracket,
          side,
          rank_by: rankBy,
          suggestions: ranked.slice(0, limit).map((s) => ({
            hero: draft.keyOf.get(s.hero_id) ?? String(s.hero_id),
            ...s,
          })),
        };
      },
    );
  };
}
