# Starts a film render that keeps running after this shell closes (Windows).
#   powershell -File tools/start-render.ps1 -W 3840 -H 2160 -Fps 60 -Out renders/unsung-vale
# It serves the built game on :5184 if nothing is listening there yet, then runs
# tools/render-film.mjs in the background and writes its output to <folder of Out>/render.log.
# The render is resumable: run the same command again and finished parts are skipped.
# Run "npm run build" first so the render uses the current code.
param(
  [int]$W = 3840,
  [int]$H = 2160,
  [int]$Fps = 60,
  [string]$Out = "renders/unsung-vale",
  [string]$Only = ""
)
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root (Split-Path -Parent $Out)
New-Item -ItemType Directory -Force $dir | Out-Null
$log = Join-Path $dir "render.log"

$listening = (Get-NetTCPConnection -LocalPort 5184 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
if ($listening -eq 0) {
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run preview > `"$(Join-Path $dir 'preview.log')`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 4
}
$only = if ($Only) { " --only $Only" } else { "" }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "node tools/render-film.mjs --w $W --h $H --fps $Fps --out $Out$only > `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
"Render started. Follow it with: Get-Content `"$log`" -Tail 3"
