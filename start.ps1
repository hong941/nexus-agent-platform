$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$EnvFile = Join-Path $ProjectRoot ".env"
$EnvTemplate = Join-Path $ProjectRoot ".env.example"
$BackendLog = Join-Path $ProjectRoot "backend.log"
$BackendErr = Join-Path $ProjectRoot "backend.err.log"
$FrontendLog = Join-Path $ProjectRoot "frontend.log"
$FrontendErr = Join-Path $ProjectRoot "frontend.err.log"

Set-Location $ProjectRoot
if (-not (Test-Path $EnvFile) -and (Test-Path $EnvTemplate)) {
    Copy-Item -LiteralPath $EnvTemplate -Destination $EnvFile
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating Python environment..."
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) {
        throw "Python 3.11+ was not found in PATH."
    }
    & $Python.Source -m venv (Join-Path $BackendDir ".venv")
}

$Marker = Join-Path $BackendDir ".deps-installed"
$Requirements = Join-Path $BackendDir "requirements.txt"
if (-not (Test-Path $Marker) -or (Get-Item $Requirements).LastWriteTimeUtc -gt (Get-Item $Marker).LastWriteTimeUtc) {
    Write-Host "Installing backend dependencies..."
    & $VenvPython -m pip install --disable-pip-version-check -r $Requirements
    New-Item -ItemType File -Force -Path $Marker | Out-Null
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $FrontendDir
    try {
        npm install --no-audit --no-fund
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $FrontendDir ".next"))) {
    Write-Host "Building frontend..."
    Push-Location $FrontendDir
    try {
        npm run build
    }
    finally {
        Pop-Location
    }
}

Write-Host "Starting Nexus Agent..."
$BackendProcess = Start-Process `
    -FilePath $VenvPython `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $BackendLog `
    -RedirectStandardError $BackendErr `
    -PassThru

$env:NEXT_TELEMETRY_DISABLED = "1"
$FrontendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run", "start" `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $FrontendLog `
    -RedirectStandardError $FrontendErr `
    -PassThru

@{
    backend = $BackendProcess.Id
    frontend = $FrontendProcess.Id
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $ProjectRoot ".runtime-pids.json")

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "Nexus Agent is running:" -ForegroundColor Green
Write-Host "  Web: http://localhost:3000"
Write-Host "  API: http://localhost:8000/docs"
Write-Host ""
Write-Host "Run .\stop.ps1 to stop both services."

