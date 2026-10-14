# Registers (or updates) the weekly COM.escolha check in Windows Task Scheduler,
# for the current user. Run once from the repository:
#
#   powershell -ExecutionPolicy Bypass -File scripts/comescolha-schedule.ps1
#
# Tuesdays at 10:00; if the PC is off then, it runs as soon as it is on.
# Remove with: Unregister-ScheduledTask -TaskName 'Faturometro COM.escolha' -Confirm:$false

$script = Join-Path $PSScriptRoot 'comescolha-weekly.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday -At '10:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'Faturometro COM.escolha' -Action $action -Trigger $trigger `
  -Settings $settings -Force `
  -Description 'Verifica as ligações ao COM.escolha da ANACOM (docs/anacom-comescolha.md).' | Out-Null
Write-Output "Tarefa 'Faturometro COM.escolha' registada: terças às 10:00 ($script)."
