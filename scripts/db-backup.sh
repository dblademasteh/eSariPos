#!/usr/bin/env bash
# NovaPOS database backup (Linux/macOS). Schedule via cron, e.g.:
#   15 2 * * * /path/to/novapos/scripts/db-backup.sh
set -euo pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$DIR"
FILE="$DIR/novapos_${STAMP}.sql.gz"

docker exec novapos-db pg_dump -U postgres -d pos | gzip > "$FILE"
echo "Backup written: $FILE"

ls -1t "$DIR"/novapos_*.sql.gz | tail -n +15 | xargs -r rm --
