# Windows release 0.9.2 — 21 October 2026

Built with `BUILD_DIR=/mnt/c/ForgeBuild-0.9.2 bash scripts/windows-clean-build.sh`.
The clean source copy includes the current Model workshop changes. Windows Node and
frozen pnpm dependencies built all five packages before NSIS packaging.

- File: `packages/forge-desktop/release/EE-FORGE-Setup-0.9.2-x64.exe`
- Bytes: 103420982
- SHA-256: `0ff7c750d8b70d250d2b4a10963d4af0dbf339120f68b7da5f2b2031218db5cd`
- Windows x64; unsigned.
- `verify-package`: passed (archive contents, licences, forbidden paths/files).
- Embedded `app.asar/package.json` version: 0.9.2.
- ModelViewport, model-geometry and import-model renderer modules: present.
- Final copied installer hash matches the Windows build report.
- `git diff --check`: passed.

The earlier source/runtime verification remains in README.md. This release step did
not repeat the GUI/engine suite or exercise the installation/update wizard. The
installed user application and installer 0.9.1 remain unchanged. No commit made.
