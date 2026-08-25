# NovaPOS database backup
# Usage: ./scripts/db-backup.ps1  (or schedule via Task Scheduler)
# Keeps a rolling window of 14 daily dumps next to the project.

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $PSScriptRoot '..\backups'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$file = Join-Path $outDir "novapos_$stamp.sql.gz"

docker exec novapos-db pg_dump -U postgres -d pos | gzip > $file
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

Write-Output "Backup written: $file"

# Retention: keep the newest 14
Get-ChildItem $outDir -Filter 'novapos_*.sql.gz' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 14 |
  ForEach-Object { Remove-Item $_.FullName; Write-Output "pruned $($_.Name)" }
