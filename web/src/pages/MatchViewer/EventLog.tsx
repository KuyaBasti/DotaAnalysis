import type { TimelineEvent } from "../../types";

function mmss(t: number): string {
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function describe(e: TimelineEvent): string {
  const p = e.payload;
  switch (e.type) {
    case "game_start":
      return "Match starts";
    case "fight":
      return `${String(p.winner)} won a fight (+${p.swing} net worth, win prob ${p.radiant_win_prob})`;
    case "game_over":
      return `${String(p.winner)} wins`;
    default:
      return e.type;
  }
}

export function EventLog({ timeline }: { timeline: TimelineEvent[] }) {
  // Drop the per-tick economy/laning noise; show the narrative beats.
  const beats = timeline.filter(
    (e) => e.type !== "economy" && e.type !== "laning",
  );

  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        fontFamily: "ui-monospace, monospace",
        fontSize: "0.85rem",
      }}
    >
      {beats.map((e, i) => (
        <li
          key={i}
          style={{ padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}
        >
          <span style={{ color: "#888" }}>{mmss(e.t)}</span> {describe(e)}
        </li>
      ))}
    </ul>
  );
}
