import { useEffect } from "react";
import { MapCanvas } from "./canvas/MapCanvas.js";
import { Mission } from "./panels/Mission.js";
import { Inspector } from "./panels/Inspector.js";
import { LogicInspector } from "./panels/LogicInspector.js";
import { ScenePanel } from "./panels/ScenePanel.js";
import { DesktopHost } from "./panels/DesktopPanels.js";
import { ProblemsDock } from "./panels/ProblemsDock.js";
import { DialogueTable } from "./panels/DialogueTable.js";
import { DmxView } from "./panels/DmxView.js";
import { ShipView } from "./panels/ShipView.js";
import { Simulator } from "./panels/Simulator.js";
import { StatusBar, Toolbar } from "./panels/Toolbar.js";
import { useEditor } from "./store/editor.js";
import { Splitter } from "./ui/Splitter.js";
import { MAP_LEFT, MAP_RIGHT, NARRATIVE_RIGHT } from "./ui/split.js";
import { useColumnCap } from "./ui/useColumnCap.js";
import { useCollapsed } from "./ui/useCollapsed.js";
import { useColumnWidth } from "./ui/useColumnWidth.js";

/**
 * The views onto one document — Map, Mission, Fleet, Dialogues — and the separate DMX rig.
 *
 * They are separate rather than one crowded screen because the questions
 * are different — "where is everything", "what happens when", "what is
 * this hull" — but they stay one project, and the narrative's references
 * to the map are followed by switching views, not by retyping ids.
 */
function AppViews(): JSX.Element {
  const bootstrap = useEditor((s) => s.bootstrap);
  const view = useEditor((s) => s.view);
  const pick = useEditor((s) => s.pick);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const [mapLeft, setMapLeft] = useColumnWidth("mapLeft", MAP_LEFT);
  const [mapRight, setMapRight] = useColumnWidth("mapRight", MAP_RIGHT);
  const [narrativeRight, setNarrativeRight] = useColumnWidth("narrativeRight", NARRATIVE_RIGHT);
  // Folding a side panel is its own remembered fact: the width the author chose is left alone, so unfolding brings it back.
  const [leftFolded, setLeftFolded] = useCollapsed("mapLeft");
  const [rightFolded, setRightFolded] = useCollapsed("mapRight");

  // A pending pick always shows the map, whichever view asked for it.
  const showMap = view === "map" || pick !== null;

  // Side columns are the author's to resize, but never so wide that a 900 px window is left with no work area:
  // each is also capped at a share of the window, so the centre keeps at least ~40% of it.
  const cap = useColumnCap();

  let content: JSX.Element;
  if (view === "ship" && pick === null) {
    content = <ShipView />;
  } else if (view === "dmx" && pick === null) {
    // The rig is not a scenario: no map, no groups, no inspector — just the room's lights and what they would
    // be doing right now (ADR-0040).
    content = <DmxView />;
  } else if (showMap) {
    content = (
      <div
        className="workspace"
        style={{
          gridTemplateColumns: `${leftFolded ? "34px" : cap(mapLeft, 26)} ${leftFolded ? "0px" : "6px"} 1fr ${rightFolded ? "0px" : "6px"} ${rightFolded ? "34px" : cap(mapRight, 30)}`,
        }}
      >
        <aside className={`left${leftFolded ? " folded" : ""}`} aria-label="Scene panel">
          {leftFolded ? (
            <button type="button" className="rail-button" aria-expanded={false} onClick={() => setLeftFolded(false)} title="Show the scene panel">
              <span aria-hidden="true">›</span>
              <span className="rail-label">Scene</span>
              <span className="sr-only">Show the scene panel</span>
            </button>
          ) : (
            <>
              <div className="aside-bar">
                <button type="button" className="small" aria-expanded={true} aria-label="Hide the scene panel" title="Hide the scene panel" onClick={() => setLeftFolded(true)}>
                  <span aria-hidden="true">‹</span>
                </button>
              </div>
              <ScenePanel />
            </>
          )}
        </aside>
        {leftFolded ? (
          <div />
        ) : (
          <Splitter side="left" width={mapLeft} onChange={setMapLeft} spec={MAP_LEFT} label="Palette column width" />
        )}
        <main>
          <MapCanvas />
        </main>
        {rightFolded ? (
          <div />
        ) : (
          <Splitter side="right" width={mapRight} onChange={setMapRight} spec={MAP_RIGHT} label="Inspector column width" />
        )}
        <aside className={`right${rightFolded ? " folded" : ""}`} aria-label="Inspector panel">
          {rightFolded ? (
            <button type="button" className="rail-button" aria-expanded={false} onClick={() => setRightFolded(false)} title="Show the inspector">
              <span aria-hidden="true">‹</span>
              <span className="rail-label">Inspector</span>
              <span className="sr-only">Show the inspector</span>
            </button>
          ) : (
            <>
              <div className="aside-bar">
                <button type="button" className="small" aria-expanded={true} aria-label="Hide the inspector" title="Hide the inspector" onClick={() => setRightFolded(true)}>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              <Inspector />
            </>
          )}
        </aside>
      </div>
    );
  } else if (view === "dialogues") {
    // Conversations are their own view: a graph of lines and replies, edited with the same record editors a rule uses.
    content = (
      <div className="workspace narrative" style={{ gridTemplateColumns: `1fr 6px ${cap(narrativeRight, 40)}` }}>
        <main className="narrative-main">
          <DialogueTable />
        </main>
        <Splitter side="right" width={narrativeRight} onChange={setNarrativeRight} spec={NARRATIVE_RIGHT} label="Side column width" />
        <aside className="right">
          <LogicInspector />
        </aside>
      </div>
    );
  } else {
    content = (
      <div className="workspace narrative" style={{ gridTemplateColumns: `1fr 6px ${cap(narrativeRight, 40)}` }}>
        <main className="narrative-main">
          <Mission />
        </main>
        <Splitter side="right" width={narrativeRight} onChange={setNarrativeRight} spec={NARRATIVE_RIGHT} label="Side column width" />
        <aside className="right">
          <LogicInspector />
          <Simulator />
        </aside>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      {content}
      <ProblemsDock />
      <StatusBar />
    </div>
  );
}

/** The editor, plus the desktop host (dialogs, unsaved-work guard), mounted once whichever view is showing. */
export function App(): JSX.Element {
  return (
    <>
      <AppViews />
      <DesktopHost />
    </>
  );
}
