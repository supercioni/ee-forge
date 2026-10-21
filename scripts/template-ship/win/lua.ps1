param([int]$Port, [string]$File)
$code = [IO.File]::ReadAllText($File)
try { $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/exec.lua" -Body ([Text.Encoding]::UTF8.GetBytes($code)) -TimeoutSec 20; [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) } catch { "HTTPERR " + $_.Exception.Message }
