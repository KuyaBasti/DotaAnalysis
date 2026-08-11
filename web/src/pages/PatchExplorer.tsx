import { useEffect, useState } from "react";
import { getHeroes, latestPatch, listPatches } from "../api/client";
import type { Hero } from "../types";
import { ATTRIBUTE_COLORS, ATTRIBUTE_LABELS } from "./DraftStudio/attributes";

export function PatchExplorer() {
  const [patch, setPatch] = useState<string | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { patches } = await listPatches();
        const current = latestPatch(patches);
        if (!current) {
          throw new Error("No patches ingested yet — run the ingestion CLI.");
        }
        const data = await getHeroes(current);
        if (!cancelled) {
          setPatch(current);
          setHeroes(data.heroes);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="dim">Loading…</p>;
  if (error) return <div className="note bad">{error}</div>;

  return (
    <>
      <div className="page-head">
        <h2>Patch Explorer</h2>
        <span className="tag">patch {patch}</span>
        <span className="meta num">{heroes.length} heroes</span>
      </div>

      <ul className="patch-grid">
        {heroes.map((h) => (
          <li key={h.key} style={{ borderLeftColor: ATTRIBUTE_COLORS[h.primary_attr] }}>
            <strong>{h.display_name}</strong>
            <div className="dim small">
              {ATTRIBUTE_LABELS[h.primary_attr] ?? h.primary_attr} · {h.attack_type}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
