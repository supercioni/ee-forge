import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EEMarker, EEObject, Vec2 } from "@forge/contracts";
import {
  applyMarquee,
  markersInRect,
  brushAt,
  objectsInRect,
  rectBetween,
  shownGroups,
  shownMarkers,
  sweepableGroups,
  type Brush,
  type WorldRect,
} from "@forge/core/editor";
import { useEditor, useEffectivePrefs } from "../store/editor.js";
import { useIconUsable } from "./icon-availability.js";
import {
  iconMaskId,
  iconRotates,
  iconSize,
  radarIconFor,
  radarIconUrl,
} from "./icons.js";
import {
  NEBULA_OPACITY,
  nebulaClipId,
  nebulaTextureFor,
  nebulaTextureUrl,
} from "./nebulae.js";
import {
  CLOUD_OPACITY,
  atmosphereBand,
  atmosphereCss,
  planetClipId,
  planetCloudMaskId,
  planetTextureUrl,
} from "./planets.js";
import {
  GAME_UNITS_PER_U,
  boundsOf,
  footprintRadius,
  formatU,
  gridStep,
  factionColors,
  objectColor,
  screenToWorld,
  snapTo,
  worldToScreen,
  type Camera,
} from "./geometry.js";

/**
 * The map canvas — a top-down view of one EE system in game units.
 *
 * SVG rather than a 2D context: hit-testing, selection outlines and
 * crisp scaling come free, and a map is tens-to-hundreds of objects, not
 * thousands. If a project ever outgrows that, this is the file to swap.
 *
 * Axes match EE exactly (x right, y south). Flipping y here would produce
 * maps that mirror in game, which is the kind of bug that costs a session.
 */

/**
 * What the pointer is doing.
 *
 * Split by button, not by what is under the cursor: **right drags the
 * map, left works on objects.** That is the level-editor convention and
 * it removes the old ambiguity where a drag on empty space could only
 * ever mean "pan", leaving no gesture for selecting several things at
 * once.
 *
 * A discriminated union rather than one record with unused fields, so a
 * pan cannot carry a stale `lastWorld` and a band cannot carry a camera.
 */
type DragState =
  | { readonly kind: "pan"; readonly startScreen: Vec2; readonly startCamera: Vec2 }
  /** Moving the selection; `lastWorld` accumulates the delta. */
  | { readonly kind: "move"; readonly lastWorld: Vec2 }
  /** Rubber band, in world units so the maths matches where objects live. */
  | {
      readonly kind: "marquee";
      readonly startWorld: Vec2;
      readonly currentWorld: Vec2;
      readonly additive: boolean;
    };

