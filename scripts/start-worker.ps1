<#
.SYNOPSIS
    Memulai Worker Penjadwal Video Pendek secara langsung di terminal PowerShell.
#>

$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $ProjectDir

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Memulai Bulk-Socmed Worker Daemon...      " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Tekan Ctrl+C untuk menghentikan daemon secara aman.`n"

pnpm --filter worker dev
