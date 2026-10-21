param([string]$Clone, [string]$Scenario, [int]$Http, [string]$PidFile)
$dir = "C:\ForgeCollaudo\T\$Clone"
$p = Start-Process -FilePath "$dir\EmptyEpsilon.exe" -ArgumentList @("headless=$Scenario", "httpserver=$Http") -WorkingDirectory $dir -PassThru -WindowStyle Hidden
Set-Content -Path $PidFile -Value $p.Id
"pid=$($p.Id)"