export function MapCanvas(): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewport, setViewport] = useState<Vec2>({ x: 1200, y: 800 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<Vec2>({ x: 0, y: 0 });

  const project = useEditor((s) => s.project);
  const activeGroupId = useEditor((s) => s.activeGroupId);
  const selection = useEditor((s) => s.selection);
  const markerSelection = useEditor((s) => s.markerSelection);
  const selectMarkers = useEditor((s) => s.selectMarkers);
  const camera = useEditor((s) => s.camera);
  const library = useEditor((s) => s.library);
  const snap = useEditor((s) => s.snap);
  const setSnap = useEditor((s) => s.setSnap);
  const tool = useEditor((s) => s.tool);
  const brush = useEditor((s) => s.brush);
  const setTool = useEditor((s) => s.setTool);
  const setCamera = useEditor((s) => s.setCamera);
  const select = useEditor((s) => s.select);
  // While something is being picked every sector is on screen, so a reference can reach across sectors.
  const viewPrefs = useEffectivePrefs();
  const openSector = useEditor((s) => s.viewPrefs.sector);
  const viewNotice = useEditor((s) => s.viewNotice);
  const dismissViewNotice = useEditor((s) => s.dismissViewNotice);
  const showAllGroups = useEditor((s) => s.showAllGroups);
  const exitIsolation = useEditor((s) => s.exitIsolation);
  const toggleGroupHidden = useEditor((s) => s.toggleGroupHidden);
  const byRuleGroups = useMemo(
    () => new Set((project?.map.groups ?? []).filter((g) => g.when === "on_call").map((g) => g.id)),
    [project],
  );
  const placeAt = useEditor((s) => s.placeAt);
  const scatterAt = useEditor((s) => s.scatterAt);
  const pick = useEditor((s) => s.pick);
  const resolvePick = useEditor((s) => s.resolvePick);
  const cancelPick = useEditor((s) => s.cancelPick);
  const returnTo = useEditor((s) => s.returnTo);
  const returnToPrevious = useEditor((s) => s.returnToPrevious);
  const moveSelection = useEditor((s) => s.moveSelection);
  const deleteSelection = useEditor((s) => s.deleteSelection);

  useEffect(() => {
    const element = svgRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setViewport({ x: entry.contentRect.width, y: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Never eat a Delete the author meant for a text field.
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if (event.key === "Escape") {
        select([]);
        cancelPick();
        // Also disarms a place or scatter tool: Escape means "never mind",
        // and an armed brush is the thing most in need of a way out.
        setTool({ kind: "select" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelPick, deleteSelection, select, setTool]);

  // Only what the author has left on the map is drawn, hit-tested, swept and fitted: a hidden group is not
  // "drawn faintly and ignored", it is not here at all (footprints, textures, labels, orbits and arcs all start
  // from this list).
  const objects = useMemo(
    () =>
      project === null
        ? []
        : shownGroups(project, viewPrefs).flatMap((group) =>
            group.objects.map((object) => ({ object, groupId: group.id })),
          ),
    [project, viewPrefs],
  );
  const markers = useMemo(() => (project === null ? [] : shownMarkers(project, viewPrefs)), [project, viewPrefs]);
  const lockedGroups = useMemo(() => new Set(viewPrefs.locked), [viewPrefs.locked]);
  // Selected objects that the map is not showing (a hidden group's, reached from the list or a reference).
  const unseenSelection = useMemo(() => {
    if (project === null || selection.length === 0) return null;
    const shown = new Set(objects.map((o) => o.object.id));
    const unseen = selection.filter((id) => !shown.has(id));
    if (unseen.length === 0) return null;
    const groups = new Map<string, string>();
    for (const group of project.map.groups) for (const o of group.objects) if (unseen.includes(o.id)) groups.set(group.id, group.label);
    return { count: unseen.length, groups: [...groups] };
  }, [objects, project, selection]);

  const pointerWorld = useCallback(
    (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): Vec2 => {
      const rect = svgRef.current?.getBoundingClientRect();
      const local = {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      };
      return screenToWorld(camera, viewport, local);
    },
    [camera, viewport],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>): void => {
      const rect = svgRef.current?.getBoundingClientRect();
      const local = {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      };
      const before = screenToWorld(camera, viewport, local);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const scale = Math.min(0.05, Math.max(0.000004, camera.scale * factor));
      const after = screenToWorld({ ...camera, scale }, viewport, local);
      // Keep the world point under the cursor pinned while zooming.
      setCamera({
        scale,
        center: {
          x: camera.center.x + (before.x - after.x),
          y: camera.center.y + (before.y - after.y),
        },
      });
    },
    [camera, setCamera, viewport],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      const world = pointerWorld(event);
      const target = event.target as SVGElement;
      const hitId = target.getAttribute("data-object-id");
      const hitMarker = target.getAttribute("data-marker-id");

      const snapped =
        snap > 0 ? { x: snapTo(world.x, snap), y: snapTo(world.y, snap) } : world;

      // Right button pans, wherever it lands — including on top of an
      // object, so the map can be moved without first finding empty space.
      if (event.button === 2) {
        setDrag({
          kind: "pan",
          startScreen: { x: event.clientX, y: event.clientY },
          startCamera: camera.center,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      // Everything below is the left button's business.
      if (event.button !== 0) return;

      // A narrative form is waiting for something to be chosen. Answer it
      // and go back — the author asked a question, not for a tool.
      if (pick !== null) {
        if (pick.want === "point") {
          resolvePick({ kind: "point", position: snapped });
        } else if (hitId !== null) {
          resolvePick({ kind: "object", objectId: hitId });
        }
        return;
      }

      if (tool.kind === "place" || tool.kind === "marker") {
        placeAt(snapped);
        return;
      }

      if (tool.kind === "scatter") {
        scatterAt(snapped);
        return;
      }

      if (hitMarker !== null) {
        // Markers are their own namespace, so selecting one clears the
        // object selection rather than joining it — an id can mean a
        // different thing on each side.
        const additive = event.shiftKey;
        const next = additive
          ? markerSelection.includes(hitMarker)
            ? markerSelection.filter((id) => id !== hitMarker)
            : [...markerSelection, hitMarker]
          : markerSelection.includes(hitMarker)
            ? markerSelection
            : [hitMarker];
        if (!additive) select([]);
        selectMarkers(next);
        setDrag({ kind: "move", lastWorld: world });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (hitId !== null) {
        const additive = event.shiftKey;
        const next = additive
          ? selection.includes(hitId)
            ? selection.filter((id) => id !== hitId)
            : [...selection, hitId]
          : selection.includes(hitId)
            ? selection
            : [hitId];
        select(next);
        if (!additive) selectMarkers([]);
        setDrag({ kind: "move", lastWorld: world });
      } else {
        // A band, not a pan. A click with no drag is a zero-size band that
        // catches nothing, which is exactly the old "click empty to clear".
        setDrag({
          kind: "marquee",
          startWorld: world,
          currentWorld: world,
          additive: event.shiftKey,
        });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [
      camera.center,
      pick,
      pointerWorld,
      placeAt,
      resolvePick,
      scatterAt,
      select,
      selectMarkers,
      selection,
      markerSelection,
      snap,
      tool.kind,
    ],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      const world = pointerWorld(event);
      setHover(world);
      if (drag === null) return;

      if (drag.kind === "pan") {
        const dx = (event.clientX - drag.startScreen.x) / camera.scale;
        const dy = (event.clientY - drag.startScreen.y) / camera.scale;
        setCamera({
          scale: camera.scale,
          center: { x: drag.startCamera.x - dx, y: drag.startCamera.y - dy },
        });
        return;
      }

      if (drag.kind === "marquee") {
        setDrag({ ...drag, currentWorld: world });
        return;
      }

      const snapped =
        snap > 0 ? { x: snapTo(world.x, snap), y: snapTo(world.y, snap) } : world;
      const last =
        snap > 0
          ? { x: snapTo(drag.lastWorld.x, snap), y: snapTo(drag.lastWorld.y, snap) }
          : drag.lastWorld;
      const delta = { x: snapped.x - last.x, y: snapped.y - last.y };
      if (delta.x !== 0 || delta.y !== 0) {
        moveSelection(delta);
        setDrag({ ...drag, lastWorld: world });
      }
    },
    [camera.scale, drag, moveSelection, pointerWorld, setCamera, snap],
  );

  const onPointerUp = useCallback((): void => {
    if (drag?.kind === "marquee" && project !== null) {
      const rect = rectBetween(drag.startWorld, drag.currentWorld);
      // The band takes what it sweeps and can be moved: hidden and locked groups are not swept.
      select(applyMarquee(selection, objectsInRect(sweepableGroups(project, viewPrefs), rect), drag.additive));
      // …whichever list the id belongs to.
      selectMarkers(
        applyMarquee(markerSelection, markersInRect(markers, rect), drag.additive),
      );
    }
    setDrag(null);
  }, [drag, markerSelection, markers, project, select, selectMarkers, selection, viewPrefs]);

  const zoomToFit = useCallback((): void => {
    // What is actually on the map: the shown groups' objects and the markers, nothing hidden.
    const own = boundsOf(objects.map((o) => o.object));
    const bounds =
      markers.length === 0
        ? own
        : {
            min: {
              x: Math.min(own?.min.x ?? Infinity, ...markers.map((m) => m.position.x)),
              y: Math.min(own?.min.y ?? Infinity, ...markers.map((m) => m.position.y)),
            },
            max: {
              x: Math.max(own?.max.x ?? -Infinity, ...markers.map((m) => m.position.x)),
              y: Math.max(own?.max.y ?? -Infinity, ...markers.map((m) => m.position.y)),
            },
          };
    if (bounds === null) return;
    const width = Math.max(bounds.max.x - bounds.min.x, GAME_UNITS_PER_U);
    const height = Math.max(bounds.max.y - bounds.min.y, GAME_UNITS_PER_U);
    setCamera({
      center: { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 },
      scale: Math.min(viewport.x / (width * 1.2), viewport.y / (height * 1.2)),
    });
  }, [markers, objects, setCamera, viewport]);

  const step = gridStep(camera.scale);
  const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, viewport, viewport);

  const gridLines: JSX.Element[] = [];
  for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
    const sx = worldToScreen(camera, viewport, { x, y: 0 }).x;
    gridLines.push(
      <line
        key={`gx${x}`}
        x1={sx}
        y1={0}
        x2={sx}
        y2={viewport.y}
        className={x === 0 ? "grid-axis" : "grid-line"}
      />,
    );
  }
  for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
    const sy = worldToScreen(camera, viewport, { x: 0, y }).y;
    gridLines.push(
      <line
        key={`gy${y}`}
        x1={0}
        y1={sy}
        x2={viewport.x}
        y2={sy}
        className={y === 0 ? "grid-axis" : "grid-line"}
      />,
    );
  }

  const selected = new Set(selection);
  const byId = new Map(objects.map((entry) => [entry.object.id, entry.object]));
  // EE's own faction colours (`setGMColor`), project overriding install.
  // Built here rather than per object: a scattered belt is hundreds of
  // them and each would otherwise scan the faction list.
  const factions = factionColors(project, library);

  // One mask per distinct sprite, reused by every object that wears it.
  // maskContentUnits="objectBoundingBox" scales the sprite to whatever
  // rect references it, so a single def serves every position and size.
  const usedIcons = [
    ...new Set(
      objects
        .map(({ object }) => radarIconFor(object, library))
        .filter((icon): icon is string => icon !== null),
    ),
  ];

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={`map-canvas ${
          tool.kind === "place" || tool.kind === "scatter" || pick !== null ? "placing" : ""
        }`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Without this, the right-drag that pans also pops the browser's
        // menu the moment the button comes up.
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          {usedIcons.map((icon) => (
            <mask key={icon} id={iconMaskId(icon)} maskContentUnits="objectBoundingBox">
              <image
                href={radarIconUrl(icon)}
                width="1"
                height="1"
                preserveAspectRatio="none"
              />
            </mask>
          ))}
        </defs>

        <g className="grid">{gridLines}</g>

        {/* Footprints first so markers and labels stay readable on top. */}
        <g className="footprints">
          {objects.map(({ object }) => {
            const radius = footprintRadius(object);
            if (radius === null) return null;
            const screen = worldToScreen(camera, viewport, object.position);
            const r = Math.max(radius * camera.scale, 1);

            if (object.type === "Planet") {
              return (
                <PlanetDisc key={`fp-${object.id}`} object={object} centre={screen} radius={r} />
              );
            }

            if (object.type === "Nebula") {
              return (
                <NebulaDisc key={`fp-${object.id}`} object={object} centre={screen} radius={r} />
              );
            }

            return (
              <circle
                key={`fp-${object.id}`}
                cx={screen.x}
                cy={screen.y}
                r={r}
                fill={objectColor(object, factions)}
                fillOpacity={0.12}
                stroke={objectColor(object, factions)}
                strokeOpacity={0.45}
                data-object-id={object.id}
              />
            );
          })}
        </g>

        <g className="zones">
          {objects.map(({ object }) =>
            object.type === "Zone" ? (
              <polygon
                key={`zone-${object.id}`}
                points={object.points
                  .map((p) => {
                    const s = worldToScreen(camera, viewport, p);
                    return `${s.x},${s.y}`;
                  })
                  .join(" ")}
                fill={objectColor(object, factions)}
                fillOpacity={0.08}
                stroke={objectColor(object, factions)}
                strokeDasharray="6 4"
                data-object-id={object.id}
              />
            ) : null,
          )}
        </g>

        <g className="orbits">
          {objects.map(({ object }) => {
            if (object.type !== "Planet" || object.orbit === null) return null;
            const parent = byId.get(object.orbit.targetId);
            if (parent === undefined) return null;
            const centre = worldToScreen(camera, viewport, parent.position);
            const dx = object.position.x - parent.position.x;
            const dy = object.position.y - parent.position.y;
            return (
              <circle
                key={`orbit-${object.id}`}
                cx={centre.x}
                cy={centre.y}
                r={Math.hypot(dx, dy) * camera.scale}
                fill="none"
                stroke="#5c6bc0"
                strokeOpacity={0.5}
                strokeDasharray="3 5"
              />
            );
          })}
        </g>

        {/* What the armed brush would drop, under the cursor. Derived from
            the same `brushAt` the click uses, so the outline cannot promise
            a shape the scatter won't produce. */}
        {tool.kind === "scatter" && (
          <BrushPreview
            brush={brushAt(brush, snap > 0 ? snapTo2(hover, snap) : hover)}
            camera={camera}
            viewport={viewport}
          />
        )}

        <g className="markers">
          {objects.map(({ object, groupId }) => (
            <ObjectMarker
              key={object.id}
              object={object}
              icon={radarIconFor(object, library)}
              camera={camera}
              viewport={viewport}
              selected={selected.has(object.id)}
              locked={lockedGroups.has(groupId)}
              dimmed={activeGroupId !== null && groupId !== activeGroupId}
              byRule={byRuleGroups.has(groupId)}
              factions={factions}
            />
          ))}
        </g>

        {/* Named places (ADR-0038). Drawn above the objects because a
            marker is a handle to grab, and under the band because the band
            is what is catching it. A crosshair rather than a sprite: EE
            draws nothing here, and a glyph that looked like a contact
            would promise something players will never see. */}
        <g className="place-markers">
          {markers.map((marker) => (
            <PlaceMarker
              key={marker.id}
              marker={marker}
              camera={camera}
              viewport={viewport}
              selected={markerSelection.includes(marker.id)}
            />
          ))}
        </g>

        {/* The band, drawn last so it reads over the markers it is
            catching. Screen-space, from the same world corners the
            selection is computed from — the outline and the catch cannot
            disagree. */}
        {drag?.kind === "marquee" && (
          <MarqueeBox
            rect={rectBetween(drag.startWorld, drag.currentWorld)}
            camera={camera}
            viewport={viewport}
          />
        )}
      </svg>

      {pick !== null && (
        <div className="pick-banner">
          <span>
            {pick.prompt}
            {openSector !== null ? " Every sector is shown while you choose." : ""}
          </span>
          <button type="button" className="small" onClick={cancelPick}>
            Cancel (Esc)
          </button>
        </div>
      )}

      <div className="sector-chip" role="status" data-testid="sector-chip">
        {viewPrefs.sector === null
          ? "All sectors"
          : `${project?.map.sectors.find((s) => s.id === viewPrefs.sector)?.label ?? "Sector"} + Shared`}
      </div>

      {(viewPrefs.isolated !== null || unseenSelection !== null || viewNotice !== null) && pick === null && (
        <div className="view-banners">
          {viewNotice !== null && (
            <div className="view-banner" role="status">
              <span>{viewNotice}</span>
              <button type="button" className="small" onClick={dismissViewNotice}>
                Dismiss
              </button>
            </div>
          )}
          {viewPrefs.isolated !== null && (
            <div className="view-banner" role="status">
              <span>
                Showing only <strong>{project?.map.groups.find((g) => g.id === viewPrefs.isolated)?.label ?? "one group"}</strong>.
              </span>
              <button type="button" className="small" onClick={exitIsolation}>
                Exit isolation
              </button>
              <button type="button" className="small" onClick={showAllGroups}>
                Show all
              </button>
            </div>
          )}
          {unseenSelection !== null && (
            <div className="view-banner warn" role="status">
              <span>
                {unseenSelection.count === 1 ? "The selected object is" : `${unseenSelection.count} selected objects are`} not on the map: its group is hidden
                {viewPrefs.isolated !== null ? " by isolation" : ""}. It cannot be changed until it is shown.
              </span>
              {viewPrefs.isolated === null &&
                unseenSelection.groups.map(([id, label]) => (
                  <button key={id} type="button" className="small" onClick={() => toggleGroupHidden(id)}>
                    Show “{label}”
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {returnTo !== null && pick === null && (
        <div className="pick-banner return-banner" role="region" aria-label="Opened from another view">
          <span>Opened from {returnTo.label}.</span>
          <button type="button" className="small" onClick={returnToPrevious}>
            ← Back to {returnTo.label}
          </button>
        </div>
      )}

      <div className="canvas-hud">
        <span>
          {formatU(hover.x)} / {formatU(hover.y)}
        </span>
        <span>grid {formatU(step)}</span>
        <button type="button" onClick={zoomToFit}>
          Fit
        </button>
        <label className="inline">
          Snap
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
            <option value={0}>off</option>
            <option value={100}>0.1U</option>
            <option value={500}>0.5U</option>
            <option value={1000}>1U</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function snapTo2(point: Vec2, step: number): Vec2 {
  return { x: snapTo(point.x, step), y: snapTo(point.y, step) };
}

/**
 * The armed brush's footprint, drawn where it would land.
 *
 * Without it, choosing a centre by clicking would still be guesswork:
 * "Radius 15000" says nothing about whether the belt clears the station.
 */
function BrushPreview({
  brush,
  camera,
  viewport,
}: {
  brush: Brush;
  camera: Camera;
  viewport: Vec2;
}): JSX.Element {
  const ring = (center: Vec2, radius: number, key: string): JSX.Element => {
    const screen = worldToScreen(camera, viewport, center);
    return (
      <circle
        key={key}
        cx={screen.x}
        cy={screen.y}
        r={Math.max(radius * camera.scale, 1)}
        className="brush-preview"
      />
    );
  };

  if (brush.kind === "belt") {
    return (
      <g className="brush-preview-layer">
        {ring(brush.center, brush.innerRadius, "inner")}
        {ring(brush.center, brush.outerRadius, "outer")}
      </g>
    );
  }

  if (brush.kind === "cluster") {
    return <g className="brush-preview-layer">{ring(brush.center, brush.radius, "cluster")}</g>;
  }

  const corner = worldToScreen(camera, viewport, brush.origin);
  return (
    <g className="brush-preview-layer">
      <rect
        x={corner.x}
        y={corner.y}
        width={brush.width * camera.scale}
        height={brush.height * camera.scale}
        className="brush-preview"
      />
    </g>
  );
}

/**
 * A nebula filled with one of EE's own cloud billboards.
 *
 * Blended with `screen` rather than laid on flat: `Nebula1.png` has no
 * alpha channel at all, so the dark parts of the file would otherwise
 * punch a black hole in the map. Screen makes dark add nothing and bright
 * glow, which is also how EE composites them.
 *
 * The 5 U outline stays visible on top — it is the interference radius a
 * crew actually feels, and a cloud with soft edges cannot express it.
 */
function NebulaDisc({
  object,
  centre,
  radius,
}: {
  object: Extract<EEObject, { type: "Nebula" }>;
  centre: Vec2;
  radius: number;
}): JSX.Element {
  const color = objectColor(object);
  const clipId = nebulaClipId(object.id);
  const textureUrl = nebulaTextureUrl(nebulaTextureFor(object.id));
  const textureUsable = useIconUsable(textureUrl);

  return (
    <g>
      <circle
        cx={centre.x}
        cy={centre.y}
        r={radius}
        fill={color}
        fillOpacity={0.1}
        data-object-id={object.id}
      />

      <clipPath id={clipId}>
        <circle cx={centre.x} cy={centre.y} r={radius} />
      </clipPath>
      {textureUsable && <image
        href={textureUrl}
        x={centre.x - radius}
        y={centre.y - radius}
        width={radius * 2}
        height={radius * 2}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${clipId})`}
        opacity={NEBULA_OPACITY}
        style={{ mixBlendMode: "screen" }}
        data-object-id={object.id}
      />}

      <circle
        cx={centre.x}
        cy={centre.y}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.45}
        data-object-id={object.id}
      />
    </g>
  );
}

/**
 * A planet drawn as EE renders it: the surface texture inside the body,
 * ringed by its atmosphere colour.
 *
 * The atmosphere is a band taken **out of** the disc, not added around it
 * — the planet still ends exactly at its true radius, so the map keeps
 * telling the truth about overlaps, while the colour gets enough width to
 * be read against a busy surface.
 *
 * The texture is clipped to the surface rather than tiled as a pattern, so
 * a 2:1 equirectangular map crops to its centre band instead of squashing
 * — and the base disc underneath keeps the planet visible and clickable
 * when a texture is missing or hasn't loaded yet.
 */
function PlanetDisc({
  object,
  centre,
  radius,
}: {
  object: Extract<EEObject, { type: "Planet" }>;
  centre: Vec2;
  radius: number;
}): JSX.Element {
  const base = objectColor(object);
  const clipId = planetClipId(object.id);
  const cloudMaskId = planetCloudMaskId(object.id);
  const band = atmosphereBand(radius);
  const surface = Math.max(radius - band, 0.5);
  // SVG renders a broken-image glyph when a texture is absent. Reuse the install-scoped
  // availability probe used by radar sprites, leaving the clickable base disc visible.
  const surfaceUsable = useIconUsable(object.surfaceTexture === null ? null : planetTextureUrl(object.surfaceTexture));
  const cloudsUsable = useIconUsable(object.cloudTexture === null ? null : planetTextureUrl(object.cloudTexture));

  return (
    <g>
      <circle
        cx={centre.x}
        cy={centre.y}
        r={surface}
        fill={base}
        fillOpacity={0.18}
        data-object-id={object.id}
      />

      {object.surfaceTexture !== null && surfaceUsable && (
        <>
          <clipPath id={clipId}>
            <circle cx={centre.x} cy={centre.y} r={surface} />
          </clipPath>
          <image
            href={planetTextureUrl(object.surfaceTexture)}
            x={centre.x - surface}
            y={centre.y - surface}
            width={surface * 2}
            height={surface * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
            data-object-id={object.id}
          />
        </>
      )}

      {object.cloudTexture !== null && cloudsUsable && (
        <>
          {/* Luminance mask, not an overlaid image: EE's cloud maps are
              greyscale with no alpha, so painting the file on would lay a
              black film over half the planet. White becomes cloud, black
              becomes nothing — the layer EE actually composites. Cropped
              like the surface below it, so the two stay aligned. */}
          <mask id={cloudMaskId}>
            <image
              href={planetTextureUrl(object.cloudTexture)}
              x={centre.x - surface}
              y={centre.y - surface}
              width={surface * 2}
              height={surface * 2}
              preserveAspectRatio="xMidYMid slice"
            />
          </mask>
          <circle
            cx={centre.x}
            cy={centre.y}
            r={surface}
            fill="#ffffff"
            opacity={CLOUD_OPACITY}
            mask={`url(#${cloudMaskId})`}
            data-object-id={object.id}
          />
        </>
      )}

      {/* Stroked at the band's midline so its outer edge lands on the
          true radius. A planet with no atmosphere colour keeps the same
          geometry, dimmer — the difference between "unset" and "set to
          something dark" should be visible. */}
      <circle
        cx={centre.x}
        cy={centre.y}
        r={radius - band / 2}
        fill="none"
        stroke={atmosphereCss(object.atmosphereColor, base)}
        strokeWidth={band}
        strokeOpacity={object.atmosphereColor === null ? 0.45 : 0.95}
        data-object-id={object.id}
      />
    </g>
  );
}

function ObjectMarker({
  object,
  icon,
  camera,
  viewport,
  selected,
  locked,
  dimmed,
  byRule,
  factions,
}: {
  object: EEObject;
  /** EE radar sprite, or null for types the canvas draws geometrically. */
  icon: string | null;
  camera: Camera;
  viewport: Vec2;
  selected: boolean;
  /** In a locked group: drawn as usual and inspectable, but never moved, deleted or edited. */
  locked: boolean;
  dimmed: boolean;
  /** In a group a rule spawns (`on_call`): drawn with a dashed amber ring, so what appears later reads apart from what starts. */
  byRule: boolean;
  factions: ReadonlyMap<string, string>;
}): JSX.Element {
  const screen = worldToScreen(camera, viewport, object.position);
  const color = objectColor(object, factions);
  // A sprite that is not in the install (or not scanned yet) must not make the object vanish.
  const spriteUsable = useIconUsable(icon === null ? null : radarIconUrl(icon));
  if (!spriteUsable) icon = null;
  const half = icon === null ? (object.type === "PlayerSpaceship" ? 9 : 6) : iconSize(object) / 2;
  // Only the rotating types carry a rotation field at all, so narrow
  // rather than reaching for it on the union.
  const spin =
    iconRotates(object) && "rotation" in object
      ? `rotate(${object.rotation ?? 0} ${screen.x} ${screen.y})`
      : undefined;

  // A planet's textured disc is its own marker once it outgrows the dot —
  // drawing one on top would only hide the surface. Zoomed far out the
  // disc shrinks to nothing, and the dot takes over so it stays clickable.
  const disc = object.type === "Planet" ? object.radius * camera.scale : 0;
  const extent = Math.max(half, disc);

  return (
    <g opacity={dimmed ? 0.35 : 1} data-spawn={byRule ? "rule" : "start"} data-locked={locked ? "true" : undefined}>
      {byRule && <circle cx={screen.x} cy={screen.y} r={extent + 3} className="rule-ring" />}
      {selected && (
        <circle cx={screen.x} cy={screen.y} r={extent + 6} className={locked ? "selection-ring locked" : "selection-ring"} />
      )}
      {selected && locked && <LockGlyph x={screen.x + extent + 8} y={screen.y - extent - 8} />}

      {disc > half ? null : icon !== null ? (
        // EE's own sprite, tinted through a mask: the trace art is white on
        // transparent, so the rect's fill becomes the icon's colour.
        <rect
          x={screen.x - half}
          y={screen.y - half}
          width={half * 2}
          height={half * 2}
          fill={color}
          mask={`url(#${iconMaskId(icon)})`}
          transform={spin}
          data-object-id={object.id}
        />
      ) : object.type === "SpaceStation" ? (
        <rect
          x={screen.x - half}
          y={screen.y - half}
          width={half * 2}
          height={half * 2}
          fill={color}
          transform={`rotate(45 ${screen.x} ${screen.y})`}
          data-object-id={object.id}
        />
      ) : (
        <circle cx={screen.x} cy={screen.y} r={half} fill={color} data-object-id={object.id} />
      )}

      {object.callsign !== null && camera.scale > 0.0008 && (
        <text x={screen.x + extent + 4} y={screen.y + 4} className="marker-label">
          {object.callsign}
        </text>
      )}
    </g>
  );
}

/** The rubber band, in screen space. */
/**
 * A named place on the canvas.
 *
 * The generous transparent hit circle is deliberate: the crosshair is thin
 * on purpose (it must not read as a contact) and a thin thing is a thing
 * you cannot grab.
 */
function PlaceMarker({
  marker,
  camera,
  viewport,
  selected,
}: {
  marker: EEMarker;
  camera: Camera;
  viewport: Vec2;
  selected: boolean;
}): JSX.Element {
  const screen = worldToScreen(camera, viewport, marker.position);
  const arm = 7;
  return (
    <g className={selected ? "place-marker selected" : "place-marker"}>
      <circle
        cx={screen.x}
        cy={screen.y}
        r={12}
        fill="transparent"
        data-marker-id={marker.id}
      />
      <circle
        cx={screen.x}
        cy={screen.y}
        r={5}
        className="place-marker-ring"
        data-marker-id={marker.id}
      />
      <line
        x1={screen.x - arm}
        y1={screen.y}
        x2={screen.x + arm}
        y2={screen.y}
        className="place-marker-arm"
      />
      <line
        x1={screen.x}
        y1={screen.y - arm}
        x2={screen.x}
        y2={screen.y + arm}
        className="place-marker-arm"
      />
      <text x={screen.x + 11} y={screen.y - 8} className="place-marker-label">
        {marker.label}
      </text>
    </g>
  );
}

/** A small padlock beside a selected object of a locked group. */
function LockGlyph({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g className="lock-glyph" transform={`translate(${x} ${y})`} aria-hidden="true">
      <rect x={-5} y={-1} width={10} height={8} rx={1.5} />
      <path d="M-3 -1 V-3.5 a3 3 0 0 1 6 0 V-1" />
    </g>
  );
}

function MarqueeBox({
  rect,
  camera,
  viewport,
}: {
  rect: WorldRect;
  camera: Camera;
  viewport: Vec2;
}): JSX.Element | null {
  const min = worldToScreen(camera, viewport, rect.min);
  const max = worldToScreen(camera, viewport, rect.max);
  const width = max.x - min.x;
  const height = max.y - min.y;
  // A click is a zero-size band: drawing it would flash a dot on every
  // click that clears the selection.
  if (width < 2 && height < 2) return null;
  return (
    <rect className="marquee" x={min.x} y={min.y} width={width} height={height} />
  );
}
