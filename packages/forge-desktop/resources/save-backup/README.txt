EE FORGE - campaign save backup (optional)
==========================================

What this is
  A campaign saved by an EE FORGE scenario lives in ONE file: scriptstorage.json, in the folder EmptyEpsilon runs from
  (next to EmptyEpsilon.exe). The two checkpoint slots inside it are not two files, so they do not protect against a
  damaged or deleted file. forge-save-backup.ps1 makes dated copies of that file when YOU ask, and can put one back.

  It is not a service. Nothing runs in the background, nothing is installed, and you do not need it to play.
  It does not need EE FORGE, EXODUS or an internet connection.

What it does not do
  - It does not protect progress made after the last backup. A backup is the campaign as of the moment it was made.
  - Valid JSON is not a usable campaign. The tool checks that the file can be read as JSON. Whether a checkpoint inside it
    can be resumed is decided by the scenario when it starts (it checks the project, the structure and the format).
  - The file also holds the keys of other tools that use ScriptStorage; a restore brings their old values back too.
  - If scriptstorage.json is damaged as a whole, EmptyEpsilon presents an empty file to the scenario, which then looks like
    a first start, and the next write replaces the file. Make a backup BEFORE that happens; the scenario cannot tell you.

How to use it (Windows PowerShell; close EmptyEpsilon first)
  Open PowerShell in this folder, or run with:  powershell -ExecutionPolicy Bypass -File forge-save-backup.ps1 ...

  Make a backup (every call makes a NEW dated file; nothing is overwritten):
      .\forge-save-backup.ps1 backup -Source "C:\EmptyEpsilon\scriptstorage.json" -BackupDir "D:\EE-backups"

  See the backups and whether each one is valid JSON:
      .\forge-save-backup.ps1 list -BackupDir "D:\EE-backups"

  Check one file:
      .\forge-save-backup.ps1 check -Source "C:\EmptyEpsilon\scriptstorage.json"

  Restore a chosen backup (you name the backup AND the destination; you must type RESTORE):
      .\forge-save-backup.ps1 restore -Backup "D:\EE-backups\scriptstorage-20261012-181500.json" -Destination "C:\EmptyEpsilon\scriptstorage.json"

Guarantees it keeps
  - The source file is only read, never changed.
  - A backup is accepted only if the copy is valid JSON and identical to what was read. Otherwise no backup is kept.
  - If the source is damaged, no backup is made and the backups you already have are left untouched.
  - A restore keeps a copy of the file it replaces (scriptstorage.before-restore-<time>.json, next to it) and refuses to run
    while EmptyEpsilon is running from that folder. A backup refuses too, unless you add -AllowRunning (the copy can then catch
    the file in the middle of a write).
  - Nothing is ever restored automatically.

Exit codes: 0 done - 1 wrong use or stopped - 2 a file is not valid JSON (nothing written) - 3 EmptyEpsilon is running - 4 a step failed.
