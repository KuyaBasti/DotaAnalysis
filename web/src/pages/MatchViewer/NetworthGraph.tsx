import type { TimelineEvent } from "../../types";

export interface NetworthPoint {
  t: number;
  radiant: number;
  dire: number;
}

// Pure, testable: pull the per-tick net-worth series out of economy events.
export function networthSeries(timeline: TimelineEvent[]): NetworthPoint[] {
  return timeline
    .filter((e) => e.type === "economy")
    .map((e) => ({
      t: e.t,
      radiant: Number(e.payload.radiant_net_worth ?? 0),
      dire: Number(e.payload.dire_net_worth ?? 0),
    }));
}

const W = 600;
const H = 280;
const PAD = 36;

function points(
  series: NetworthPoint[],
  pick: (p: NetworthPoint) => number,
  maxT: number,
  maxNw: number,
): string {
  return series
    .map((p) => {
      const x = PAD + (maxT === 0 ? 0 : (p.t / maxT) * (W - 2 * PAD));
      const y = H - PAD - (maxNw === 0 ? 0 : (pick(p) / maxNw) * (H - 2 * PAD));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function NetworthGraph({
  timeline,
  upTo,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
}) {
  const series = networthSeries(timeline);
  if (series.length === 0) return <p>No economy data to plot.</p>;

  // Axes are scaled to the WHOLE match so they don't jump as playback advances;
  // only the drawn line is clipped to the current clock.
  const maxT = Math.max(...series.map((p) => p.t));
  const maxNw = Math.max(...series.map((p) => Math.max(p.radiant, p.dire)), 1);
  const visible = upTo === undefined ? series : series.filter((p) => p.t <= upTo);
  const headX =
    upTo === undefined ? null : PAD + (maxT === 0 ? 0 : (upTo / maxT) * (W - 2 * PAD));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8 }}
    >
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--line)" />
      {headX !== null && (
        <line x1={headX} y1={PAD} x2={headX} y2={H - PAD} stroke="var(--line)" strokeDasharray="3 3" />
      )}
      <polyline
        fill="none"
        stroke="var(--radiant)"
        strokeWidth="2"
        points={points(visible, (p) => p.radiant, maxT, maxNw)}
      />
      <polyline
        fill="none"
        stroke="var(--dire)"
        strokeWidth="2"
        points={points(visible, (p) => p.dire, maxT, maxNw)}
      />
      <text x={W - PAD} y={PAD} textAnchor="end" fontSize="12" fill="var(--radiant)">
        Radiant
      </text>
      <text x={W - PAD} y={PAD + 16} textAnchor="end" fontSize="12" fill="var(--dire)">
        Dire
      </text>
      <text x={PAD} y={PAD - 12} fontSize="11" fill="var(--ink-3)">
        net worth → {Math.round(maxNw).toLocaleString()}
      </text>
    </svg>
  );
}
