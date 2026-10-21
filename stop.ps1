$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ProjectRoot ".runtime-pids.json"

if (-not (Test-Path $PidFile)) {
    Write-Host "No running service record was found."
    exit 0
}

$ProcessIds = Get-Content -Raw $PidFile | ConvertFrom-Json
foreach ($ProcessId in @($ProcessIds.backend, $ProcessIds.frontend)) {
    if ($ProcessId -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $ProcessId
        Write-Host "Stopped process $ProcessId"
    }
}
Remove-Item -LiteralPath $PidFile
Write-Host "Nexus Agent stopped."

