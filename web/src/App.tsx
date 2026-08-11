import type { ComponentType } from "react";
import { useState } from "react";
import { DraftStudio } from "./pages/DraftStudio";
import { MatchViewer } from "./pages/MatchViewer";
import { PatchExplorer } from "./pages/PatchExplorer";
import { IconDraft, IconMatch, IconPatch } from "./components/Icons";

type View = "draft" | "match" | "patches";

const NAV: { id: View; label: string; icon: ComponentType }[] = [
  { id: "draft", label: "Draft Studio", icon: IconDraft },
  { id: "match", label: "Match Viewer", icon: IconMatch },
  { id: "patches", label: "Patch Explorer", icon: IconPatch },
];

export function App() {
  const [view, setView] = useState<View>("draft");
  const [watchSimId, setWatchSimId] = useState<string | null>(null);

  // Draft Studio hands a freshly simulated match here; we jump to the viewer.
  const handleSimulated = (id: string) => {
    setWatchSimId(id);
    setView("match");
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mark">D</span>
          <div>
            <h1>DraftMaster</h1>
            <small>Dota 2 match simulator</small>
          </div>
        </div>

        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "on" : ""}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="foot">
          Deterministic engine
          <br />
          calibrated on ranked play
        </div>
      </aside>

      <main className="main">
        {view === "draft" ? (
          <DraftStudio onSimulated={handleSimulated} />
        ) : view === "match" ? (
          <MatchViewer initialSimId={watchSimId} />
        ) : (
          <PatchExplorer />
        )}
      </main>
    </div>
  );
}
