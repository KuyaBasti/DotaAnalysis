import type { Hero } from "../../types";

// The in-game order every Dota player expects: STR, AGI, INT, Universal.
export const ATTRIBUTE_ORDER = ["str", "agi", "int", "all"] as const;

export const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "Strength",
  agi: "Agility",
  int: "Intelligence",
  all: "Universal",
};

// Muted takes on the game's attribute colours (full saturation clashes with
// the Radiant/Dire green-red that carries meaning elsewhere). Tokens, so they
// re-tune with the theme rather than being fixed for one background.
export const ATTRIBUTE_COLORS: Record<string, string> = {
  str: "var(--attr-str)",
  agi: "var(--attr-agi)",
  int: "var(--attr-int)",
  all: "var(--attr-all)",
};

export interface AttributeGroup {
  attr: string;
  label: string;
  heroes: Hero[];
}

// Group heroes by primary attribute in game order, A-Z inside each group.
// Anything with an unrecognized attribute lands in Universal rather than
// vanishing from the picker.
export function groupByAttribute(heroes: Hero[]): AttributeGroup[] {
  const known = ATTRIBUTE_ORDER as readonly string[];
  return ATTRIBUTE_ORDER.map((attr) => ({
    attr,
    label: ATTRIBUTE_LABELS[attr],
    heroes: heroes
      .filter((h) =>
        known.includes(h.primary_attr) ? h.primary_attr === attr : attr === "all",
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  })).filter((group) => group.heroes.length > 0);
}
