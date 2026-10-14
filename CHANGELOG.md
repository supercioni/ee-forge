# Changelog

## 0.9.0
- Campaign saves: frozen sectors, checkpoints in EmptyEpsilon's `scriptstorage.json`, resume after closing the game (EE 2024.12.08 and 2026.09.22PR).
- A resume that cannot happen is never replaced silently: damaged / incompatible saves block the start and a new campaign is an explicit choice.
- Honest save wording ("sent to the save file"), the engineer's power/coolant sliders restored, and a concrete list of what a resume does not give back.
- Optional campaign-save backup utility (`Save backup tool`, PowerShell) installed beside the program.
- Project schema 5 (older projects are migrated on import; the original is never modified).

## 0.8.0
- The crew's mines, probes and missiles no longer follow a jump between sectors.

## 0.7.x and earlier
- Sectors and Change sector, visibility/lock tools, the installer and desktop shell, the editor itself.
