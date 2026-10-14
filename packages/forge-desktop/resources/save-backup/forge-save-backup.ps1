<#
.SYNOPSIS
  EE FORGE campaign saves - optional, manual backup and restore of EmptyEpsilon's scriptstorage.json.

.DESCRIPTION
  A campaign saved by an EE FORGE scenario lives in ONE file: scriptstorage.json, in the folder EmptyEpsilon runs from.
  The two checkpoint slots inside it are not two files, so they do not protect against a damaged or deleted file. This tool
  makes dated copies of that file, on request, and can put one back. It is not a service: nothing runs in the background,
  nothing is installed, and it is not needed to play.

  backup   copy the file to a new dated file (never over an older one); the copy is accepted only if it is valid JSON
  list     show the backups in a folder and whether each is valid JSON
  check    say whether a file is valid JSON and which Forge campaigns it holds
  restore  put a chosen backup in place of the file, after keeping a copy of the file it replaces

  Close EmptyEpsilon first. A backup made while the game runs can catch the file half written; restore is refused while the
  game runs. A backup holds the campaign as of the moment it was made: progress after the last backup is not protected.

  VALID JSON IS NOT A USABLE CAMPAIGN. This tool only checks that the file can be read as JSON. Whether a checkpoint inside it
  can be resumed is decided by the scenario when it starts (it also checks the project and its structure).

  The file also holds the keys of other tools that use ScriptStorage; a restore brings their old values back too.

.EXAMPLE
  .\forge-save-backup.ps1 backup  -Source "C:\EmptyEpsilon\scriptstorage.json" -BackupDir "D:\EE-backups"
.EXAMPLE
  .\forge-save-backup.ps1 list    -BackupDir "D:\EE-backups"
.EXAMPLE
  .\forge-save-backup.ps1 check   -Source "C:\EmptyEpsilon\scriptstorage.json"
.EXAMPLE
  .\forge-save-backup.ps1 restore -Backup "D:\EE-backups\scriptstorage-20261012-181500.json" -Destination "C:\EmptyEpsilon\scriptstorage.json"

  Exit codes: 0 done - 1 wrong use - 2 a file is not valid JSON (nothing was written) - 3 EmptyEpsilon is running - 4 a step failed (read the message).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)][ValidateSet('backup', 'list', 'check', 'restore')][string]$Action,
  [string]$Source,
  [string]$BackupDir,
  [string]$Backup,
  [string]$Destination,
  [string]$ConfirmText,
  [switch]$AllowRunning
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Fail([int]$code, [string]$message) { Write-Host $message -ForegroundColor Red; exit $code }
function Say([string]$message) { Write-Host $message }

function Read-Shared([string]$path) {
  # Opened for reading with sharing, so it never blocks or alters whoever else has the file open.
  $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $ms = New-Object System.IO.MemoryStream
    $stream.CopyTo($ms)
    return , $ms.ToArray()
  } finally { $stream.Dispose() }
}

function Test-StoreBytes([byte[]]$bytes) {
  $result = [ordered]@{ Valid = $false; Reason = ''; Keys = 0; Campaigns = @(); Other = 0 }
  if ($bytes.Length -eq 0) { $result.Reason = 'the file is empty'; return [pscustomobject]$result }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  try { $doc = $text | ConvertFrom-Json } catch { $result.Reason = 'not valid JSON (' + $_.Exception.Message + ')'; return [pscustomobject]$result }
  if ($null -eq $doc -or $doc -isnot [System.Management.Automation.PSCustomObject]) { $result.Reason = 'valid JSON, but not an object of keys (EmptyEpsilon writes an object)'; return [pscustomobject]$result }
  $names = @($doc.PSObject.Properties.Name)
  $result.Valid = $true
  $result.Keys = $names.Count
  $campaigns = @()
  foreach ($n in $names) {
    if ($n -match '^forge/([^/]+)/(c\d+)/head$') { $campaigns += ($Matches[1] + ':' + $Matches[2]) } elseif ($n -notmatch '^forge/') { $result.Other++ }
  }
  $result.Campaigns = $campaigns
  return [pscustomobject]$result
}

