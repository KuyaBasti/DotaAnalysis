import { mmss } from "./playback";
import type { Playback } from "./usePlayback";

const SPEEDS = [30, 60, 120, 240];

export function PlaybackControls({
  pb,
  duration,
}: {
  pb: Playback;
  duration: number;
}) {
  const label = pb.atEnd ? "↻ Replay" : pb.playing ? "❚❚ Pause" : "▶ Play";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        margin: "0.5rem 0 1rem",
      }}
    >
      <button
        onClick={pb.toggle}
        style={{
          padding: "0.4rem 0.9rem",
          border: "1px solid #ccc",
          borderRadius: 6,
          background: "#222",
          color: "#fff",
          cursor: "pointer",
          minWidth: 96,
        }}
      >
        {label}
      </button>

      <span
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: "0.9rem",
          color: "#555",
          minWidth: 96,
        }}
      >
        {mmss(pb.clock)} / {mmss(duration)}
      </span>

      <input
        aria-label="Scrub match time"
        type="range"
        min={0}
        max={duration}
        step={1}
        value={Math.floor(pb.clock)}
        onChange={(e) => pb.seek(Number(e.target.value))}
        style={{ flex: 1 }}
      />

      <select
        aria-label="Playback speed"
        value={pb.speed}
        onChange={(e) => pb.setSpeed(Number(e.target.value))}
        style={{ padding: "0.3rem", borderRadius: 6 }}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}
