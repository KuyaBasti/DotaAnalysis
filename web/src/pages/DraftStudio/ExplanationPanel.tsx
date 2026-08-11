import type { DraftExplanation, Hero } from "../../types";
import { bracketLabel } from "./brackets";

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
    <div className="card">
      <h3>Who moves this draft · {bracketLabel(explanation.bracket)}</h3>

      <div className="swings">
        {rows.map((c) => {
          const positive = c.swing >= 0;
          // Two half-width tracks around a centre line: left hurts, right helps.
          const share = (Math.abs(c.swing) / widest) * 100;
          return (
            <div key={`${c.team}-${c.hero}`} className={`swing ${c.team}`}>
              <span className="swing-name">{nameOf.get(c.hero) ?? c.hero}</span>
              <span className="swing-track">
                <span className="lhs">
                  {!positive && <i style={{ width: `${share}%` }} className="down" />}
                </span>
                <span className="axis" />
                <span className="rhs">
                  {positive && <i style={{ width: `${share}%` }} />}
                </span>
              </span>
              <span className={`swing-val num ${positive ? "" : "dim"}`}>
                {positive ? "+" : ""}
                {c.swing.toFixed(1)} pp
              </span>
            </div>
          );
        })}
      </div>

      <p className="dim small foot-note">
        Positive = the hero helps their own side. Each swing counts the hero
        themselves <em>plus</em> how they fit this particular draft — who they
        pair with and who they line up against — so the same hero is worth
        different amounts in different drafts. Measured one hero at a time, so
        they don&rsquo;t add up to the total.
      </p>
    </div>
  );
}