function Describe([object]$info) {
  if (-not $info.Valid) { return "NOT usable: $($info.Reason)" }
  $c = if ($info.Campaigns.Count -eq 0) { 'no Forge campaign' } else { $info.Campaigns -join ', ' }
  return "valid JSON, $($info.Keys) keys; Forge campaigns: $c; keys of other tools: $($info.Other)"
}

function Sha([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-RunningGame([string]$folder) {
  $found = @()
  foreach ($p in @(Get-Process -Name 'EmptyEpsilon' -ErrorAction SilentlyContinue)) {
    $path = $null
    try { $path = $p.Path } catch { $path = $null }
    if ($null -eq $path) { $found += "EmptyEpsilon (pid $($p.Id), folder unknown)" }
    elseif ((Split-Path -Parent $path) -ieq $folder) { $found += "EmptyEpsilon (pid $($p.Id))" }
  }
  return $found
}

function New-UniquePath([string]$dir, [string]$stem, [string]$ext) {
  $path = Join-Path $dir ($stem + $ext)
  $n = 2
  while (Test-Path -LiteralPath $path) { $path = Join-Path $dir ("$stem-$n$ext"); $n++ }
  return $path
}

function Write-New([string]$path, [byte[]]$bytes) {
  # CreateNew: an existing file is never overwritten, whatever happened between the name being chosen and now.
  $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

switch ($Action) {
  'check' {
    if (-not $Source) { Fail 1 'check needs -Source <file>.' }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { Fail 1 "No such file: $Source" }
    $info = Test-StoreBytes (Read-Shared $Source)
    Say $Source
    Say ('  ' + (Describe $info))
    Say '  This only says the file can be read as JSON. It does not say a campaign inside it can be resumed.'
    if (-not $info.Valid) { exit 2 }
    exit 0
  }
  'list' {
    if (-not $BackupDir) { Fail 1 'list needs -BackupDir <folder>.' }
    if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) { Fail 1 "No such folder: $BackupDir" }
    $files = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'scriptstorage-*.json' -File | Sort-Object Name)
    if ($files.Count -eq 0) { Say 'No backups in this folder.'; exit 0 }
    foreach ($f in $files) { Say ("{0}  {1,9} bytes  {2}" -f $f.Name, $f.Length, (Describe (Test-StoreBytes (Read-Shared $f.FullName)))) }
    Say 'Valid JSON is not proof that a campaign inside can be resumed.'
    exit 0
  }
  'backup' {
    if (-not $Source -or -not $BackupDir) { Fail 1 'backup needs -Source <scriptstorage.json> and -BackupDir <folder>: both are chosen by you, nothing is guessed.' }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { Fail 1 "No such file: $Source" }
    $sourceFull = (Resolve-Path -LiteralPath $Source).Path
    $running = @(Get-RunningGame (Split-Path -Parent $sourceFull))
    if ($running.Count -gt 0 -and -not $AllowRunning) { Fail 3 ("EmptyEpsilon is running ($($running -join '; ')). Close it first, so the file is not copied half written. (-AllowRunning copies anyway; the copy is still checked, but it can be a moment in the middle of a write.)") }
    $bytes = Read-Shared $sourceFull
    $info = Test-StoreBytes $bytes
    if (-not $info.Valid) { Fail 2 ("The source is NOT usable: $($info.Reason).`nNo backup was made. Backups already in the folder were not touched. The source was not modified.") }
    if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $target = New-UniquePath $BackupDir "scriptstorage-$stamp" '.json'
    try {
      Write-New $target $bytes
      $back = Read-Shared $target
      if ((Sha $back) -ne (Sha $bytes) -or -not (Test-StoreBytes $back).Valid) { throw 'the copy does not match the source after writing' }
    } catch {
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
      Fail 4 "The backup failed ($($_.Exception.Message)). No copy was kept. The source was not modified."
    }
    Add-Content -LiteralPath (Join-Path $BackupDir 'backups.log') -Value ("{0}`t{1}`t{2}`t{3} bytes`t{4}" -f (Get-Date).ToString('s'), $sourceFull, (Split-Path -Leaf $target), $bytes.Length, (Sha $bytes))
    Say "Backup made: $target"
    Say ('  ' + (Describe $info))
    Say "  SHA-256 $(Sha $bytes)"
    Say '  It holds the campaign as of now; progress made after this moment is not protected. Valid JSON is not proof that the campaign can be resumed.'
    if ($running.Count -gt 0) { Say '  EmptyEpsilon was running: if this matters, make the copy again with the game closed.' }
    exit 0
  }
  'restore' {
    if (-not $Backup -or -not $Destination) { Fail 1 'restore needs -Backup <backup file> and -Destination <scriptstorage.json>: you choose both; nothing is restored by default.' }
    if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { Fail 1 "No such backup: $Backup" }
    $destFull = [System.IO.Path]::GetFullPath($Destination)
    $destDir = Split-Path -Parent $destFull
    if (-not (Test-Path -LiteralPath $destDir -PathType Container)) { Fail 1 "The destination folder does not exist: $destDir" }
    if ((Split-Path -Leaf $destFull) -ine 'scriptstorage.json') { Fail 1 'The destination must be a file named scriptstorage.json (the file EmptyEpsilon reads).' }
    $running = @(Get-RunningGame $destDir)
    if ($running.Count -gt 0) { Fail 3 ("EmptyEpsilon is running ($($running -join '; ')). Restoring while the game can rewrite the file is refused, with no override. Close the game and run this again.") }
    $bytes = Read-Shared $Backup
    $info = Test-StoreBytes $bytes
    if (-not $info.Valid) { Fail 2 ("The chosen backup is NOT usable: $($info.Reason).`nNothing was changed.") }
    Say "Backup     : $Backup"
    Say ('             ' + (Describe $info))
    Say "Destination: $destFull"
    if (Test-Path -LiteralPath $destFull -PathType Leaf) { Say ('             now: ' + (Describe (Test-StoreBytes (Read-Shared $destFull)))) } else { Say '             (no file there now)' }
    Say ''
    Say 'This REPLACES the destination file with the backup. Everything written after the backup was made is lost,'
    Say 'and so are the newer values of every other tool that keeps keys in this file. A copy of the file being replaced is kept first.'
    $answer = $ConfirmText
    if (-not $answer) { $answer = Read-Host 'Type RESTORE to go on, anything else to stop' }
    if ($answer -cne 'RESTORE') { Say 'Stopped. Nothing was changed.'; exit 1 }
    $kept = $null
    if (Test-Path -LiteralPath $destFull -PathType Leaf) {
      $current = Read-Shared $destFull
      $kept = New-UniquePath $destDir ('scriptstorage.before-restore-' + (Get-Date).ToString('yyyyMMdd-HHmmss')) '.json'
      try {
        Write-New $kept $current
        if ((Sha (Read-Shared $kept)) -ne (Sha $current)) { throw 'the safety copy does not match' }
      } catch { Fail 4 "Could not keep a copy of the file being replaced ($($_.Exception.Message)). Nothing was changed." }
    }
    $temp = Join-Path $destDir 'scriptstorage.json.restore-tmp'
    try {
      if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
      Write-New $temp $bytes
      Move-Item -LiteralPath $temp -Destination $destFull -Force
      if ((Sha (Read-Shared $destFull)) -ne (Sha $bytes)) { throw 'the file in place does not match the backup' }
    } catch {
      if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
      $hint = if ($kept) { " The file that was there is kept as $kept." } else { '' }
      Fail 4 "The restore failed ($($_.Exception.Message)).$hint"
    }
    Say "Restored. $destFull now matches the backup (SHA-256 $(Sha $bytes))."
    if ($kept) { Say "The file it replaced is kept as: $kept" }
    Say 'Whether the campaign inside can be resumed is decided when the scenario starts.'
    exit 0
  }
}
