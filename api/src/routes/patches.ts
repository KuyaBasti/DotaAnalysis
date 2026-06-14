import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SnapshotStore } from "../snapshotStore.js";

interface PatchParams {
  id: string;
}
interface EntityParams {
  id: string;
  key: string;
}

// Read-only Patch Data routes. The engine and clients read game data from here;
// it never mutates anything. Returns 404 for unknown patch/hero/item.
export function patchRoutes(store: SnapshotStore): FastifyPluginAsync {
  return async function (app: FastifyInstance) {
    app.get("/patches", async () => {
      return { patches: store.listPatches() };
    });

    app.get<{ Params: PatchParams }>(
      "/patches/:id/heroes",
      async (req, reply) => {
        const snap = store.getSnapshot(req.params.id);
        if (!snap) {
          return reply.code(404).send({ error: `unknown patch: ${req.params.id}` });
        }
        return { patch_id: snap.patch_id, heroes: snap.heroes };
      },
    );

    app.get<{ Params: EntityParams }>(
      "/patches/:id/heroes/:key",
      async (req, reply) => {
        const snap = store.getSnapshot(req.params.id);
        if (!snap) {
          return reply.code(404).send({ error: `unknown patch: ${req.params.id}` });
        }
        const hero = snap.heroes.find((h) => h.key === req.params.key);
        if (!hero) {
          return reply.code(404).send({ error: `unknown hero: ${req.params.key}` });
        }
        return hero;
      },
    );

    app.get<{ Params: PatchParams }>(
      "/patches/:id/items",
      async (req, reply) => {
        const snap = store.getSnapshot(req.params.id);
        if (!snap) {
          return reply.code(404).send({ error: `unknown patch: ${req.params.id}` });
        }
        return { patch_id: snap.patch_id, items: snap.items ?? [] };
      },
    );

    app.get<{ Params: EntityParams }>(
      "/patches/:id/items/:key",
      async (req, reply) => {
        const snap = store.getSnapshot(req.params.id);
        if (!snap) {
          return reply.code(404).send({ error: `unknown patch: ${req.params.id}` });
        }
        const item = (snap.items ?? []).find((i) => i.key === req.params.key);
        if (!item) {
          return reply.code(404).send({ error: `unknown item: ${req.params.key}` });
        }
        return item;
      },
    );
  };
}
