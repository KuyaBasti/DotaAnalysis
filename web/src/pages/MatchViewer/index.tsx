import { useEffect, useState } from "react";
import { getSim, listSims } from "../../api/client";
import type { SimResult } from "../../types";
import { EventLog } from "./EventLog";
import { NetworthGraph } from "./NetworthGraph";

function mmss(t: number): string {
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function MatchViewer() {
  const [sim, setSim] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sims } = await listSims();
        const first = sims[0];
        if (!first) {
          throw new Error(
            "No simulations yet — run: python -m dm_pipeline.prototype.sim_loop --export",
          );
        }
        const result = await getSim(first);
        if (!cancelled) setSim(result);
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

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "crimson" }}>Error: {error}</p>;
  if (!sim) return null;

  const s = sim.summary;
  return (
    <>
      <p>
        Sim <strong>{sim.id}</strong> —{" "}
        <strong style={{ textTransform: "capitalize" }}>{s.winner}</strong> wins
        at {mmss(s.duration_seconds)}
      </p>
      <p style={{ fontSize: "0.9rem", color: "#555" }}>
        Final net worth —{" "}
        <span style={{ color: "#2e7d32" }}>
          Radiant {Math.round(s.radiant_net_worth).toLocaleString()}
        </span>{" "}
        vs{" "}
        <span style={{ color: "#c62828" }}>
          Dire {Math.round(s.dire_net_worth).toLocaleString()}
        </span>
      </p>

      <h3>Net worth over time</h3>
      <NetworthGraph timeline={sim.timeline} />

      <h3>Event log</h3>
      <EventLog timeline={sim.timeline} />
    </>
  );
}
