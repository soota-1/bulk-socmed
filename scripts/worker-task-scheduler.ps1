<#
.SYNOPSIS
    Mendaftarkan atau menghapus Worker Penjadwal Video Pendek dari Windows Task Scheduler.

.DESCRIPTION
    Menjalankan worker secara otomatis di latar belakang setiap kali laptop menyala (At Logon).
    Mencegah proses terhenti saat laptop berjalan dengan baterai.

.PARAMETER Action
    Install, Uninstall, atau Status (default: Status)

.EXAMPLE
    .\scripts\worker-task-scheduler.ps1 -Action Install
    .\scripts\worker-task-scheduler.ps1 -Action Status
    .\scripts\worker-task-scheduler.ps1 -Action Uninstall
#>

param(
    [ValidateSet("Install", "Uninstall", "Status")]
    [string]$Action = "Status"
)

$TaskName = "BulkSocmedWorker"
$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$PnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source

if (-not $PnpmPath) {
    Write-Error "pnpm tidak ditemukan di PATH. Pastikan pnpm sudah terpasang."
    exit 1
}

switch ($Action) {
    "Status" {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            Write-Host "=============================================" -ForegroundColor Cyan
            Write-Host " Status Task Scheduler: $TaskName" -ForegroundColor Cyan
            Write-Host "=============================================" -ForegroundColor Cyan
            Write-Host " State   : $($task.State)"
            Write-Host " Path    : $ProjectDir"
            $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
            if ($info) {
                Write-Host " Last Run: $($info.LastRunTime)"
                Write-Host " Result  : $($info.LastTaskResult)"
            }
        } else {
            Write-Host "Task '$TaskName' belum terdaftar di Windows Task Scheduler." -ForegroundColor Yellow
            Write-Host "Gunakan: .\scripts\worker-task-scheduler.ps1 -Action Install"
        }
    }

    "Install" {
        Write-Host "Mendaftarkan '$TaskName' ke Windows Task Scheduler..." -ForegroundColor Cyan

        # Hapus task lama jika ada
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

        # Action: jalankan pnpm worker start
        $ArgList = "/c cd `"$ProjectDir`" && pnpm --filter worker dev >> `"$ProjectDir\data\logs\worker.log`" 2>&1"
        $taskAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $ArgList -WorkingDirectory $ProjectDir

        # Trigger: At Logon pengguna saat ini
        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn

        # Settings: Restart on failure, do not stop on battery
        $taskSettings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit (New-TimeSpan -Days 365) `
            -Priority 7

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $taskAction `
            -Trigger $taskTrigger `
            -Settings $taskSettings `
            -Description "Worker Penjadwal Video Pendek otomatis untuk YouTube, Instagram, dan TikTok" | Out-Null

        Write-Host "✅ Sukses mendaftarkan task '$TaskName'!" -ForegroundColor Green
        Write-Host "   Worker akan otomatis aktif setiap kali Anda masuk ke Windows."
        Write-Host "   Untuk memulai sekarang: Start-ScheduledTask -TaskName $TaskName"
    }

    "Uninstall" {
        Write-Host "Menghapus '$TaskName' dari Windows Task Scheduler..." -ForegroundColor Cyan
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "✅ Task '$TaskName' berhasil dihapus." -ForegroundColor Green
    }
}
