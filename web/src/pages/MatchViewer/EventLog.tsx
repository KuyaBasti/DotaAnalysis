import type { TimelineEvent } from "../../types";
import { describeEvent, mmss } from "./playback";

const COLOR: Record<string, string> = {
  radiant: "#2e7d32",
  dire: "#c62828",
};

// A live feed of narrative beats, newest first. Per-tick economy/laning noise is
// dropped; when `upTo` is set, only beats that have happened are shown.
export function EventLog({
  timeline,
  upTo,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
}) {
  const beats = timeline
    .map((e, idx) => ({ e, idx }))
    .filter(
      ({ e }) =>
        e.type !== "economy" &&
        e.type !== "laning" &&
        e.type !== "positions" &&
        (upTo === undefined || e.t <= upTo),
    );
  const feed = [...beats].reverse(); // newest at the top

  if (feed.length === 0) {
    return <p style={{ color: "#888" }}>Waiting for the match to begin…</p>;
  }

  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        fontFamily: "ui-monospace, monospace",
        fontSize: "0.85rem",
      }}
    >
      {feed.map(({ e, idx }, i) => {
        const { text, side } = describeEvent(e);
        const isLatest = i === 0;
        return (
          <li
            key={idx}
            style={{
              padding: "4px 6px",
              borderBottom: "1px solid #f0f0f0",
              background: isLatest ? "#f6f6f4" : "transparent",
              opacity: isLatest ? 1 : 0.82,
            }}
          >
            <span style={{ color: "#999" }}>{mmss(e.t)}</span>{" "}
            <span style={{ color: side ? COLOR[side] : "#444" }}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
