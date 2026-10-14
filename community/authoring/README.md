# Reproduce the community pack

Run from an already built EXODUS_EE2026 checkout. These are maintainer tools; players need only the pack's three Lua files for their engine.

```
node community/authoring/create-demo.mjs "$PWD" /tmp/forge-community-generated
node community/authoring/check-demo.mjs "$PWD" /tmp/forge-community-generated
```

The generator uses each target's real catalog and matching scanned library (`projects/libraries/EE-2024.12.08.json`, `projects/ee-library.json` for 2026). It fails on warnings rather than publishing them silently. Do not point its output at someone else's project folder.

`live-trial.mjs YEAR HTTP_PORT REPORT_DIRECTORY` is a **local test harness**, not a portable player launcher. It expects an isolated Windows clone at `C:\ForgeCommunityTrial\YEAR`, its dedicated `trial-pid.txt`, and the existing `C:\ForgeCommunityTrial\launch.ps1`. It talks to `windows.host`, and stops/restarts only a PID whose executable path exactly matches the selected clone. Before using it, inspect the script, provide isolated engines, copy the matching bundle, preserve any previous clone save, and start with a fresh clone campaign. Never aim it at a user's running game. The 2024 executable is unmodified and uses its fixed default multiplayer port: verify that no other EE is running before launching it. Engine executables are not distributed.

PDF generation uses Pandoc to make HTML with `guide.css`, then Chromium via `agent-browser pdf`. Screenshots are the actual browser editor at 1500 × 1000. No image-generation mockups were used.

The original staging directory disappeared across sessions. On 14 October the documents and project source were reconstructed, then the final outputs were rebuilt and tested again. Earlier session results are not used as evidence for this release. Final material is now persisted under `community/forge-community-pack-1.0/`.
