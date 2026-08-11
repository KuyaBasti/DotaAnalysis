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
    <div className="row playback">
      <button className="btn primary" onClick={pb.toggle} style={{ minWidth: 104 }}>
        {label}
      </button>

      <span className="num small muted" style={{ minWidth: 96 }}>
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
