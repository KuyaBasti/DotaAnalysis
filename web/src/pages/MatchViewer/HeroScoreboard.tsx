import type { HeroScore } from "./playback";

const COLOR = { radiant: "#2e7d32", dire: "#c62828" } as const;

// Ten heroes, two columns, each hero's gold ticking up as the match plays —
// the first slice of the FM-style match screen. Bars are relative to the
// richest hero on screen so farm gaps read at a glance.
export function HeroScoreboard({
  radiant,
  dire,
}: {
  radiant: HeroScore[];
  dire: HeroScore[];
}) {
  if (radiant.length === 0 && dire.length === 0) return null;
  const richest = Math.max(
    ...radiant.map((h) => h.netWorth),
    ...dire.map((h) => h.netWorth),
    1,
  );

  return (
    <div style={{ display: "flex", gap: "1.5rem", margin: "0.75rem 0" }}>
      <Column side="radiant" heroes={radiant} richest={richest} />
      <Column side="dire" heroes={dire} richest={richest} />
    </div>
  );
}

function Column({
  side,
  heroes,
  richest,
}: {
  side: "radiant" | "dire";
  heroes: HeroScore[];
  richest: number;
}) {
  const sorted = [...heroes].sort((a, b) => b.netWorth - a.netWorth);
  return (
    <div style={{ flex: 1 }}>
      {sorted.map((h) => (
        <div key={h.hero} style={{ marginBottom: 4 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.8rem",
              lineHeight: 1.4,
            }}
          >
            <span>
              <span
                style={{
                  display: "inline-block",
                  minWidth: 22,
                  marginRight: 6,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "0.7rem",
                  color: "#999",
                }}
              >
                {h.level}
              </span>
              {h.hero}
            </span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "#666" }}>
              {Math.round(h.netWorth).toLocaleString()}
            </span>
          </div>
          <div style={{ height: 3, background: "#eee", borderRadius: 2 }}>
            <div
              style={{
                height: "100%",
                width: `${(h.netWorth / richest) * 100}%`,
                background: COLOR[side],
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
