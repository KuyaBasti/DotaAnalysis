import type { SimAggregate } from "../../types";
import { bracketLabel } from "./brackets";

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
    <div className="card">
      <h3>
        Monte Carlo · {bracketLabel(aggregate.bracket)}
      </h3>

      <div className="stats" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="k">Radiant wins</div>
          <div className="v" style={{ color: "var(--radiant)" }}>{radiantPct}%</div>
          <div className="n">Dire {100 - radiantPct}%</div>
        </div>
        <div className="stat">
          <div className="k">Median length</div>
          <div className="v">{mmss(d.median)}</div>
          <div className="n">
            typical {mmss(d.p25)}–{mmss(d.p75)}
          </div>
        </div>
        <div className="stat">
          <div className="k">Simulations</div>
          <div className="v">{aggregate.runs}</div>
          <div className="n">each a full game</div>
        </div>
      </div>

      <div className="splitbar">
        <div className="r" style={{ width: `${radiantPct}%` }}>
          Radiant {radiantPct}%
        </div>
        <div className="d" style={{ width: `${100 - radiantPct}%` }}>
          Dire {100 - radiantPct}%
        </div>
      </div>

      <div className="histogram" style={{ marginTop: 14 }}>
        {aggregate.duration_histogram.map((b) => (
          <div key={b.minute} title={`${b.minute}–${b.minute + 5} min: ${b.count}`}>
            <i style={{ height: `${(b.count / maxCount) * 100}%` }} />
            <span className="num">{b.minute}</span>
          </div>
        ))}
      </div>
      <div className="dim small" style={{ marginTop: 4 }}>
        Game length, in 5-minute buckets
      </div>

      {onWatch && (
        <button
          className="btn"
          style={{ marginTop: 14 }}
          onClick={() => onWatch(aggregate.representative_sim_id)}
        >
          ▶ Watch a representative game
        </button>
      )}
    </div>
  );
}
