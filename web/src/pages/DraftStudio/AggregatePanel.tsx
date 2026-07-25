import type { SimAggregate } from "../../types";

function mmss(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The Monte-Carlo result: how the drafted matchup plays out over N sims — a
// win-probability distribution, a game-length spread, and a representative
// game to drop into the Match Viewer.
export function AggregatePanel({
  aggregate,
  onWatch,
}: {
  aggregate: SimAggregate;
  onWatch?: (simId: string) => void;
}) {
  const radiantPct = Math.round(aggregate.radiant_win_rate * 100);
  const d = aggregate.duration_seconds;
  const maxCount = Math.max(...aggregate.duration_histogram.map((b) => b.count), 1);

  return (
    <div
      style={{
        margin: "0.5rem 0 1.25rem",
        padding: "0.9rem 1rem",
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        background: "#fafafa",
      }}
    >
      <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: 8 }}>
        Over <strong>{aggregate.runs}</strong> simulations:
      </div>

      {/* win-rate bar */}
      <div style={{ display: "flex", height: 26, borderRadius: 5, overflow: "hidden" }}>
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
          Radiant {radiantPct}%
        </div>
        <div
          style={{
            flex: 1,
            background: "#c62828",
            color: "#fff",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 8,
          }}
        >
          Dire {100 - radiantPct}%
        </div>
      </div>

      <div style={{ fontSize: "0.8rem", color: "#555", margin: "10px 0 4px" }}>
        Game length — median <strong>{mmss(d.median)}</strong>{" "}
        <span style={{ color: "#888" }}>
          (typical {mmss(d.p25)}–{mmss(d.p75)})
        </span>
      </div>

      {/* duration histogram */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
        {aggregate.duration_histogram.map((b) => (
          <div
            key={b.minute}
            title={`${b.minute}–${b.minute + 5} min: ${b.count}`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
          >
            <div
              style={{
                width: "100%",
                height: `${(b.count / maxCount) * 44}px`,
                background: "#7e9dd0",
                borderRadius: "2px 2px 0 0",
              }}
            />
            <span style={{ fontSize: "0.6rem", color: "#999", marginTop: 2 }}>
              {b.minute}
            </span>
          </div>
        ))}
      </div>

      {onWatch && (
        <button
          onClick={() => onWatch(aggregate.representative_sim_id)}
          style={{
            marginTop: 10,
            padding: "0.4rem 0.9rem",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#222",
            color: "#fff",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          ▶ Watch a representative game
        </button>
      )}
    </div>
  );
}
