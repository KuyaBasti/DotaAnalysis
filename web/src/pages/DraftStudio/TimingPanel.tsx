import type { DraftTiming, Hero, TimingHero, TimingSide } from "../../types";

// Coach Lab's last slice: when each lineup's gold engine peaks. Built from
// parsed real games — each hero's share of their OWN team's gold, outcome-
// balanced, so neither team leads nor win rates can leak into the curves.
//
// This is FARM timing, deliberately never phrased as win timing: the two
// measurably diverge (a hero can win early yet farm late). The verdict says
// whose economy the long game favours; the corollary is who should close.

const W = 560;
const H = 140;
const PAD = { l: 40, r: 12, t: 10, b: 22 };

function path(
  minutes: number[],
  curve: (number | null)[],
  x: (m: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  curve.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(minutes[i]).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

function SideChips({
  side,
  team,
  nameOf,
}: {
  side: TimingSide;
  team: "radiant" | "dire";
  nameOf: Map<string, string>;
}) {
  const chip = (h: TimingHero) => {
    const name = nameOf.get(h.hero) ?? h.hero;
    if (h.scaling === null) {
      return (
        <span key={h.hero} className="tchip dim" title={`no measurable curve yet (${h.n} games)`}>
          {name} · ?
        </span>
      );
    }
    const pp = (h.scaling * 100).toFixed(1);
    return (
      <span
        key={h.hero}
        className={`tchip ${h.gated ? "" : "dim"}`}
        title={h.gated ? `${h.n} games` : `thin data — ${h.n} games`}
      >
        {name} {h.scaling >= 0 ? "+" : ""}
        {pp}{h.gated ? "" : " ·thin"}
      </span>
    );
  };
  return (
    <div className="timing-side">
      <span className={`tag ${team}`}>{team === "radiant" ? "Radiant" : "Dire"}</span>
      <span className="tchips">{side.heroes.map(chip)}</span>
    </div>
  );
}

export function TimingPanel({
  timing,
  heroes,
}: {
  timing: DraftTiming;
  heroes: Hero[];
}) {
  const nameOf = new Map(heroes.map((h) => [h.key, h.display_name]));
  const { minutes, radiant, dire, verdict, margin } = timing;

  const values = [...radiant.curve_rel, ...dire.curve_rel].filter(
    (v): v is number => v !== null,
  );
  const span = Math.max(0.02, ...values.map((v) => Math.abs(v)));
  const x = (m: number) =>
    PAD.l + ((m - minutes[0]) / (minutes[minutes.length - 1] - minutes[0])) * (W - PAD.l - PAD.r);
  const y = (v: number) => {
    const mid = PAD.t + (H - PAD.t - PAD.b) / 2;
    return mid - (v / span) * ((H - PAD.t - PAD.b) / 2);
  };

  const unmeasured = 10 - radiant.measured - dire.measured;
  const headline =
    verdict === "even"
      ? "No meaningful farm-timing edge between these lineups."
      : verdict === "radiant"
        ? "The long game favours Radiant's gold engine — Dire wants to close early."
        : "The long game favours Dire's gold engine — Radiant wants to close early.";

  return (
    <div className="card">
      <h3>Farm timing · from {values.length ? "parsed real games" : "—"}</h3>

      <p className="timing-headline">
        {headline}{" "}
        {verdict !== "even" && (
          <span className="dim small num">({(margin * 100).toFixed(1)} pp of team gold)</span>
        )}
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block" }}
        role="img"
        aria-label="Each lineup's summed gold share, relative to its own early game"
      >
        <line x1={PAD.l} y1={y(0)} x2={W - PAD.r} y2={y(0)} stroke="var(--line)" />
        {minutes.map((m) => (
          <text key={m} x={x(m)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
            {m}m
          </text>
        ))}
        <text x={PAD.l - 6} y={y(span) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
          +{(span * 100).toFixed(0)}pp
        </text>
        <text x={PAD.l - 6} y={y(-span) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
          −{(span * 100).toFixed(0)}pp
        </text>
        <path d={path(minutes, radiant.curve_rel, x, y)} fill="none" stroke="var(--radiant)" strokeWidth="2" />
        <path d={path(minutes, dire.curve_rel, x, y)} fill="none" stroke="var(--dire)" strokeWidth="2" />
      </svg>

      <div className="timing-sides">
        <SideChips side={radiant} team="radiant" nameOf={nameOf} />
        <SideChips side={dire} team="dire" nameOf={nameOf} />
      </div>

      <p className="dim small foot-note">
        Each line is a lineup&rsquo;s summed share of <em>its own</em> team gold,
        relative to minute 5 — rising means those heroes historically claim a
        growing slice as games run long. This is <strong>farm</strong> timing,
        not win timing: it says whose economy scales, not who wins when.
        {unmeasured > 0 && (
          <> {unmeasured} of 10 heroes {unmeasured === 1 ? "has" : "have"} too
          little parsed data to measure yet and {unmeasured === 1 ? "is" : "are"} excluded
          from the curves.</>
        )}
      </p>
    </div>
  );
}
