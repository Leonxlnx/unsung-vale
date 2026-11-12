# Prints a one-shot snapshot of CPU, RAM and GPU load. Used before heavy jobs so we
# never stack work on top of other processes that are already using the machine.
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os = Get-CimInstance Win32_OperatingSystem
$freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$totalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$commitFreeGb = [math]::Round($os.FreeVirtualMemory / 1MB, 1)

$gpu3d = 0; $gpuMemGb = 0
try {
  $samples = (Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction Stop).CounterSamples
  $gpu3d = [math]::Round(($samples | Measure-Object -Property CookedValue -Sum).Sum, 0)
} catch {}
try {
  $mem = (Get-Counter '\GPU Adapter Memory(*)\Shared Usage','\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples
  $gpuMemGb = [math]::Round((($mem | Measure-Object -Property CookedValue -Sum).Sum) / 1GB, 2)
} catch {}

"CPU {0}%  RAM free {1}/{2} GB  commit free {3} GB  GPU 3D {4}%  GPU mem {5} GB" -f $cpu, $freeGb, $totalGb, $commitFreeGb, $gpu3d, $gpuMemGb

if ($args -contains '-top') {
  Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 Name, Id,
    @{n='RAM_GB';e={[math]::Round($_.WorkingSet64/1GB,2)}}, @{n='CPU_s';e={[math]::Round($_.CPU,0)}} | Format-Table -AutoSize
}
