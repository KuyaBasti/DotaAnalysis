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

// A sim id like "7.41d-seed8144464" reads as "Game 8144464 — patch 7.41d".
function simLabel(id: string): string {
  const m = /^(.+)-seed(\d+)$/.exec(id);
  return m ? `Game ${m[2]} — patch ${m[1]}` : id;
}

export function MatchViewer({
  initialSimId = null,
}: {
  initialSimId?: string | null;
}) {
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
          // Prefer the sim we were sent here to watch (a just-drafted match).
          setSimId(
            initialSimId && sims.includes(initialSimId) ? initialSimId : sims[0],
          );
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
      <div className="page-head">
        <h2>Match Viewer</h2>
        <span className="meta">a generated game, played minute by minute</span>
        <span className="spacer" />
        {simIds.length > 1 && (
          <label className="row small dim">
            Watch
            <select
              aria-label="Pick a simulated match"
              value={simId ?? ""}
              onChange={(e) => setSimId(e.target.value)}
            >
              {simIds.map((id) => (
                <option key={id} value={id}>
                  {simLabel(id)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading ? (
        <p className="dim">Loading…</p>
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
  // Before any gold is earned the share is genuinely even — dividing by a
  // clamped total would paint the whole bar Dire at 0:00.
  const total = score.radiant + score.dire;
  const radiantPct = total > 0 ? (score.radiant / total) * 100 : 50;
  const winProb = winProbAt(sim.timeline, pb.clock);
  const favored = winProb >= 0.5 ? "Radiant" : "Dire";
  const favoredPct = Math.round((winProb >= 0.5 ? winProb : 1 - winProb) * 100);
  const heroScores = heroScoresAt(sim.timeline, pb.clock);
  const fallen = fallenStructuresAt(sim.timeline, pb.clock);
  const heroDots = positionsAt(sim.timeline, pb.clock);

  return (
    <>
      <p className="muted small" style={{ margin: "0 0 10px" }}>
        Sim <strong className="num">{sim.id}</strong>
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

      {/* Live scoreboard + map: the state of the game as of the clock. */}
      <div className="viewer-top">
        <div className="card">
          <div className="scoreline">
            <ScoreSide name="Radiant" side="radiant" nw={score.radiant} razed={structures.radiant} align="left" />
            <div style={{ textAlign: "center" }}>
              <div className="num clock">{mmss(pb.clock)}</div>
              <div className="small" style={{ color: COLOR(favored.toLowerCase()) }}>
                {favored} {favoredPct}%
              </div>
            </div>
            <ScoreSide name="Dire" side="dire" nw={score.dire} razed={structures.dire} align="right" />
          </div>

          <div className="nwshare" aria-label="Net worth share">
            <div style={{ width: `${radiantPct}%` }} />
          </div>

          <PlaybackControls pb={pb} duration={duration} />
          <HeroScoreboard radiant={heroScores.radiant} dire={heroScores.dire} />
        </div>

        <div className="card">
          <h3>Map</h3>
          <Minimap
            radiantLost={fallen.radiant}
            direLost={fallen.dire}
            heroes={heroDots}
          />
        </div>
      </div>

      <div className="viewer-cols" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Net worth</h3>
          <NetworthGraph timeline={sim.timeline} upTo={pb.clock} />
        </div>
        <div className="card">
          <h3>Win probability</h3>
          <WinProbGraph timeline={sim.timeline} upTo={pb.clock} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Match feed</h3>
        <EventLog timeline={sim.timeline} upTo={pb.clock} />
      </div>
    </>
  );
}

function COLOR(side: string): string {
  return side === "radiant" ? "var(--radiant)" : side === "dire" ? "var(--dire)" : "var(--ink-2)";
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
    <div style={{ textAlign: align, minWidth: 140 }}>
      <div className="small" style={{ color: COLOR(side), fontWeight: 600 }}>{name}</div>
      <div className="num nw">{Math.round(nw).toLocaleString()}</div>
      <div className="dim" style={{ fontSize: "11.5px" }}>
        {razed} {razed === 1 ? "structure" : "structures"} razed
      </div>
    </div>
  );
}
