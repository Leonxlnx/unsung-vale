# Waits until a time of day, then renders the film from the last commit, on its own.
#   powershell -ExecutionPolicy Bypass -File tools/render-at.ps1 -At 09:00 -Out renders/rc1/unsung-vale
# It takes a snapshot of HEAD into renders/_film (so work that goes on in the tree afterwards
# cannot touch the render), builds it, serves it on its own port and runs the resumable
# render against that. Progress is written to renders/render-at.log and <Out folder>/render.log.
# To start at once, pass a time that has just gone by with -Now.
param(
  [string]$At = "09:00",
  [string]$Out = "renders/rc1/unsung-vale",
  [int]$W = 3840,
  [int]$H = 2160,
  [int]$Fps = 60,
  [int]$Port = 5194,
  [switch]$Now
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$snap = Join-Path $root "renders\_film"
$outAbs = Join-Path $root $Out
$outDir = Split-Path -Parent $outAbs
New-Item -ItemType Directory -Force (Join-Path $root "renders") | Out-Null
New-Item -ItemType Directory -Force $outDir | Out-Null
$log = Join-Path $root "renders\render-at.log"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $log -Encoding utf8 }

if (-not $Now) {
  $target = [datetime]::Today.Add([timespan]::Parse($At))
  if ($target -lt (Get-Date)) { $target = $target.AddDays(1) }
  Log "waiting until $target (pid $PID)"
  while ((Get-Date) -lt $target) { Start-Sleep -Seconds 20 }
}
Log "starting: snapshot of HEAD"
try {
  $head = (git -C $root rev-parse --short HEAD).Trim()
  Log "commit $head"
  if (Test-Path $snap) { cmd /c "rmdir `"$snap\node_modules`"" 2>$null | Out-Null; Remove-Item -Recurse -Force $snap -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force $snap | Out-Null
  cmd /c "git -C `"$root`" archive HEAD | tar -x -C `"$snap`""
  cmd /c "mklink /J `"$snap\node_modules`" `"$root\node_modules`"" | Out-Null
  Log "building"
  $b = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx vite build > `"$outDir\build.log`" 2>&1" -WorkingDirectory $snap -WindowStyle Hidden -Wait -PassThru
  if (-not (Test-Path (Join-Path $snap "dist\index.html"))) { Log "BUILD FAILED (exit $($b.ExitCode)); see $outDir\build.log"; exit 1 }
  $listening = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($listening -eq 0) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx vite preview --port $Port --strictPort > `"$outDir\preview.log`" 2>&1" -WorkingDirectory $snap -WindowStyle Hidden
    Start-Sleep -Seconds 6
  }
  Log "rendering ${W}x${H} at $Fps fps to $outAbs"
  # The render resumes where it stopped: try again a few times if a part fails.
  for ($try = 1; $try -le 6; $try++) {
    $r = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "node tools/render-film.mjs --w $W --h $H --fps $Fps --url http://localhost:$Port --out `"$outAbs`" >> `"$outDir\render.log`" 2>&1" -WorkingDirectory $snap -WindowStyle Hidden -Wait -PassThru
    if ((Test-Path "$outAbs-hdr10.mp4") -and (Test-Path "$outAbs-sdr.mp4")) { Log "DONE after $try run(s): $outAbs-hdr10.mp4 and -sdr.mp4"; break }
    Log "run $try ended without the finished film (exit $($r.ExitCode)); trying again in 30 s"
    Start-Sleep -Seconds 30
  }
} catch { Log "ERROR: $_" }
