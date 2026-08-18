import type { Casualty, FallenStructure, HeroDot, MapMarker } from "./playback";
import { spreadDots } from "./playback";
import { ANCIENT, BARRACKS, TOWERS } from "./mapGeometry";
import type { Lane, Tier } from "./mapGeometry";

// The classic square — Radiant bottom-left, Dire top-right, river on the
// diagonal. Structures gray out as the clock passes their fall; the ten heroes
// ride on top as labelled tokens, and the beats the feed narrates (fights,
// objectives, Roshan) leave marks where they happened.

const RADIANT = "var(--radiant)";
const DIRE = "var(--dire)";
const DEAD = "var(--ink-3)";
const STRUCTURE_FADE = "fill 300ms ease, opacity 300ms ease";

function fallenKeys(lost: FallenStructure[]): Set<string> {
  return new Set(lost.map((f) => `${f.structure}:${f.lane ?? "mid"}`));
}

function sideColor(side: string | null): string {
  return side === "radiant" ? RADIANT : side === "dire" ? DIRE : "var(--ink-2)";
}

export function Minimap({
  radiantLost,
  direLost,
  heroes = [],
  tags,
  markers = [],
  casualties,
  focused = null,
  onFocus,
  spread = true,
}: {
  radiantLost: FallenStructure[];
  direLost: FallenStructure[];
  heroes?: HeroDot[];
  tags: Map<string, string>;
  markers?: MapMarker[];
  casualties: Map<string, Casualty>;
  focused?: string | null;
  onFocus?: (hero: string | null) => void;
  // "Raw" draws the engine's literal coordinates — the escape hatch for when
  // you need to trust the map rather than read it.
  spread?: boolean;
}) {
  const lost = { radiant: fallenKeys(radiantLost), dire: fallenKeys(direLost) };
  const ancientDown = {
    radiant: radiantLost.some((f) => f.structure === "ancient"),
    dire: direLost.some((f) => f.structure === "ancient"),
  };

  const lanes: Lane[] = ["top", "mid", "bot"];
  const tiers: Tier[] = ["tier-1 tower", "tier-2 tower", "tier-3 tower"];
  const placed = spread
    ? spreadDots(heroes)
    : heroes.map((h) => ({ ...h, px: h.x, py: h.y, nudged: false }));
  // Stable paint order (never by position, which would flicker z-order every
  // frame): dire under radiant, then by hero name.
  const ordered = [...placed].sort((a, b) =>
    a.side === b.side ? a.hero.localeCompare(b.hero) : a.side === "dire" ? -1 : 1,
  );

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="Minimap: hero positions, structures, and recent events"
      className="minimap"
      onMouseLeave={() => onFocus?.(null)}
    >
      {/* terrain: radiant half, dire half, river on the diagonal */}
      <rect x="0" y="0" width="100" height="100" fill="#8a9a5b" opacity="0.15" />
      <polygon points="0,8 92,100 0,100" fill={RADIANT} opacity="0.13" />
      <polygon points="8,0 100,0 100,92" fill={DIRE} opacity="0.13" />
      <polygon points="0,6 6,0 100,94 94,100" fill="#4a90d9" opacity="0.3" />

      {(["radiant", "dire"] as const).map((side) =>
        lanes.map((lane) => (
          <g key={`${side}-${lane}`}>
            {tiers.map((tier) => {
              const [x, y] = TOWERS[side][lane][tier];
              const down = lost[side].has(`${tier}:${lane}`);
              return (
                <circle
                  key={tier}
                  cx={x}
                  cy={y}
                  r="2.6"
                  fill={down ? DEAD : side === "radiant" ? RADIANT : DIRE}
                  opacity={down ? 0.4 : 1}
                  style={{ transition: STRUCTURE_FADE }}
                >
                  <title>{`${side} ${lane} ${tier}${down ? " (destroyed)" : ""}`}</title>
                </circle>
              );
            })}
            {(() => {
              const [x, y] = BARRACKS[side][lane];
              const down = lost[side].has(`barracks:${lane}`);
              return (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width="4"
                  height="4"
                  fill={down ? DEAD : side === "radiant" ? RADIANT : DIRE}
                  opacity={down ? 0.4 : 0.85}
                  style={{ transition: STRUCTURE_FADE }}
                >
                  <title>{`${side} ${lane} barracks${down ? " (destroyed)" : ""}`}</title>
                </rect>
              );
            })()}
          </g>
        )),
      )}

      {(["radiant", "dire"] as const).map((side) => {
        const [x, y] = ANCIENT[side];
        const down = ancientDown[side];
        return (
          <circle
            key={side}
            cx={x}
            cy={y}
            r="4.5"
            fill={down ? DEAD : side === "radiant" ? RADIANT : DIRE}
            stroke={down ? "var(--ink-3)" : "var(--ink)"}
            strokeWidth="1"
            opacity={down ? 0.45 : 1}
            style={{ transition: STRUCTURE_FADE }}
          >
            <title>{`${side} ancient${down ? " (destroyed)" : ""}`}</title>
          </circle>
        );
      })}

      {/* Beats the feed narrates, marked where they happened. Each fades over
          its own life so the map shows recent history, not a scrapbook. */}
      {markers.map((m) => {
        const fade = Math.max(0, 1 - m.age / m.life);
        const color = sideColor(m.side);
        return (
          <g key={m.key} className="map-marker" opacity={0.25 + 0.65 * fade}>
            <title>{m.label}</title>
            {m.kind === "fight" && (
              <>
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={4.2}
                  fill="none"
                  stroke={color}
                  strokeWidth="0.7"
                />
                {m.emphasis && (
                  <circle
                    cx={m.x}
                    cy={m.y}
                    r={5.8}
                    fill="none"
                    stroke="var(--brand)"
                    strokeWidth="0.5"
                  />
                )}
                {m.deaths > 0 && (
                  <text
                    x={m.x}
                    y={m.y - 5.2}
                    textAnchor="middle"
                    fontSize="2.8"
                    fontWeight="700"
                    fill={color}
                  >
                    −{m.deaths}
                  </text>
                )}
              </>
            )}
            {m.kind === "objective" && (
              <rect
                x={m.x - 2.6}
                y={m.y - 2.6}
                width="5.2"
                height="5.2"
                fill="none"
                stroke={color}
                strokeWidth="0.7"
              />
            )}
            {m.kind === "roshan" && (
              <>
                <circle cx={m.x} cy={m.y} r="3.2" fill="var(--brand)" opacity="0.25" />
                <circle
                  cx={m.x}
                  cy={m.y}
                  r="3.2"
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth="0.6"
                />
              </>
            )}
          </g>
        );
      })}

      {/* Where the fallen fell — an X at the fight's own coordinates, so a
          casualty in the feed is verifiable against the map. */}
      {[...casualties.values()].map((c) => (
        <g key={`x:${c.hero}:${c.t}`} opacity="0.75">
          <title>{`${c.hero} — fell at ${Math.floor(c.t / 60)}:${String(c.t % 60).padStart(2, "0")}`}</title>
          <path
            d={`M${c.x - 1.5},${c.y - 1.5} L${c.x + 1.5},${c.y + 1.5} M${c.x + 1.5},${c.y - 1.5} L${c.x - 1.5},${c.y + 1.5}`}
            stroke={sideColor(c.side)}
            strokeWidth="0.7"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      ))}

      {/* The ten heroes, drawn last so they ride on top of everything. Each
          token lives in a translated <g> (CSS px == SVG user units here) so
          moving it is a compositor-friendly transform, not a cx/cy relayout.
          No css transition: positionsAt already interpolates every frame. */}
      {ordered.map((h) => {
        const tag = tags.get(h.hero) ?? "??";
        const dead = casualties.has(h.hero);
        const color = h.side === "radiant" ? RADIANT : DIRE;
        const isFocused = focused === h.hero;
        const dim = focused !== null && !isFocused;
        return (
          <g
            key={`${h.side}:${h.hero}`}
            opacity={dim ? 0.3 : 1}
            onMouseEnter={() => onFocus?.(h.hero)}
            style={{ cursor: onFocus ? "pointer" : undefined }}
          >
            <title>
              {dead ? `${h.hero} — recently fell` : h.hero}
            </title>
            {h.nudged && (
              // The drawn dot is offset to keep labels readable; the hairline
              // points back at where the engine actually put it.
              <line
                x1={h.x}
                y1={h.y}
                x2={h.px}
                y2={h.py}
                stroke="var(--ink-3)"
                strokeWidth="0.3"
              />
            )}
            <g style={{ transform: `translate(${h.px}px, ${h.py}px)` }}>
              <circle
                r={isFocused ? 3.4 : 3.0}
                fill={dead ? "none" : color}
                stroke={isFocused ? "var(--brand)" : dead ? color : "var(--ink)"}
                strokeWidth={isFocused ? 0.9 : dead ? 0.8 : 0.5}
              />
              <text
                y="1.15"
                textAnchor="middle"
                fontSize="3.5"
                fontWeight="700"
                letterSpacing="-0.25"
                fill={dead ? color : "var(--bg)"}
                opacity={dead ? 0.75 : 1}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {tag}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
