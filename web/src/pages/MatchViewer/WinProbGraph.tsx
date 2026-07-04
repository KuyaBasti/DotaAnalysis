import type { TimelineEvent } from "../../types";
import { winProbSeries } from "./playback";

const W = 600;
const H = 110;
const PAD = 36;

// A compact strip of P(radiant wins) over time — the drama meter. Green above
// the midline means Radiant is favored, red below means Dire. Like the
// net-worth graph, the axes span the whole match and only the line is revealed
// up to the play head, so tide-turns land as they happen.
export function WinProbGraph({
  timeline,
  upTo,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
}) {
  const series = winProbSeries(timeline);
  if (series.length === 0) return null;

  const maxT = Math.max(...series.map((p) => p.t));
  const visible = upTo === undefined ? series : series.filter((p) => p.t <= upTo);
  const x = (t: number) => PAD + (maxT === 0 ? 0 : (t / maxT) * (W - 2 * PAD));
  const y = (prob: number) => PAD + (1 - prob) * (H - 2 * PAD);
  const midY = y(0.5);
  const headX = upTo === undefined ? null : x(Math.min(upTo, maxT));

  const line = visible
    .map((p) => `${x(p.t).toFixed(1)},${y(p.radiant).toFixed(1)}`)
    .join(" ");
  const last = visible[visible.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", border: "1px solid #eee", borderRadius: 8 }}
    >
      {/* favored-side bands */}
      <rect x={PAD} y={PAD} width={W - 2 * PAD} height={midY - PAD} fill="#2e7d32" opacity="0.06" />
      <rect x={PAD} y={midY} width={W - 2 * PAD} height={H - PAD - midY} fill="#c62828" opacity="0.06" />
      <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} stroke="#ccc" strokeDasharray="4 3" />
      {headX !== null && (
        <line x1={headX} y1={PAD} x2={headX} y2={H - PAD} stroke="#bbb" strokeDasharray="3 3" />
      )}
      <polyline fill="none" stroke="#555" strokeWidth="2" points={line} />
      {last && (
        <circle
          cx={x(last.t)}
          cy={y(last.radiant)}
          r="3.5"
          fill={last.radiant >= 0.5 ? "#2e7d32" : "#c62828"}
        />
      )}
      <text x={PAD} y={PAD - 8} fontSize="11" fill="#2e7d32">
        Radiant favored
      </text>
      <text x={PAD} y={H - PAD + 16} fontSize="11" fill="#c62828">
        Dire favored
      </text>
    </svg>
  );
}
