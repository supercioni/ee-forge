param([string]$Clone,[int]$Port)
$ErrorActionPreference='Stop'
$dir="C:\ForgeCollaudo\T\$Clone"
if($Clone -notin @('e24','e26')) {throw 'Invalid clone'}
if(@(Get-Process EmptyEpsilon -ErrorAction SilentlyContinue).Count -gt 0) {throw 'An EE process is already running'}
$p=Start-Process -FilePath "$dir\EmptyEpsilon.exe" -ArgumentList @('headless=scenario_model_workshop_trial.lua',"httpserver=$Port") -WorkingDirectory $dir -PassThru -WindowStyle Hidden
$report=@{clone=$Clone;pid=$p.Id;port=$Port;started=(Get-Date).ToString('o')}
try {
 $ready=$false
 for($i=0;$i -lt 20;$i++) {
  Start-Sleep -Milliseconds 500
  try { $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body 'return "ready"' -TimeoutSec 1; $ready=$true; break } catch {}
 }
 if(!$ready) {throw 'Engine did not start'}
 $code='local s=getPlayerShip(-1); if s==nil then return "NO_SHIP" end; s:commandImpulse(1); return s:getCallSign().."|"..s:getTypeName().."|"..tostring(s:getHullMax()).."|"..tostring(s:getImpulseMaxSpeed())'
 $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body $code -TimeoutSec 5
 $report.ship=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
 Start-Sleep -Seconds 15
 $r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body 'local s=getPlayerShip(-1);local x,y=s:getPosition();return tostring(x).."|"..tostring(y).."|time="..tostring(getScenarioTime()).."|health="..tostring(s:getSystemHealth("impulse"))' -TimeoutSec 5
 $report.position=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
 $report.log=(Get-Content "$dir\EmptyEpsilon.log" -Tail 40) -join "`n"
 $report | ConvertTo-Json -Depth 4 | Set-Content "C:\ForgeCollaudo\T\model-trial-$Clone.json"
 $report | ConvertTo-Json -Depth 4
} finally { if(!$p.HasExited){Stop-Process -Id $p.Id -Force} }
