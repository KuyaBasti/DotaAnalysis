import type { HeroScore } from "./playback";

const COLOR = { radiant: "var(--radiant)", dire: "var(--dire)" } as const;

// Ten heroes, two columns, each hero's gold ticking up as the match plays —
// the first slice of the FM-style match screen. Bars are relative to the
// richest hero on screen so farm gaps read at a glance. Hovering or focusing a
// row lights that hero up on the map and in the net-worth graph.
export function HeroScoreboard({
  radiant,
  dire,
  tags,
  focused = null,
  onFocus,
}: {
  radiant: HeroScore[];
  dire: HeroScore[];
  tags: Map<string, string>;
  focused?: string | null;
  onFocus?: (hero: string | null) => void;
}) {
  if (radiant.length === 0 && dire.length === 0) return null;
  const richest = Math.max(
    ...radiant.map((h) => h.netWorth),
    ...dire.map((h) => h.netWorth),
    1,
  );

  return (
    <div
      style={{ display: "flex", gap: "1.5rem", margin: "0.75rem 0" }}
      onMouseLeave={() => onFocus?.(null)}
    >
      <Column side="radiant" heroes={radiant} richest={richest} tags={tags} focused={focused} onFocus={onFocus} />
      <Column side="dire" heroes={dire} richest={richest} tags={tags} focused={focused} onFocus={onFocus} />
    </div>
  );
}

function Column({
  side,
  heroes,
  richest,
  tags,
  focused,
  onFocus,
}: {
  side: "radiant" | "dire";
  heroes: HeroScore[];
  richest: number;
  tags: Map<string, string>;
  focused: string | null;
  onFocus?: (hero: string | null) => void;
}) {
  // Draft order, NOT net worth. Sorting by gold re-ordered the rows every 30
  // game-seconds — eight times a minute at 240x — so the hero you were
  // watching kept jumping under your eyes.
  return (
    <div style={{ flex: 1 }}>
      {heroes.map((h) => {
        const isFocused = focused === h.hero;
        const dim = focused !== null && !isFocused;
        return (
          <button
            type="button"
            key={h.hero}
            className="hero-row"
            aria-pressed={isFocused}
            onMouseEnter={() => onFocus?.(h.hero)}
            onFocus={() => onFocus?.(h.hero)}
            onClick={() => onFocus?.(isFocused ? null : h.hero)}
            style={{ opacity: dim ? 0.5 : 1 }}
          >
            <div className="hero-row-line">
              <span className="hero-row-name">
                <span className="hchip" style={{ background: COLOR[side] }}>
                  {tags.get(h.hero) ?? "??"}
                </span>
                <span className="hero-row-level num">{h.level}</span>
                {h.hero}
              </span>
              <span>
                <span className="hero-row-kda num" title="kills / deaths / assists">
                  {h.kills}/{h.deaths}/{h.assists}
                </span>
                <span className="hero-row-gold num">
                  {Math.round(h.netWorth).toLocaleString()}
                </span>
              </span>
            </div>
            <div className="meter" style={{ height: 3 }}>
              <i
                style={{
                  width: `${(h.netWorth / richest) * 100}%`,
                  background: COLOR[side],
                }}
              />
            </div>
            {h.items.length > 0 && (
              <div className="hero-row-item" title={h.items.join(", ")}>
                {h.items[h.items.length - 1]}
                {h.items.length > 1 ? ` +${h.items.length - 1}` : ""}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
