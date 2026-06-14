import { useEffect, useState } from "react";
import { getHeroes, listPatches } from "./api/client";
import type { Hero } from "./types";

export function App() {
  const [patch, setPatch] = useState<string | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { patches } = await listPatches();
        const first = patches[0];
        if (!first) {
          throw new Error("No patches ingested yet — run the ingestion CLI.");
        }
        const data = await getHeroes(first);
        if (!cancelled) {
          setPatch(first);
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

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>DraftMaster — Patch Explorer</h1>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {patch && (
        <>
          <p>
            Patch <strong>{patch}</strong> — {heroes.length} heroes
          </p>
          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "0.5rem",
              listStyle: "none",
              padding: 0,
            }}
          >
            {heroes.map((h) => (
              <li
                key={h.key}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "0.5rem 0.75rem",
                }}
              >
                <strong>{h.display_name}</strong>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  {h.primary_attr.toUpperCase()} · {h.attack_type}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
