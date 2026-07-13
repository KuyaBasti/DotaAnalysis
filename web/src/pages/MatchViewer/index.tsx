import { useEffect, useState } from "react";
import { getSim, listSims } from "../../api/client";
import type { SimResult } from "../../types";
import { EventLog } from "./EventLog";
import { HeroScoreboard } from "./HeroScoreboard";
import { Minimap } from "./Minimap";
import { NetworthGraph } from "./NetworthGraph";
import { PlaybackControls } from "./PlaybackControls";
import { WinProbGraph } from "./WinProbGraph";
import {
  fallenStructuresAt,
  heroScoresAt,
  mmss,
  positionsAt,
  scoreAt,
  structuresAt,
  winProbAt,
} from "./playback";
import { usePlayback } from "./usePlayback";

export function MatchViewer() {
  const [simIds, setSimIds] = useState<string[]>([]);
  const [simId, setSimId] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sims } = await listSims();
        if (!sims.length) {
          throw new Error(
            "No simulations yet — run: python -m dm_pipeline.prototype.sim_loop --export",
          );
        }
        if (!cancelled) {
          setSimIds(sims);
          setSimId(sims[0]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (simId === null) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await getSim(simId);
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
  }, [simId]);

  if (error) return <p style={{ color: "crimson" }}>Error: {error}</p>;

  return (
    <>
      {simIds.length > 1 && (
        <label style={{ display: "block", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          Watch match{" "}
          <select
            aria-label="Pick a simulated match"
            value={simId ?? ""}
            onChange={(e) => setSimId(e.target.value)}
            style={{ padding: "0.3rem", borderRadius: 6, marginLeft: "0.25rem" }}
          >
            {simIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : sim ? (
        // Keyed by id so the player (and its clock) resets when a new sim loads.
        <MatchPlayer key={sim.id} sim={sim} />
      ) : null}
    </>
  );
}

function MatchPlayer({ sim }: { sim: SimResult }) {
  const duration = sim.summary.duration_seconds;
  const pb = usePlayback(duration);

  const score = scoreAt(sim.timeline, pb.clock);
  const structures = structuresAt(sim.timeline, pb.clock);
  const total = Math.max(score.radiant + score.dire, 1);
  const radiantPct = (score.radiant / total) * 100;
  const winProb = winProbAt(sim.timeline, pb.clock);
  const favored = winProb >= 0.5 ? "Radiant" : "Dire";
  const favoredPct = Math.round((winProb >= 0.5 ? winProb : 1 - winProb) * 100);
  const heroScores = heroScoresAt(sim.timeline, pb.clock);
  const fallen = fallenStructuresAt(sim.timeline, pb.clock);
  const heroDots = positionsAt(sim.timeline, pb.clock);

  return (
    <>
      <p style={{ margin: "0 0 0.5rem", color: "#555", fontSize: "0.9rem" }}>
        Sim <strong>{sim.id}</strong>
        {pb.atEnd && (
          <>
            {" — "}
            <strong style={{ textTransform: "capitalize", color: COLOR(sim.summary.winner) }}>
              {sim.summary.winner}
            </strong>{" "}
            wins
          </>
        )}
      </p>

      {/* Live scoreboard: net worth + structures, as of the clock. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <ScoreSide name="Radiant" side="radiant" nw={score.radiant} razed={structures.radiant} align="left" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.4rem", fontWeight: 600 }}>
            {mmss(pb.clock)}
          </div>
          <div style={{ fontSize: "0.75rem", color: COLOR(favored.toLowerCase()) }}>
            {favored} {favoredPct}%
          </div>
        </div>
        <ScoreSide name="Dire" side="dire" nw={score.dire} razed={structures.dire} align="right" />
      </div>
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          margin: "0.4rem 0 0.25rem",
          background: "#c62828",
        }}
        aria-label="Net worth share"
      >
        <div style={{ width: `${radiantPct}%`, background: "#2e7d32" }} />
      </div>

      <PlaybackControls pb={pb} duration={duration} />

      <div
        style={{
          display: "flex",
          gap: "1.25rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <HeroScoreboard radiant={heroScores.radiant} dire={heroScores.dire} />
        </div>
        <Minimap
          radiantLost={fallen.radiant}
          direLost={fallen.dire}
          heroes={heroDots}
        />
      </div>

      <NetworthGraph timeline={sim.timeline} upTo={pb.clock} />

      <h3>Win probability</h3>
      <WinProbGraph timeline={sim.timeline} upTo={pb.clock} />

      <h3>Match feed</h3>
      <EventLog timeline={sim.timeline} upTo={pb.clock} />
    </>
  );
}

function COLOR(side: string): string {
  return side === "radiant" ? "#2e7d32" : side === "dire" ? "#c62828" : "#444";
}

function ScoreSide({
  name,
  side,
  nw,
  razed,
  align,
}: {
  name: string;
  side: "radiant" | "dire";
  nw: number;
  razed: number;
  align: "left" | "right";
}) {
  return (
    <div style={{ textAlign: align, minWidth: 150 }}>
      <div style={{ color: COLOR(side), fontWeight: 500 }}>{name}</div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.1rem" }}>
        {Math.round(nw).toLocaleString()}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#888" }}>
        {razed} {razed === 1 ? "structure" : "structures"} razed
      </div>
    </div>
  );
}
