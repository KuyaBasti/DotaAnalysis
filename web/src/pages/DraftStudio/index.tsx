import { useEffect, useState } from "react";
import {
  aggregateDraft,
  evaluateDraft,
  explainDraft,
  getHeroes,
  latestPatch,
  listPatches,
  simulateDraft,
  suggestPicks,
} from "../../api/client";
import { ATTRIBUTE_COLORS, groupByAttribute } from "./attributes";
import { AggregatePanel } from "./AggregatePanel";
import { ExplanationPanel } from "./ExplanationPanel";
import { SuggestionPanel } from "./SuggestionPanel";
import { BRACKET_KEYS, BRACKET_LABELS } from "./brackets";
import type {
  DraftExplanation,
  DraftSuggestions,
  Hero,
  SimAggregate,
} from "../../types";

const TEAM_SIZE = 5;

export function DraftStudio({
  onSimulated,
}: {
  onSimulated?: (simId: string) => void;
}) {
  const [patch, setPatch] = useState<string | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [radiant, setRadiant] = useState<string[]>([]);
  const [dire, setDire] = useState<string[]>([]);
  const [side, setSide] = useState<"radiant" | "dire">("radiant");
  const [winProb, setWinProb] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<DraftExplanation | null>(null);
  const [suggestions, setSuggestions] = useState<DraftSuggestions | null>(null);
  const [rankBy, setRankBy] = useState<"swing" | "fit">("swing");
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [bracket, setBracket] = useState<string>("all");
  const [analyzing, setAnalyzing] = useState(false);
  const [aggregate, setAggregate] = useState<SimAggregate | null>(null);

  // Load the patch's heroes once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { patches } = await listPatches();
        const current = latestPatch(patches);
        if (!current) throw new Error("No patches ingested yet.");
        const data = await getHeroes(current);
        if (!cancelled) {
          setPatch(current);
          setHeroes([...data.heroes].sort((a, b) =>
            a.display_name.localeCompare(b.display_name),
          ));
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-evaluate whenever either side changes (both must be non-empty). The
  // breakdown rides along on the same picks so it can never disagree with the
  // bar above it; both are model-only calls, no simulation.
  useEffect(() => {
    if (radiant.length === 0 || dire.length === 0) {
      setWinProb(null);
      setExplanation(null);
      return;
    }
    let cancelled = false;
    evaluateDraft(radiant, dire, patch ?? undefined, bracket)
      .then((r) => !cancelled && setWinProb(r.radiant_win_probability))
      .catch(() => !cancelled && setWinProb(null));
    explainDraft(radiant, dire, patch ?? undefined, bracket)
      .then((r) => !cancelled && setExplanation(r))
      .catch(() => !cancelled && setExplanation(null));
    return () => {
      cancelled = true;
    };
  }, [radiant, dire, patch, bracket]);

  // Suggestions track the side you're adding to, so they also refresh when you
  // switch sides or change the ordering.
  useEffect(() => {
    const team = side === "radiant" ? radiant : dire;
    if (team.length >= TEAM_SIZE) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    suggestPicks(radiant, dire, side, rankBy, patch ?? undefined, bracket)
      .then((r) => !cancelled && setSuggestions(r))
      .catch(() => !cancelled && setSuggestions(null));
    return () => {
      cancelled = true;
    };
  }, [radiant, dire, side, rankBy, patch, bracket]);

  const picked = new Set([...radiant, ...dire]);

  const pick = (key: string) => {
    if (picked.has(key)) return;
    const [team, setTeam] =
      side === "radiant" ? [radiant, setRadiant] : [dire, setDire];
    if (team.length < TEAM_SIZE) setTeam([...team, key]);
  };
  const unpick = (team: "radiant" | "dire", key: string) => {
    (team === "radiant" ? setRadiant : setDire)((cur) =>
      cur.filter((k) => k !== key),
    );
  };

  const name = (key: string) =>
    heroes.find((h) => h.key === key)?.display_name ?? key;

  if (loadError) return <div className="note bad">{loadError}</div>;
  if (!patch) return <p className="dim">Loading…</p>;

  const radiantPct = winProb === null ? null : Math.round(winProb * 100);

  const full = radiant.length === TEAM_SIZE && dire.length === TEAM_SIZE;

  return (
    <>
      <div className="page-head">
        <h2>Draft Studio</h2>
        <span className="tag">patch {patch}</span>
        <span className="meta">live win probability from the trained model</span>
        <span className="spacer" />
        <label className="row small dim">
          Rank
          <select
            aria-label="Rank bracket"
            value={bracket}
            onChange={(e) => setBracket(e.target.value)}
          >
            {BRACKET_KEYS.map((k) => (
              <option key={k} value={k}>
                {BRACKET_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {simError && <div className="note bad">{simError}</div>}

      {/* the draft as it stands, and what the model makes of it */}
      <div className="card">
        <div className="draft-teams">
          {(["radiant", "dire"] as const).map((team) => {
            const roster = team === "radiant" ? radiant : dire;
            return (
              <div key={team} className={`roster ${team}`}>
                <div className="roster-head">
                  <span className={`tag ${team}`}>
                    {team === "radiant" ? "Radiant" : "Dire"}
                  </span>
                  <span className="dim small num">
                    {roster.length}/{TEAM_SIZE}
                  </span>
                  <span className="spacer" />
                  <button
                    className={`btn ghost small ${side === team ? "on" : ""}`}
                    onClick={() => setSide(team)}
                    title={`Add picks to ${team}`}
                  >
                    {side === team ? "picking" : "pick here"}
                  </button>
                </div>
                <ul className="roster-list">
                  {roster.map((key) => (
                    <li key={key}>
                      <button onClick={() => unpick(team, key)} title="remove">
                        {name(key)} <span className="dim">✕</span>
                      </button>
                    </li>
                  ))}
                  {Array.from({ length: TEAM_SIZE - roster.length }).map((_, i) => (
                    <li key={`slot-${i}`} className="slot" />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {radiantPct === null ? (
          <p className="dim small" style={{ margin: "16px 0 0" }}>
            Pick at least one hero per side to evaluate.
          </p>
        ) : (
          <>
            <div className="splitbar" style={{ marginTop: 16 }}>
              <div className="r" style={{ width: `${radiantPct}%` }}>
                {radiantPct}%
              </div>
              <div className="d" style={{ width: `${100 - radiantPct}%` }}>
                {100 - radiantPct}%
              </div>
            </div>
            <div className="dim small" style={{ marginTop: 6 }}>
              Radiant {radiantPct}% — Dire {100 - radiantPct}%
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn primary"
            disabled={!full || simulating}
            onClick={async () => {
              if (!patch) return;
              setSimulating(true);
              setSimError(null);
              try {
                const { id } = await simulateDraft(radiant, dire, patch);
                onSimulated?.(id);
              } catch (e) {
                setSimError(e instanceof Error ? e.message : String(e));
              } finally {
                setSimulating(false);
              }
            }}
          >
            {simulating ? "Simulating…" : "▶ Simulate this draft"}
          </button>
          <button
            className="btn"
            disabled={!full || analyzing}
            onClick={async () => {
              if (!patch) return;
              setAnalyzing(true);
              setSimError(null);
              setAggregate(null);
              try {
                setAggregate(await aggregateDraft(radiant, dire, patch, 200, bracket));
              } catch (e) {
                setSimError(e instanceof Error ? e.message : String(e));
              } finally {
                setAnalyzing(false);
              }
            }}
          >
            {analyzing ? "Analyzing 200 sims…" : "📊 Analyze (200 sims)"}
          </button>
          {!full && <span className="dim small">pick 5 heroes per side</span>}
        </div>
      </div>

      {aggregate && <AggregatePanel aggregate={aggregate} onWatch={onSimulated} />}

      {/* why the bar sits where it does */}
      {explanation && (
        <ExplanationPanel explanation={explanation} heroes={heroes} />
      )}

      {/* and what to do about it */}
      {suggestions && (
        <SuggestionPanel
          suggestions={suggestions}
          heroes={heroes}
          rankBy={rankBy}
          onRankBy={setRankBy}
          onPick={pick}
        />
      )}

      {/* hero grid, grouped the way the game does it: STR / AGI / INT / Universal */}
      <div className="card">
        <h3>Heroes</h3>
        {groupByAttribute(heroes).map((group) => (
          <section key={group.attr} className="attr-group">
            <h4 style={{ color: ATTRIBUTE_COLORS[group.attr] }}>
              <i style={{ background: ATTRIBUTE_COLORS[group.attr] }} />
              {group.label}
              <span className="dim num"> {group.heroes.length}</span>
            </h4>
            <ul className="hero-grid">
              {group.heroes.map((h) => {
                const used = picked.has(h.key);
                return (
                  <li key={h.key}>
                    <button
                      onClick={() => pick(h.key)}
                      disabled={used}
                      style={{ borderLeftColor: ATTRIBUTE_COLORS[group.attr] }}
                    >
                      {h.display_name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
