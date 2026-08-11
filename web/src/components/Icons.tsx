/* Inline stroke icons — no icon dependency for three glyphs.
 * All 24x24, currentColor, so they inherit nav state colours for free. */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Draft Studio — two rosters facing each other. */
export function IconDraft() {
  return (
    <svg {...base}>
      <path d="M4 6h6M4 12h6M4 18h6" />
      <path d="M14 6h6M14 12h6M14 18h6" />
    </svg>
  );
}

/** Match Viewer — a play head. */
export function IconMatch() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5z" />
    </svg>
  );
}

/** Patch Explorer — a stack of records. */
export function IconPatch() {
  return (
    <svg {...base}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </svg>
  );
}

export function IconAlert() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16.2v.1" />
    </svg>
  );
}
