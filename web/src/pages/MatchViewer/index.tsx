import { useEffect, useMemo, useState } from "react";
import { getSim, listSims } from "../../api/client";
import type { SimResult } from "../../types";
import { EventLog } from "./EventLog";
import { HeroScoreboard } from "./HeroScoreboard";
import { Minimap } from "./Minimap";
import { NetworthGraph } from "./NetworthGraph";
import { PlaybackControls } from "./PlaybackControls";
import { WinProbGraph } from "./WinProbGraph";
import {
  aegisAt,
  casualtiesAt,
  fallenStructuresAt,
  heroScoresAt,
  heroTags,
  mapMarkersAt,
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
      ) : (
        <div className="card empty">
          <p style={{ margin: 0 }}>No simulated matches yet.</p>
          <p className="small" style={{ maxWidth: 420, margin: "6px auto 0" }}>
            Draft a lineup in Draft Studio and hit <strong>Simulate this
            draft</strong> — the game it generates opens here, playable
            minute by minute.
          </p>
        </div>
      )}
    </>
  );
}

function MatchPlayer({ sim }: { sim: SimResult }) {
  const duration = sim.summary.duration_seconds;
  const pb = usePlayback(duration);
  // One hero can be "focused" from anywhere — scoreboard row, map token,
  // net-worth label — and lights up everywhere at once. That cross-linking is
  // what makes ten dots debuggable rather than decorative.
  const [focused, setFocused] = useState<string | null>(null);
  const [nwMode, setNwMode] = useState<"teams" | "heroes">("teams");
  const [spread, setSpread] = useState(true);
  const tags = useMemo(() => heroTags(sim.timeline), [sim.timeline]);

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
  // Markers live in game time so scrubbing re-shows them exactly, but at high
  // speed a fixed 90-second life flashes past — scale it with the clock rate.
  const lifeScale = pb.playing ? Math.min(3, Math.max(1, pb.speed / 60)) : 1;
  const markers = mapMarkersAt(sim.timeline, pb.clock, lifeScale);
  const casualties = casualtiesAt(sim.timeline, pb.clock);
  const aegis = aegisAt(sim.timeline, pb.clock);
  // The win-prob head marker lands on discrete 30s samples, so it steps. Glide
  // it over the real-time gap between those samples (capped so slow speeds
  // don't smear), and only while playing — scrubbing is direct manipulation,
  // which should track the cursor rather than trail it. Hero dots need none of
  // this: positionsAt already interpolates them per frame.
  const tickMs = pb.playing ? Math.min(450, (30 / pb.speed) * 1000) : 0;

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
          <HeroScoreboard
            radiant={heroScores.radiant}
            dire={heroScores.dire}
            tags={tags}
            focused={focused}
            onFocus={setFocused}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Map</h3>
            <div className="seg seg-sm" role="group" aria-label="Dot placement">
              <button
                type="button"
                className={spread ? "on" : ""}
                onClick={() => setSpread(true)}
                title="Nudge crowded dots apart so the labels stay readable"
              >
                Spread
              </button>
              <button
                type="button"
                className={spread ? "" : "on"}
                onClick={() => setSpread(false)}
                title="Draw the engine's literal coordinates"
              >
                Raw
              </button>
            </div>
          </div>
          <Minimap
            radiantLost={fallen.radiant}
            direLost={fallen.dire}
            heroes={heroDots}
            tags={tags}
            markers={markers}
            casualties={casualties}
            focused={focused}
            onFocus={setFocused}
            spread={spread}
          />
          {aegis && (
            <p className="aegis-pill">
              <span style={{ color: COLOR(aegis.side) }}>
                {aegis.side === "radiant" ? "Radiant" : "Dire"}
              </span>{" "}
              hold the Aegis
            </p>
          )}
        </div>
      </div>

      <div className="viewer-cols" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Net worth</h3>
            <div className="seg seg-sm" role="group" aria-label="Net worth view">
              <button
                type="button"
                className={nwMode === "teams" ? "on" : ""}
                onClick={() => setNwMode("teams")}
              >
                Teams
              </button>
              <button
                type="button"
                className={nwMode === "heroes" ? "on" : ""}
                onClick={() => setNwMode("heroes")}
              >
                Heroes
              </button>
            </div>
          </div>
          <NetworthGraph
            timeline={sim.timeline}
            upTo={pb.clock}
            mode={nwMode}
            tags={tags}
            focused={focused}
            onFocus={setFocused}
          />
        </div>
        <div className="card">
          <h3>Win probability</h3>
          <WinProbGraph timeline={sim.timeline} upTo={pb.clock} tickMs={tickMs} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Match feed</h3>
        <EventLog timeline={sim.timeline} upTo={pb.clock} tags={tags} />
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
