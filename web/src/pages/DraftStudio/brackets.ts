// Rank bands, mirroring pipeline/dm_pipeline/features/brackets.py and the
// API's winProbModel BRACKETS. Keep the keys in sync with those.

export const BRACKET_KEYS = ["all", "low", "mid", "high"] as const;
export type BracketKey = (typeof BRACKET_KEYS)[number];

export const BRACKET_LABELS: Record<BracketKey, string> = {
  all: "All ranks",
  low: "Herald–Crusader",
  mid: "Archon–Legend",
  high: "Ancient+",
};

/** Human label for a bracket key, tolerant of unknown/missing values. */
export function bracketLabel(key: string | undefined): string {
  if (!key) return BRACKET_LABELS.all;
  return BRACKET_LABELS[key as BracketKey] ?? key;
}
