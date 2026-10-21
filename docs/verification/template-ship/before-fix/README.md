# Before the fix (21 October 2026)

Reproduced through the editor's window (`e2e/collaudo/run-template-ship.mjs author`), isolated clones (`C:\ForgeCollaudo\T\e26`, `e24`), headless engines on private ports.

Sequence: Fleet → Original ships → Atlantis → **Copy into project** → rename the copy to "Atlantis Forge A" → edit hull/impulse/turn/beam →
click "Move these 1 to “Atlantis (ship_test_…)”" → new template "Scout Forge B" assigned to a second player ship → Save, close, reopen → Verify (0 errors, 1 warning)
→ Install scenario ("Installed — every file written and read back").

Observed: `FA-01` references **`Atlantis (ship_test_…)`**, the name the copy had *before* it was renamed. That template does not exist.
- EE 2026: the map aborts at the first ship; the only object is `FA-01` with components `callsign, custom_ship_functions, faction, player_control, scan_state, ship_log, transform` — no hull, no engines, no shields; `FB-01` is never built.
- EE 2024: `FA-01` does not exist; only `FB-01` (hull 321).
- The same project without `FA-01` (template B alone) loads and plays in 2026: hull 321. The templates file, the require line and the load order were never the problem.
