import type { DraftSuggestions, Hero } from "../../types";
import { bracketLabel } from "./brackets";

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
  const rows = suggestions.suggestions;
  const widest = Math.max(...rows.map((s) => Math.abs(s[rankBy])), 0.5);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>
          Next pick · <span className={`tag ${suggestions.side}`}>
            {suggestions.side === "radiant" ? "Radiant" : "Dire"}
          </span>{" "}
          · {bracketLabel(suggestions.bracket)}
        </h3>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="seg">
          {(
            [
              ["swing", "Strongest"],
              ["fit", "Best fit"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={rankBy === key ? "on" : ""}
              onClick={() => onRankBy(key)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      <ul className="suggestions">
        {rows.map((s) => (
          <li key={s.hero}>
            <button
              onClick={() => onPick(s.hero)}
              title={`Pick ${nameOf.get(s.hero) ?? s.hero}`}
              className={suggestions.side}
            >
              <span className="sg-name">{nameOf.get(s.hero) ?? s.hero}</span>
              <span className="sg-track">
                <i style={{ width: `${(Math.max(0, s[rankBy]) / widest) * 100}%` }} />
              </span>
              <span className="sg-val num">
                {s.swing >= 0 ? "+" : ""}
                {s.swing.toFixed(1)} pp
                <span className="dim">
                  {" "}
                  ({s.fit >= 0 ? "+" : ""}
                  {s.fit.toFixed(1)} fit)
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="dim small foot-note">
        Click a hero to pick them. <strong>pp</strong> is the total gain for this
        side; <strong>fit</strong> is the part that comes from pairing with — and
        countering — the heroes already drafted, rather than the hero being
        strong in general. Sort by <em>Best fit</em> to see what actually suits
        this board.
      </p>
    </div>
  );
}
