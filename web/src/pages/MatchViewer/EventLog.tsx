import type { ReactNode } from "react";
import type { TimelineEvent } from "../../types";
import { describeEvent, mmss } from "./playback";

const COLOR: Record<string, string> = {
  radiant: "var(--radiant)",
  dire: "var(--dire)",
};

// Swap any hero name in the narration for its monogram chip + name, so a line
// in the feed and a token on the map are recognisably the same hero. Longest
// names first, so "Phantom Assassin" is never matched as "Phantom".
function withChips(text: string, tags: Map<string, string>): ReactNode[] {
  const names = [...tags.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [text];
  const pattern = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "g"));
  return parts.map((part, i) =>
    tags.has(part) ? (
      <span key={i} className="feed-hero">
        <span className="hchip hchip-quiet">{tags.get(part)}</span>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// A live feed of narrative beats, newest first. Per-tick economy/laning noise is
// dropped; when `upTo` is set, only beats that have happened are shown.
export function EventLog({
  timeline,
  upTo,
  tags,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
  tags?: Map<string, string>;
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
    return <p style={{ color: "var(--ink-3)" }}>Waiting for the match to begin…</p>;
  }

  return (
    // Scrolls rather than growing: by the final minute a match has ~100 beats,
    // and an unbounded list stretched the card to several screens.
    <ul className="feed">
      {feed.map(({ e, idx }, i) => {
        const { text, side } = describeEvent(e);
        const isLatest = i === 0;
        return (
          <li
            key={idx}
            style={{
              background: isLatest ? "var(--surface-2)" : "transparent",
              opacity: isLatest ? 1 : 0.82,
            }}
          >
            <span style={{ color: "var(--ink-3)" }}>{mmss(e.t)}</span>{" "}
            <span style={{ color: side ? COLOR[side] : "var(--ink-2)" }}>
              {tags ? withChips(text, tags) : text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
