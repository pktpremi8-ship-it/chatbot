param(
    [string]$BackupRoot = ".\backups"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$resolvedTarget = (Resolve-Path $targetDir).Path

Write-Host "[KRESNA] Creating Windows backup in $resolvedTarget..."

$runningServices = docker compose ps --status running --services 2>$null
if ($runningServices -contains "kresna") {
    Write-Host "[KRESNA] Snapshotting SQLite database from kresna-app container..."
    $snapshotCmd = 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync("/app/data/kresna.db"); db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); db.exec("VACUUM INTO ''/tmp/kresna-backup.db'';"); db.close();'
    docker compose exec -T kresna node --input-type=module -e $snapshotCmd
    docker cp kresna-app:/tmp/kresna-backup.db (Join-Path $resolvedTarget "kresna.db")
    docker compose exec -T kresna rm -f /tmp/kresna-backup.db

    docker compose exec -T kresna sh -c "test -d /app/data/uploads" 2>$null
    if ($LASTEXITCODE -eq 0) {
        docker cp kresna-app:/app/data/uploads (Join-Path $resolvedTarget "uploads")
    }
}
elseif (Test-Path ".\data\kresna.db") {
    Write-Host "[KRESNA] Container not running; snapshotting local .\data\kresna.db..."
    $destDb = (Join-Path $resolvedTarget "kresna.db") -replace "\\", "/"
    node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('./data/kresna.db'); db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.exec(\"VACUUM INTO '$destDb';\"); db.close();"
    if (Test-Path ".\data\uploads") {
        Copy-Item -Recurse -Force ".\data\uploads" (Join-Path $resolvedTarget "uploads")
    }
}
else {
    throw "No running kresna container and no local .\data\kresna.db found."
}

$qdrantVol = (docker volume ls -q | Select-String -Pattern "qdrant_data" | Select-Object -First 1).ToString().Trim()
if ($qdrantVol) {
    Write-Host "[KRESNA] Archiving Qdrant volume ($qdrantVol)..."
    docker run --rm -v "${qdrantVol}:/source:ro" -v "${resolvedTarget}:/backup" alpine `
        tar czf /backup/qdrant_storage.tar.gz -C /source .
}

Write-Host "[KRESNA] Backup complete: $resolvedTarget"
