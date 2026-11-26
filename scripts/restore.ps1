param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDir
)

$ErrorActionPreference = "Stop"
$resolvedBackup = (Resolve-Path $BackupDir).Path
$dbBackup = Join-Path $resolvedBackup "kresna.db"

if (-not (Test-Path $dbBackup)) {
    throw "Backup SQLite database not found at $dbBackup"
}

Write-Host "[KRESNA] Restoring KRESNA state from $resolvedBackup..."
docker compose stop kresna qdrant | Out-Null

$kresnaVol = (docker volume ls -q | Select-String -Pattern "kresna_data" | Select-Object -First 1).ToString().Trim()
if ($kresnaVol) {
    docker run --rm -v "${kresnaVol}:/data" -v "${resolvedBackup}:/backup:ro" alpine sh -c `
        "rm -f /data/kresna.db-wal /data/kresna.db-shm && cp /backup/kresna.db /data/kresna.db && if [ -d /backup/uploads ]; then rm -rf /data/uploads && cp -R /backup/uploads /data/uploads; fi"
}

$qdrantArchive = Join-Path $resolvedBackup "qdrant_storage.tar.gz"
if (Test-Path $qdrantArchive) {
    $qdrantVol = (docker volume ls -q | Select-String -Pattern "qdrant_data" | Select-Object -First 1).ToString().Trim()
    if ($qdrantVol) {
        docker run --rm -v "${qdrantVol}:/qdrant/storage" -v "${resolvedBackup}:/backup:ro" alpine sh -c `
            "rm -rf /qdrant/storage/* && tar xzf /backup/qdrant_storage.tar.gz -C /qdrant/storage"
    }
}

Write-Host "[KRESNA] Restarting Docker Compose stack..."
docker compose up -d
Write-Host "[KRESNA] Restore complete."
