# ADR-0047 — Forge contracts and core independent of EXODUS

**Status:** accepted, 2026-10-02 (increment 2 of the autonomous Forge plan).

## Decision

Forge's schemas and toolkit move into two neutral packages:

- `@forge/contracts` (`packages/forge-contracts`): the project, library, catalog, DMX,
  asset-manifest and editor-service schemas plus the primitives they use. `zod` only.
- `@forge/core` (`packages/forge-core`, formerly `@exodus/ee-forge`): validation, catalogs,
  codegen, simulator, DMX, scanner, project migration. Depends on contracts and `zod`.

EXODUS keeps working through adapters: `@exodus/shared` re-exports `@forge/contracts`
(and `ship.ts` re-exports the three primitives from it), `@exodus/ee-forge` re-exports
`@forge/core` and `@forge/core/editor`. The dependency arrow is EXODUS → Forge only.

## Alternatives

- Leave schemas in `@exodus/shared` and only rename the toolkit: rejected — the toolkit
  would still depend transitively on every EXODUS schema (cockpit, mechanisms, commands).
- Duplicate the Forge schemas into the new package: rejected — two sources diverge.
- Move `ship.ts` wholesale: rejected — only `Vec2`, `ShipSystemName`, `AlertLevel` are
  needed; the rest of the ship snapshot is EXODUS.

## Project document versioning

`project.json` gains `schemaVersion` (1). Unversioned files are version 0 and migrate
deterministically (`PROJECT_MIGRATIONS`), newer documents are refused. Import also moves
fields the schema does not model into `unmodelled` (found in the real projects:
`serpents_coil` carries ship stats and faction fields no schema revision models) because
Zod would strip them on the next save. Legacy shape rewrites that already live in the
schema (`dockClasses` merge, bare `{x,y}` point) stay in the schema; they are
normalisations, not loss, and the strict check runs after them.

## Consequences

- `@exodus/ee-forge` is a shim and can be deleted once nothing imports it.
- Independence is tested on the real dependency graph and import specifiers
  (`packages/forge-core/test/independence.test.ts`), not on package names.
- Bundles are byte-identical before/after for the four projects on both targets.
