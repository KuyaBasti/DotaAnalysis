import type { DraftSuggestions, Hero } from "../../types";
import { bracketLabel } from "./brackets";

const RADIANT = "#2e7d32";
const DIRE = "#c62828";

// Coach Lab: what to pick next. Two orderings, and the difference matters —
// "Strongest" is dominated by how good a hero is in general (measured: 6-9 of
// the top 10 stay put as the draft changes), while "Best fit" ranks purely on
// synergy and counters with the current board (0-3 of 10 stay put). Offering
// only the first would be a tier list wearing a coach's hat.
export function SuggestionPanel({
  suggestions,
  heroes,
  rankBy,
  onRankBy,
  onPick,
}: {
  suggestions: DraftSuggestions;
  heroes: Hero[];
  rankBy: "swing" | "fit";
  onRankBy: (next: "swing" | "fit") => void;
  onPick: (heroKey: string) => void;
}) {
  const nameOf = new Map(heroes.map((h) => [h.key, h.display_name]));
  const color = suggestions.side === "radiant" ? RADIANT : DIRE;
  const rows = suggestions.suggestions;
  const widest = Math.max(...rows.map((s) => Math.abs(s[rankBy])), 0.5);

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "0.85rem", color: "#666" }}>
          Next pick for <strong style={{ color }}>
            {suggestions.side === "radiant" ? "Radiant" : "Dire"}
          </strong>{" "}
          at <strong>{bracketLabel(suggestions.bracket)}</strong>:
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          {(
            [
              ["swing", "Strongest"],
              ["fit", "Best fit"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => onRankBy(key)}
              style={{
                padding: "0.15rem 0.5rem",
                fontSize: "0.75rem",
                borderRadius: 5,
                cursor: "pointer",
                border: `1px solid ${rankBy === key ? color : "#ccc"}`,
                background: rankBy === key ? color : "#fff",
                color: rankBy === key ? "#fff" : "#555",
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((s) => (
          <button
            key={s.hero}
            onClick={() => onPick(s.hero)}
            title={`Pick ${nameOf.get(s.hero) ?? s.hero}`}
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "0.8rem",
              background: "none",
              border: "none",
              borderRadius: 4,
              padding: "1px 2px",
              cursor: "pointer",
              textAlign: "left",
              color: "#333",
            }}
          >
            <span style={{ width: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {nameOf.get(s.hero) ?? s.hero}
            </span>
            <span style={{ flex: 1, height: 14, display: "flex", alignItems: "center" }}>
              <span
                style={{
                  width: `${(Math.max(0, s[rankBy]) / widest) * 100}%`,
                  background: color,
                  height: 14,
                  borderRadius: 2,
                }}
              />
            </span>
            <span style={{ width: 108, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#555" }}>
              {s.swing >= 0 ? "+" : ""}
              {s.swing.toFixed(1)} pp
              <span style={{ color: "#999" }}>
                {" "}({s.fit >= 0 ? "+" : ""}
                {s.fit.toFixed(1)} fit)
              </span>
            </span>
          </button>
        ))}
      </div>

      <div style={{ fontSize: "0.72rem", color: "#888", marginTop: 10, lineHeight: 1.5 }}>
        Click a hero to pick them. <strong>pp</strong> is the total gain for this
        side; <strong>fit</strong> is the part that comes from pairing with — and
        countering — the heroes already drafted, rather than the hero being
        strong in general. Sort by <em>Best fit</em> to see what actually suits
        this board.
      </div>
    </div>
  );
}
