import type { TimelineEvent } from "../../types";
import { heroNetworthSeries } from "./playback";

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
const LABEL_GUTTER = 30; // room for the monogram riding each hero's line
// A fourth channel beyond colour and label: the draft slot's dash. Survives
// greyscale, printing and colour-blind viewing.
const SLOT_DASH = ["", "4 2", "1.5 2", "6 2 1.5 2", "2.5 1.5 0.5 1.5"];

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
  mode = "teams",
  tags,
  focused = null,
  onFocus,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
  mode?: "teams" | "heroes";
  tags?: Map<string, string>;
  focused?: string | null;
  onFocus?: (hero: string | null) => void;
}) {
  const series = networthSeries(timeline);
  if (series.length === 0) return <p>No economy data to plot.</p>;

  // Axes are scaled to the WHOLE match so they don't jump as playback advances;
  // only the drawn line is clipped to the current clock.
  const maxT = Math.max(...series.map((p) => p.t));
  const visible = upTo === undefined ? series : series.filter((p) => p.t <= upTo);
  const headX =
    upTo === undefined ? null : PAD + (maxT === 0 ? 0 : (upTo / maxT) * (W - 2 * PAD));

  if (mode === "heroes") {
    return (
      <HeroLines
        timeline={timeline}
        upTo={upTo}
        maxT={maxT}
        headX={headX}
        tags={tags ?? new Map()}
        focused={focused}
        onFocus={onFocus}
      />
    );
  }

  const maxNw = Math.max(...series.map((p) => Math.max(p.radiant, p.dire)), 1);
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

// Ten hero lines: colour carries the side (never a rainbow — green and red are
// the only team hues), the dash carries the draft slot, and identity is the
// monogram riding the head of each line. Because the labels sit at the play
// head, their vertical order IS the farm leaderboard at that instant.
function HeroLines({
  timeline,
  upTo,
  maxT,
  headX,
  tags,
  focused,
  onFocus,
}: {
  timeline: TimelineEvent[];
  upTo?: number;
  maxT: number;
  headX: number | null;
  tags: Map<string, string>;
  focused: string | null;
  onFocus?: (hero: string | null) => void;
}) {
  const all = heroNetworthSeries(timeline);
  if (all.length === 0) return <p>No per-hero economy data in this sim.</p>;

  // The team domain would flatten every hero into the bottom quarter, so the
  // heroes view gets its own: the richest hero of the match, rounded up.
  const peak = Math.max(
    ...all.flatMap((s) => s.points.map((p) => p.netWorth)),
    1,
  );
  const maxNw = Math.ceil(peak / 2500) * 2500;
  const plotRight = W - PAD - LABEL_GUTTER;
  const x = (t: number) => PAD + (maxT === 0 ? 0 : (t / maxT) * (plotRight - PAD));
  const y = (nw: number) => H - PAD - (nw / maxNw) * (H - 2 * PAD);

  const lines = all.map((s) => {
    const shown = upTo === undefined ? s.points : s.points.filter((p) => p.t <= upTo);
    const last = shown[shown.length - 1];
    return {
      ...s,
      path: shown.map((p) => `${x(p.t).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" "),
      last,
    };
  });

  // De-collide the end labels: sort by height, then push apart to a minimum
  // gap so two heroes on the same gold never overprint.
  const labelled = lines
    .filter((l) => l.last)
    .map((l) => ({ line: l, ly: y(l.last!.netWorth) }))
    .sort((a, b) => a.ly - b.ly);
  const MIN_GAP = 11;
  for (let i = 1; i < labelled.length; i++) {
    if (labelled[i].ly - labelled[i - 1].ly < MIN_GAP) {
      labelled[i].ly = labelled[i - 1].ly + MIN_GAP;
    }
  }
  for (let i = labelled.length - 2; i >= 0; i--) {
    if (labelled[i + 1].ly - labelled[i].ly < MIN_GAP) {
      labelled[i].ly = labelled[i + 1].ly - MIN_GAP;
    }
  }

  const headAt = headX === null ? plotRight : Math.min(headX, plotRight);
  const gridlines = [0.25, 0.5, 0.75, 1].map((f) => maxNw * f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8 }}
      onMouseLeave={() => onFocus?.(null)}
    >
      {gridlines.map((g) => (
        <g key={g}>
          <line x1={PAD} y1={y(g)} x2={plotRight} y2={y(g)} stroke="var(--line-soft)" />
          <text x={PAD - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--ink-3)">
            {(g / 1000).toFixed(0)}k
          </text>
        </g>
      ))}
      <line x1={PAD} y1={H - PAD} x2={plotRight} y2={H - PAD} stroke="var(--line)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--line)" />
      {headX !== null && (
        <line x1={headAt} y1={PAD} x2={headAt} y2={H - PAD} stroke="var(--line)" strokeDasharray="3 3" />
      )}

      {lines.map((l) => {
        const isFocused = focused === l.hero;
        const dim = focused !== null && !isFocused;
        return (
          <polyline
            key={`${l.side}:${l.hero}`}
            fill="none"
            stroke={l.side === "radiant" ? "var(--radiant)" : "var(--dire)"}
            strokeWidth={isFocused ? 2.5 : 1.25}
            strokeDasharray={SLOT_DASH[l.slot % SLOT_DASH.length] || undefined}
            opacity={dim ? 0.12 : isFocused ? 1 : 0.5}
            points={l.path}
          />
        );
      })}

      {labelled.map(({ line, ly }) => {
        const isFocused = focused === line.hero;
        const dim = focused !== null && !isFocused;
        const color = line.side === "radiant" ? "var(--radiant)" : "var(--dire)";
        return (
          <g
            key={`label:${line.side}:${line.hero}`}
            opacity={dim ? 0.2 : 1}
            onMouseEnter={() => onFocus?.(line.hero)}
            style={{ cursor: onFocus ? "pointer" : undefined }}
          >
            <title>{`${line.hero} — ${Math.round(line.last!.netWorth).toLocaleString()}`}</title>
            <line
              x1={headAt}
              y1={y(line.last!.netWorth)}
              x2={headAt + 5}
              y2={ly}
              stroke="var(--ink-3)"
              strokeWidth="0.5"
            />
            <text
              x={headAt + 7}
              y={ly + 3.5}
              fontSize="10.5"
              fontWeight={isFocused ? 700 : 600}
              fill={color}
            >
              {tags.get(line.hero) ?? "??"}
            </text>
          </g>
        );
      })}

      <text x={PAD} y={PAD - 12} fontSize="11" fill="var(--ink-3)">
        per-hero net worth → {maxNw.toLocaleString()}
      </text>
    </svg>
  );
}
