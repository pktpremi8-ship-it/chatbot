#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: ./scripts/restore.sh <backup-folder-path>"
  exit 1
fi

BACKUP_DIR="$1"
if [ ! -f "${BACKUP_DIR}/kresna.db" ]; then
  echo "Error: ${BACKUP_DIR}/kresna.db not found."
  exit 1
fi

echo "[KRESNA] Restoring from ${BACKUP_DIR}..."

if docker compose ps --services 2>/dev/null | grep -qx "kresna"; then
  echo "[KRESNA] Stopping kresna and qdrant services for safe restore..."
  docker compose stop kresna qdrant || true

  KRESNA_VOL="$(docker volume ls -q | grep "kresna_data" | head -n 1)"
  if [ -n "${KRESNA_VOL}" ]; then
    docker run --rm -v "${KRESNA_VOL}:/data" -v "$(cd "${BACKUP_DIR}" && pwd):/backup:ro" alpine sh -c '
      rm -f /data/kresna.db-wal /data/kresna.db-shm
      cp /backup/kresna.db /data/kresna.db
      if [ -d /backup/uploads ]; then
        rm -rf /data/uploads
        cp -R /backup/uploads /data/uploads
      fi
    '
  fi

  if [ -f "${BACKUP_DIR}/qdrant_storage.tar.gz" ]; then
    QDRANT_VOL="$(docker volume ls -q | grep "qdrant_data" | head -n 1)"
    if [ -n "${QDRANT_VOL}" ]; then
      docker run --rm -v "${QDRANT_VOL}:/qdrant/storage" -v "$(cd "${BACKUP_DIR}" && pwd):/backup:ro" alpine sh -c '
        rm -rf /qdrant/storage/*
        tar xzf /backup/qdrant_storage.tar.gz -C /qdrant/storage
      '
    fi
  fi

  echo "[KRESNA] Starting services..."
  docker compose up -d
else
  mkdir -p ./data
  rm -f ./data/kresna.db-wal ./data/kresna.db-shm
  cp "${BACKUP_DIR}/kresna.db" ./data/kresna.db
  if [ -d "${BACKUP_DIR}/uploads" ]; then
    rm -rf ./data/uploads
    cp -R "${BACKUP_DIR}/uploads" ./data/uploads
  fi
fi

echo "[KRESNA] Restore complete."
