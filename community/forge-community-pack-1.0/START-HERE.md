# EE FORGE Community Pack 1.0

**The Lantern Route — an English vanilla mission and editable teaching example.**

You can play without Forge, EXODUS, a web server, an HTTP server or a game master.
Use EmptyEpsilon **2024.12.08** or **2026.09.22PR**. The two exports are separate: choose the folder for your engine. This is not a promise about every 2026 prerelease.

## Play in five steps

1. Find your EmptyEpsilon installation (the folder containing `EmptyEpsilon.exe`).
2. Copy **all three Lua files** from `play/2024/scripts/` or `play/2026/scripts/` into its `scripts` folder. Keep the names unchanged. Do not mix versions.
3. Start EmptyEpsilon, host a game and select **The Lantern Route**. Set **Campaign = New** for your first deliberate playthrough. Choose **Off** if you do not want checkpoints.
4. Select the player ship **LANTERN-1** and your crew stations. Relay hails **PORT LANTERN** and selects **Read mission orders**.
5. Follow the station conversation. Read `PLAYERS.md` for crew instructions or `WALKTHROUGH.md` for the full solution.

No ship-template patch, custom asset, EXODUS service or special hardware is needed. Forge is an authoring tool, not the game server.

## Learn and edit

Open `manual/Forge-User-Guide.pdf` or the offline HTML edition. The Markdown is also included.
Use **Forge 0.9.0 or a later build supporting project schema 5**. Import
`projects/2024/lantern_route/project.json` or `projects/2026/lantern_route/project.json` **as a copy**.
The documents have the same project id; keep them in separate workspaces if importing both. They differ only in the target engine.

The guide covers map editing, groups and sectors, rules, victory/defeat, dialogues, ship templates, campaign saves, verification and export. It includes exercises using this mission.

## Save and resume

Campaign checkpoints belong to the **EmptyEpsilon host installation**, not Forge and not the client computers. Choose **Resume** to resume the latest campaign for this project. **New** creates a new campaign beside the old one; it does not overwrite it. There is no campaign-slot browser in this example.

Checkpoints are requested at campaign start, sector transitions and archive download. Engineering also has **Save checkpoint**. The engine cannot confirm disk-write success; the next restart is the meaningful check. A restart is not a perfect ship snapshot: loaded missiles, launched objects, scans and several tactical settings are not restored. Read the manual before relying on saves. Do not transfer a save between the two engine versions.

## Package contents

| Folder or file | Use |
| --- | --- |
| `manual/` | English guide, PDF, HTML, Markdown and screenshots |
| `play/2024/`, `play/2026/` | Ready-to-copy vanilla exports |
| `projects/2024/`, `projects/2026/` | Editable Forge source documents |
| `PLAYERS.md` | Crew briefing |
| `WALKTHROUGH.md` | Solution and authoring notes |
| `verification/TEST-REPORT.md` | What was tested and what was not |
| `SHA256SUMS.txt` | Checksums for the files in this pack |

## Sharing

Share the ZIP intact so players receive the matching scripts and instructions. The pack does not contain EmptyEpsilon executables, an installer, saved games or standalone game assets. Screenshots depict the editor and game resources. No licence for the Forge software or EmptyEpsilon is granted by this documentation; consult their respective distributions. This pack is a community example, not an official EmptyEpsilon release.
