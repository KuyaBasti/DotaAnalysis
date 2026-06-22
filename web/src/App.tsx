import { useState } from "react";
import { DraftStudio } from "./pages/DraftStudio";
import { MatchViewer } from "./pages/MatchViewer";
import { PatchExplorer } from "./pages/PatchExplorer";

type View = "draft" | "match" | "patches";

export function App() {
  const [view, setView] = useState<View>("draft");

  const tab = (id: View, label: string) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "0.4rem 0.8rem",
        border: "1px solid #ccc",
        borderRadius: 6,
        background: view === id ? "#222" : "#fff",
        color: view === id ? "#fff" : "#222",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>DraftMaster</h1>
      <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {tab("draft", "Draft Studio")}
        {tab("match", "Match Viewer")}
        {tab("patches", "Patch Explorer")}
      </nav>
      {view === "draft" ? (
        <DraftStudio />
      ) : view === "match" ? (
        <MatchViewer />
      ) : (
        <PatchExplorer />
      )}
    </main>
  );
}
