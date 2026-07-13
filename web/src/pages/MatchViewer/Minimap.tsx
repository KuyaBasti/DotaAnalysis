import type { FallenStructure } from "./playback";

// Minimap v0: the classic square — Radiant bottom-left, Dire top-right, river
// on the diagonal. Towers/barracks/ancients render per side and gray out as
// the clock passes their fall. The sim destroys one structure per tier, tagged
// with a lane, so exactly that lane's dot goes dark.

const RADIANT = "#2e7d32";
const DIRE = "#c62828";
const DEAD = "#9e9e9e";

type Tier = "tier-1 tower" | "tier-2 tower" | "tier-3 tower";

// Hand-placed coordinates in a 0..100 box (y down), visually Dota-shaped.
const TOWERS: Record<
  "radiant" | "dire",
  Record<"top" | "mid" | "bot", Record<Tier, [number, number]>>
> = {
  radiant: {
    top: { "tier-1 tower": [12, 26], "tier-2 tower": [12, 46], "tier-3 tower": [14, 66] },
    mid: { "tier-1 tower": [42, 58], "tier-2 tower": [34, 66], "tier-3 tower": [27, 73] },
    bot: { "tier-1 tower": [74, 88], "tier-2 tower": [54, 88], "tier-3 tower": [34, 86] },
  },
  dire: {
    top: { "tier-1 tower": [26, 12], "tier-2 tower": [46, 12], "tier-3 tower": [66, 14] },
    mid: { "tier-1 tower": [58, 42], "tier-2 tower": [66, 34], "tier-3 tower": [73, 27] },
    bot: { "tier-1 tower": [88, 74], "tier-2 tower": [88, 54], "tier-3 tower": [86, 34] },
  },
};

const BARRACKS: Record<"radiant" | "dire", Record<"top" | "mid" | "bot", [number, number]>> = {
  radiant: { top: [13, 73], mid: [23, 78], bot: [28, 87] },
  dire: { top: [73, 13], mid: [78, 23], bot: [87, 28] },
};

const ANCIENT: Record<"radiant" | "dire", [number, number]> = {
  radiant: [18, 82],
  dire: [82, 18],
};

function fallenKeys(lost: FallenStructure[]): Set<string> {
  return new Set(lost.map((f) => `${f.structure}:${f.lane ?? "mid"}`));
}

export function Minimap({
  radiantLost,
  direLost,
  size = 210,
}: {
  radiantLost: FallenStructure[];
  direLost: FallenStructure[];
  size?: number;
}) {
  const lost = { radiant: fallenKeys(radiantLost), dire: fallenKeys(direLost) };
  const ancientDown = {
    radiant: radiantLost.some((f) => f.structure === "ancient"),
    dire: direLost.some((f) => f.structure === "ancient"),
  };

  const lanes = ["top", "mid", "bot"] as const;
  const tiers: Tier[] = ["tier-1 tower", "tier-2 tower", "tier-3 tower"];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Minimap: structures still standing"
      style={{ border: "1px solid #eee", borderRadius: 8, flexShrink: 0 }}
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
            stroke={down ? "#777" : "#fff"}
            strokeWidth="1"
            opacity={down ? 0.45 : 1}
          >
            <title>{`${side} ancient${down ? " (destroyed)" : ""}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
