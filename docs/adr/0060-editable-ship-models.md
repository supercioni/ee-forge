# ADR-0060 — Editable ship model definitions and a geometry-based preview

Status: implemented in the development build, 21 October 2026.

The existing project schema emits ModelData but Fleet exposes only a model name and a legacy template-based likeness. The install scanner drops offsets, collision boxes and emitters. This prevents faithful editing of a copied hull.

## Decision

Expose a model workbench from Fleet/Hull. Stock definitions remain read-only. Customising creates a uniquely named project ModelData and assigns it to the chosen project template atomically; it does not redefine the stock model. Editing a shared project model explicitly lists its users. Preserve actual mesh and material references, scale, collision radius/box, render offset, beam/tube origins and engine emitter position/colour/size. Read the engine definitions fully; unknown expressions must be reported, never replaced by plausible geometry.

Use the selected installation's mesh/resources, including resource packs (ADR-0061 replaced the copied cache by live reading and added the model source choice). The app does not redistribute the engine's meshes. A preview is keyed by model/installation, not by ship template name. The user explicitly requested external import. Support OBJ plus PNG/JPG using bounded, namespaced base64 resources embedded in the project; this preserves portability through existing JSON project import. Build files carry an explicit binary encoding and resources destination; export and transactional install decode exactly the same bytes. GLB/glTF/MTL are not accepted as EE-native assets.

Display a fixed-coordinate 3D view with orbit controls, reset/fit, collision overlays and selectable emitter markers. Numeric fields remain available. Camera fitting must not cancel the visible effect of edits to model scale. Rendering is a positioning aid, not an exact reproduction of EE's lighting/particle simulation.

Keep existing launch-time model-before-template installation and restart requirements. Validate with both pinned catalogs. Normal maps are target-specific (2026 supports setNormalMap; 2024 does not); unsupported settings must produce actionable errors, not disappear silently.

Emitter colours use the engine's floating-point RGB convention. Existing authored values must not be silently rescaled; explain legacy out-of-range values and validate new input. Existing projects without the new model fields must still load with unchanged exports.

## Validation required

Scanner fidelity for both engines; edited/copied model lifecycle; correct naming and references; matching Lua; actual resource preview; save/reopen; installation and cold restart on isolated 2024/2026 engines. Existing user changes and installations are preserved.

## Evidence and limits

See [verification](../verification/model-workshop/README.md) and [user guide](../authoring/ship-model-workshop.md). Normal maps remain an explicit target limitation. Particle guides are not a simulation, and model points are edited numerically, not dragged.
