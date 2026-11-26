#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${1:-./backups}"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
TARGET_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
mkdir -p "${TARGET_DIR}"

echo "[KRESNA] Creating backup in ${TARGET_DIR}..."

# 1. Consistent SQLite snapshot (via running container if up, else local Node/tsx)
if docker compose ps --status running --services 2>/dev/null | grep -qx "kresna"; then
  echo "[KRESNA] Snapshotting SQLite database from running kresna container..."
  docker compose exec -T kresna node --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync("/app/data/kresna.db");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.exec("VACUUM INTO \"/tmp/kresna-backup.db\";");
    db.close();
  '
  docker cp kresna-app:/tmp/kresna-backup.db "${TARGET_DIR}/kresna.db"
  docker compose exec -T kresna rm -f /tmp/kresna-backup.db
  if docker compose exec -T kresna test -d /app/data/uploads; then
    docker cp kresna-app:/app/data/uploads "${TARGET_DIR}/uploads"
  fi
else
  echo "[KRESNA] Docker container not running; snapshotting local ./data/kresna.db..."
  if [ -f "./data/kresna.db" ]; then
    node --input-type=module -e '
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync("./data/kresna.db");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.exec(`VACUUM INTO "${process.argv[1]}";`);
      db.close();
    ' "${TARGET_DIR}/kresna.db"
  fi
  if [ -d "./data/uploads" ]; then
    cp -R ./data/uploads "${TARGET_DIR}/uploads"
  fi
fi

# 2. Archive Qdrant storage volume if present
if docker volume ls -q | grep -q "qdrant_data"; then
  QDRANT_VOL="$(docker volume ls -q | grep "qdrant_data" | head -n 1)"
  echo "[KRESNA] Archiving Qdrant volume (${QDRANT_VOL})..."
  docker run --rm -v "${QDRANT_VOL}:/source:ro" -v "$(cd "${TARGET_DIR}" && pwd):/backup" alpine \
    tar czf /backup/qdrant_storage.tar.gz -C /source .
fi

echo "[KRESNA] Backup complete: ${TARGET_DIR}"
