param([string]$Clone,[int]$Port,[string]$Scenario='scenario_archive_trial.lua')
# Cold-starts ONE isolated clone headless, asks the running engine for the player ship, and stops only its own process.
$ErrorActionPreference='Stop'
$dir="C:\ForgeCollaudo\T\$Clone"
if($Clone -notin @('e24','e26')) {throw 'Invalid clone'}
if(@(Get-Process EmptyEpsilon -ErrorAction SilentlyContinue).Count -gt 0) {throw 'An EE process is already running; not touching it'}
Remove-Item "$dir\EmptyEpsilon.log" -ErrorAction SilentlyContinue
$p=Start-Process -FilePath "$dir\EmptyEpsilon.exe" -ArgumentList @("headless=$Scenario","httpserver=$Port") -WorkingDirectory $dir -PassThru -WindowStyle Hidden
$report=[ordered]@{clone=$Clone;pid=$p.Id;port=$Port;scenario=$Scenario;started=(Get-Date).ToString('o')}
try {
 $ready=$false
 for($i=0;$i -lt 60;$i++) { Start-Sleep -Milliseconds 500
  try { $null=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body 'return "ready"' -TimeoutSec 1; $ready=$true; break } catch {} }
 if(!$ready) {throw 'Engine did not start'}
 $code='local s=getPlayerShip(-1); if s==nil then return "NO_SHIP" end; return s:getCallSign().."|"..s:getTypeName().."|hull="..tostring(s:getHullMax()).."|impulse="..tostring(s:getImpulseMaxSpeed())..""'
 $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body $code -TimeoutSec 5
 $report.ship=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
 $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body 'local s=getPlayerShip(-1); s:commandImpulse(1); return "ok"' -TimeoutSec 5
 Start-Sleep -Seconds 10
 $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body 'local s=getPlayerShip(-1);local x,y=s:getPosition();return tostring(x).."|"..tostring(y).."|time="..tostring(getScenarioTime())' -TimeoutSec 5
 $report.position=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
 $report.log=(Get-Content "$dir\EmptyEpsilon.log" -Tail 60) -join "`n"
 $report | ConvertTo-Json -Depth 4 | Set-Content "C:\ForgeCollaudo\T\archive-trial-$Clone.json"
 $report | ConvertTo-Json -Depth 4
} finally { if(!$p.HasExited){Stop-Process -Id $p.Id -Force} }
