import { useEffect, useState } from "react";
import {
  aggregateDraft,
  evaluateDraft,
  getHeroes,
  latestPatch,
  listPatches,
  simulateDraft,
} from "../../api/client";
import { ATTRIBUTE_COLORS, groupByAttribute } from "./attributes";
import { AggregatePanel } from "./AggregatePanel";
import { BRACKET_KEYS, BRACKET_LABELS } from "./brackets";
import type { Hero, SimAggregate } from "../../types";

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

  // Re-evaluate whenever either side changes (both must be non-empty).
  useEffect(() => {
    if (radiant.length === 0 || dire.length === 0) {
      setWinProb(null);
      return;
    }
    let cancelled = false;
    evaluateDraft(radiant, dire, patch ?? undefined, bracket)
      .then((r) => !cancelled && setWinProb(r.radiant_win_probability))
      .catch(() => !cancelled && setWinProb(null));
    return () => {
      cancelled = true;
    };
  }, [radiant, dire, patch, bracket]);

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

  if (loadError) return <p style={{ color: "crimson" }}>Error: {loadError}</p>;
  if (!patch) return <p>Loading…</p>;

  const radiantPct = winProb === null ? null : Math.round(winProb * 100);

  return (
    <>
      <p>
        Patch <strong>{patch}</strong> — pick a draft, see the live win
        probability from the trained model.
      </p>

      {/* which rank the analysis is for */}
      <div style={{ margin: "0.75rem 0 0.25rem", fontSize: "0.85rem" }}>
        <label>
          Analyze for rank{" "}
          <select
            aria-label="Rank bracket"
            value={bracket}
            onChange={(e) => setBracket(e.target.value)}
            style={{ padding: "0.3rem", borderRadius: 6, marginLeft: 4 }}
          >
            {BRACKET_KEYS.map((k) => (
              <option key={k} value={k}>
                {BRACKET_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: 10, color: "#888", fontSize: "0.78rem" }}>
          heroes perform differently by bracket
        </span>
      </div>

      {/* simulate the drafted match */}
      <div style={{ margin: "0.75rem 0" }}>
        <button
          disabled={
            radiant.length !== TEAM_SIZE ||
            dire.length !== TEAM_SIZE ||
            simulating
          }
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
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: 6,
            background:
              radiant.length === TEAM_SIZE && dire.length === TEAM_SIZE
                ? "#2e7d32"
                : "#bbb",
            color: "#fff",
            cursor: "pointer",
            fontSize: "0.95rem",
          }}
        >
          {simulating ? "Simulating…" : "▶ Simulate this draft"}
        </button>
        <button
          disabled={
            radiant.length !== TEAM_SIZE ||
            dire.length !== TEAM_SIZE ||
            analyzing
          }
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
          style={{
            marginLeft: 8,
            padding: "0.5rem 1rem",
            border: "1px solid #2e7d32",
            borderRadius: 6,
            background: "#fff",
            color:
              radiant.length === TEAM_SIZE && dire.length === TEAM_SIZE
                ? "#2e7d32"
                : "#bbb",
            cursor: "pointer",
            fontSize: "0.95rem",
          }}
        >
          {analyzing ? "Analyzing 200 sims…" : "📊 Analyze (200 sims)"}
        </button>
        {radiant.length !== TEAM_SIZE || dire.length !== TEAM_SIZE ? (
          <span style={{ marginLeft: 10, fontSize: "0.8rem", color: "#888" }}>
            pick 5 heroes per side
          </span>
        ) : null}
        {simError && (
          <span style={{ marginLeft: 10, fontSize: "0.8rem", color: "crimson" }}>
            {simError}
          </span>
        )}
      </div>

      {aggregate && (
        <AggregatePanel aggregate={aggregate} onWatch={onSimulated} />
      )}

      {/* win-probability bar */}
      <div style={{ margin: "1rem 0" }}>
        <div
          style={{
            display: "flex",
            height: 28,
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid #ddd",
            background: "#f3f3f3",
          }}
        >
          {radiantPct !== null && (
            <>
              <div
                style={{
                  width: `${radiantPct}%`,
                  background: "#2e7d32",
                  color: "#fff",
                  fontSize: "0.8rem",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                }}
              >
                {radiantPct}%
              </div>
              <div
                style={{
                  width: `${100 - radiantPct}%`,
                  background: "#c62828",
                  color: "#fff",
                  fontSize: "0.8rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 8,
                }}
              >
                {100 - radiantPct}%
              </div>
            </>
          )}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#666", marginTop: 4 }}>
          {radiantPct === null
            ? "Pick at least one hero per side to evaluate."
            : `Radiant ${radiantPct}% — Dire ${100 - radiantPct}%`}
        </div>
      </div>

      {/* the two teams */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        {(["radiant", "dire"] as const).map((team) => (
          <div key={team} style={{ flex: 1 }}>
            <strong style={{ color: team === "radiant" ? "#2e7d32" : "#c62828" }}>
              {team === "radiant" ? "Radiant" : "Dire"} (
              {(team === "radiant" ? radiant : dire).length}/{TEAM_SIZE})
            </strong>
            <ul style={{ listStyle: "none", padding: 0, minHeight: 24 }}>
              {(team === "radiant" ? radiant : dire).map((key) => (
                <li key={key}>
                  <button
                    onClick={() => unpick(team, key)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 0", color: "#333" }}
                    title="remove"
                  >
                    {name(key)} ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* which side a pick goes to */}
      <div style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
        Adding to:{" "}
        {(["radiant", "dire"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            style={{
              marginRight: 6,
              padding: "0.2rem 0.6rem",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: side === s ? (s === "radiant" ? "#2e7d32" : "#c62828") : "#fff",
              color: side === s ? "#fff" : "#222",
              cursor: "pointer",
            }}
          >
            {s === "radiant" ? "Radiant" : "Dire"}
          </button>
        ))}
      </div>

      {/* hero grid, grouped the way the game does it: STR / AGI / INT / Universal */}
      {groupByAttribute(heroes).map((group) => (
        <section key={group.attr}>
          <h4
            style={{
              margin: "0.9rem 0 0.4rem",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: ATTRIBUTE_COLORS[group.attr],
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: 2,
                background: ATTRIBUTE_COLORS[group.attr],
                marginRight: 6,
              }}
            />
            {group.label} ({group.heroes.length})
          </h4>
          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "0.4rem",
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {group.heroes.map((h) => {
              const used = picked.has(h.key);
              return (
                <li key={h.key}>
                  <button
                    onClick={() => pick(h.key)}
                    disabled={used}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.35rem 0.5rem",
                      borderRadius: 6,
                      border: "1px solid #ddd",
                      borderLeft: `3px solid ${used ? "#ccc" : ATTRIBUTE_COLORS[group.attr]}`,
                      background: used ? "#eee" : "#fff",
                      color: used ? "#aaa" : "#222",
                      cursor: used ? "default" : "pointer",
                    }}
                  >
                    {h.display_name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
