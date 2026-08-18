// Map geometry, shared by the minimap and the pure selectors in playback.ts.
// Hand-placed coordinates in a 0..100 box (y down), visually Dota-shaped:
// Radiant bottom-left, Dire top-right, river on the diagonal.
//
// This lives apart from Minimap.tsx because playback.ts needs the same tables
// to place objective markers, and playback.ts must stay React-free.

export type Side = "radiant" | "dire";
export type Lane = "top" | "mid" | "bot";
export type Tier = "tier-1 tower" | "tier-2 tower" | "tier-3 tower";

export const TOWERS: Record<Side, Record<Lane, Record<Tier, [number, number]>>> = {
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

export const BARRACKS: Record<Side, Record<Lane, [number, number]>> = {
  radiant: { top: [13, 73], mid: [23, 78], bot: [28, 87] },
  dire: { top: [73, 13], mid: [78, 23], bot: [87, 28] },
};

export const ANCIENT: Record<Side, [number, number]> = {
  radiant: [18, 82],
  dire: [82, 18],
};

// The engine emits no coordinates for Roshan, so the pit is placed once here:
// top river, on the Dire side of the diagonal, like the real map's pre-7.23
// pit. Approximate by construction — it marks the event, not a measurement.
export const ROSHAN_PIT: [number, number] = [22, 14];

// Where a destroyed structure sits, for dropping a marker onto it. Returns null
// for a structure/lane pair the tables don't know (older sims, odd payloads).
export function structurePoint(
  side: Side,
  structure: string,
  lane: string | null,
): [number, number] | null {
  if (structure === "ancient") return ANCIENT[side];
  const l = (lane ?? "mid") as Lane;
  if (structure === "barracks") return BARRACKS[side][l] ?? null;
  const tier = TOWERS[side][l];
  if (!tier) return null;
  return tier[structure as Tier] ?? null;
}
