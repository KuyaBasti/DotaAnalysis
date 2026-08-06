import type { DraftExplanation, Hero } from "../../types";
import { bracketLabel } from "./brackets";

const RADIANT = "#2e7d32";
const DIRE = "#c62828";

// Coach Lab: *why* the draft sits where it does. The win-prob model is linear
// in log-odds, so each hero's effect is exact — dropping them is the
// counterfactual "an average hero played this slot instead", which also drops
// their synergy and counter terms (pair weights are centred on zero, so a hero
// with none of them really is the average one). Bars are the resulting swing in
// percentage points, from that hero's own team's side.
export function ExplanationPanel({
  explanation,
  heroes,
}: {
  explanation: DraftExplanation;
  heroes: Hero[];
}) {
  const nameOf = new Map(heroes.map((h) => [h.key, h.display_name]));
  const rows = explanation.contributions;
  const widest = Math.max(...rows.map((c) => Math.abs(c.swing)), 0.5);

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
      <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: 10 }}>
        Who moves this draft at <strong>{bracketLabel(explanation.bracket)}</strong> —
        each hero&rsquo;s swing versus an average pick in the same slot:
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((c) => {
          const positive = c.swing >= 0;
          const color = c.team === "radiant" ? RADIANT : DIRE;
          // Two half-width tracks around a centre line: left = hurts, right = helps.
          const share = (Math.abs(c.swing) / widest) * 50;
          return (
            <div
              key={`${c.team}-${c.hero}`}
              style={{ display: "flex", alignItems: "center", fontSize: "0.8rem" }}
            >
              <div
                style={{
                  width: 130,
                  color,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={c.team === "radiant" ? "Radiant" : "Dire"}
              >
                {nameOf.get(c.hero) ?? c.hero}
              </div>

              <div style={{ flex: 1, display: "flex", height: 16, alignItems: "center" }}>
                <div style={{ width: "50%", display: "flex", justifyContent: "flex-end" }}>
                  {!positive && (
                    <div style={{ width: `${share}%`, background: color, opacity: 0.35, height: 16 }} />
                  )}
                </div>
                <div style={{ width: 1, height: 16, background: "#ccc" }} />
                <div style={{ width: "50%" }}>
                  {positive && (
                    <div style={{ width: `${share}%`, background: color, height: 16 }} />
                  )}
                </div>
              </div>

              <div
                style={{
                  width: 62,
                  textAlign: "right",
                  color: positive ? "#333" : "#999",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {positive ? "+" : ""}
                {c.swing.toFixed(1)} pp
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: "0.72rem", color: "#888", marginTop: 10, lineHeight: 1.5 }}>
        Positive = the hero helps their own side. Each swing counts the hero
        themselves <em>plus</em> how they fit this particular draft — who they
        pair with and who they line up against — so the same hero is worth
        different amounts in different drafts. Measured one hero at a time, so
        they don&rsquo;t add up to the total.
      </div>
    </div>
  );
}
