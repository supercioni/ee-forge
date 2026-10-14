# 0037 — The ship preview is a likeness from the asset manifest

**Status:** Accepted.
**Date:** 2026-08-12 (Phase 5 STEP 39).

## Context

The ship-template editor shows a hull's numbers. Two of them — beam arc and
direction — are geometry, and a table of degrees is a poor way to see that
a 90° arc at direction 180 is a rear battery. Those are drawn from the
numbers, in SVG, and need no decision.

The 3D view does. EE's meshes are its own `.model` format, which nothing in
EXODUS can render; what EXODUS has is `assets/ee-ships/*.glb`, converted
per **stock template** by `scripts/extract-ee-meshes.py` and indexed in
`assets/manifest.json` under `${eeClass}:${templateName}` (ADR-0020). A
template being authored has no entry, and its `ModelData` names a `.model`
file.

## Decision

**The preview shows the glTF the manifest has for this template, or
nothing.** The lookup walks the `copyOf` chain and stops at the first name
the manifest knows — so a variant of a stock hull shows that hull, which is
what an author tuning its numbers wants — and falls back to the chain's
last name even when that template is not in the project, which is exactly
the "copies a stock hull" case. When nothing matches, the panel says so.

It is labelled a likeness, and when it came from an ancestor the panel
names which one. It is **not** a render of the project's own `ModelData`,
and it does not try to be.

**three.js is loaded lazily.** `ShipPreview3D` is behind `React.lazy`, so
the renderer is a chunk fetched when the Ship view opens and never
otherwise: the editor's main bundle stays at ~340 KB (97 KB gzipped) and
the 3D chunk is ~911 KB (247 KB gzipped) beside it.

## Alternatives considered

**Guess a mesh when nothing matches** — nearest stock template by class, or
a generic hull. Rejected: a preview showing a different ship, silently, is
worse than no preview. The author would tune arcs against the wrong
silhouette and never know.

**Convert the project's own `ModelData` mesh at build time.** The honest
answer, and the only one that previews a genuinely new hull. Rejected as
its own step: it needs a `.model` reader in the toolkit and a conversion
step in the editor's loop, neither of which STEP 39 needs to make ship
templates authorable.

**Skip 3D entirely.** Tempting — the arc diagram carries most of the value.
Rejected because the assets already exist and the lazy chunk costs nothing
to anyone not looking at a ship.

## Consequences

- `@exodus/web-forge` gains `three`, `@react-three/fiber` and
  `@react-three/drei`, matching the versions `web-viewer` already pins.
- The resolver lives in `@exodus/ee-forge/editor` with tests, not in the
  React component, per the package's own rule — including a test that a
  copy cycle terminates and one that an unknown hull answers null rather
  than something.
- The preview normalises the model to fill its box, ignoring the manifest's
  `radius`. The viewer needs EE's true footprint because it composes a
  scene; this needs a hull that reads whether it is a fighter or a
  dreadnought.
