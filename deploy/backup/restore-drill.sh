#!/bin/sh
# Restore the latest SQL backup into an isolated PostgreSQL container.
# Run on the host; an optional argument overrides BACKUP_DIR_HOST.
set -eu
umask 077

BACKUPS_DIR="${1:-${BACKUP_DIR_HOST:-/srv/hdd/sinshin/backups}}"
LOG_FILE="${RESTORE_DRILL_LOG_FILE:-/var/log/sinshin-restore-drill.log}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sinshin-restore.XXXXXX")"
DRILL_ID=''

log() {
    LINE="[$(date '+%F %T')] $*"
    printf '%s\n' "$LINE" >> "$LOG_FILE"
    printf '%s\n' "$LINE"
}
fail() { log "FAIL: $*" >&2; exit 1; }
cleanup() {
    # Only remove the container created by this invocation, including its volume.
    if [ -n "$DRILL_ID" ]; then docker rm -fv "$DRILL_ID" >/dev/null 2>&1 || true; fi
    rm -f "$WORK/restore.sql" "$WORK/restore.err"
    rmdir "$WORK" 2>/dev/null || true
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

LATEST="$(ls -t "$BACKUPS_DIR"/sinshin-*.sql.gz 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] && [ -f "$LATEST" ] && [ -s "$LATEST" ] || fail "هیچ بکاپی در $BACKUPS_DIR پیدا نشد"
log "بکاپ آزمون: $(basename "$LATEST")"

# Decompress before starting psql so a broken gzip cannot be hidden by a pipeline.
if ! gzip -cd "$LATEST" > "$WORK/restore.sql"; then
    fail "فایل فشرده خراب است: $(basename "$LATEST")"
fi
[ -s "$WORK/restore.sql" ] || fail 'خروجی بکاپ خالی است'
grep -q '^-- PostgreSQL database dump complete' "$WORK/restore.sql" || fail 'خروجی pg_dump ناقص است'

# A unique name and recorded ID make overlapping drills safe. No ports/network
# are exposed; docker exec connects over PostgreSQL's local Unix socket.
if ! DRILL_ID="$(docker create --name "sinshin-postgres-drill-$(basename "$WORK")" --network none \
    -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=drill -e POSTGRES_DB=drill \
    postgres:18.6-alpine)"; then
    fail 'ساخت پایگاه داده آزمایشی شکست خورد'
fi
docker start "$DRILL_ID" >/dev/null || fail 'راه‌اندازی پایگاه داده آزمایشی شکست خورد'

READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 30 ]; do
    # The image's temporary initialization server only accepts Unix sockets.
    # TCP readiness identifies the final server after database initialization.
    if docker exec "$DRILL_ID" pg_isready -h 127.0.0.1 -U drill -d drill >/dev/null 2>&1; then READY=1; break; fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 1
done
[ "$READY" = 1 ] || fail 'پایگاه داده آزمایشی آماده نشد'

if ! docker exec -i "$DRILL_ID" psql -X -U drill -d drill -v ON_ERROR_STOP=1 \
    < "$WORK/restore.sql" > /dev/null 2> "$WORK/restore.err"; then
    cat "$WORK/restore.err" >> "$LOG_FILE"
    fail "بازیابی SQL شکست خورد: $(basename "$LATEST")"
fi

TABLES="$(docker exec "$DRILL_ID" psql -X -U drill -d drill -v ON_ERROR_STOP=1 -tAc \
    "select count(*) from information_schema.tables where table_schema='public'")" || fail 'شمارش جدول‌ها شکست خورد'
CORE="$(docker exec "$DRILL_ID" psql -X -U drill -d drill -v ON_ERROR_STOP=1 -tAc \
    "select count(*) from information_schema.tables where table_schema='public' and table_name in ('users','orders','wallet_transactions')")" || fail 'بررسی جدول‌های اصلی شکست خورد'
if ! [ "$TABLES" -gt 10 ] 2>/dev/null || [ "$CORE" != 3 ]; then
    fail "بکاپ ناقص است: $TABLES جدول، $CORE جدول اصلی"
fi
log "PASS: $(basename "$LATEST") — $TABLES جدول و همه جدول‌های اصلی بازیابی شدند"
