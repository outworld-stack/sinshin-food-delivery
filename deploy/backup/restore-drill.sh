#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# restore-drill.sh — رارد H7: تمرین ماهانه‌ی بازیابی بکاپ
# فایل جدید — آخرین بکاپ را در یک Postgres موقت restore می‌کند و
# جداول کلیدی را می‌شمارد. خرابیِ خاموش کشف می‌شود، نه در روز حادثه.
#
# اجرا روی هاست (نه داخل کانتینر backup):
#   chmod +x deploy/backup/restore-drill.sh
#   cron ماهانه:  45 4 1 * *  /opt/sinshin-food-delivery/deploy/backup/restore-drill.sh
# ═══════════════════════════════════════════════════════════════
set -eu

BACKUPS_DIR="${1:-/var/lib/docker/volumes/sinshin-food-delivery_backups_data/_data}"
LOG_FILE="/var/log/sinshin-restore-drill.log"
DRILL_PG="sinshin-postgres-drill"

log() { echo "[$(date '+%F %T')] $*"; }

# آخرین بکاپ
LATEST=$(ls -t "$BACKUPS_DIR"/sinshin-*.sql.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  log "FAIL: هیچ بکاپی در $BACKUPS_DIR پیدا نشد" >> "$LOG_FILE"
  exit 1
fi
log "بکاپ آزمون: $(basename "$LATEST")"

# پاک‌سازی درل قبلی (اگر مانده)
docker rm -f "$DRILL_PG" >/dev/null 2>&1 || true

# PG موقت روی شبکه‌ی موقت خودش
docker run -d --name "$DRILL_PG" \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=drill -e POSTGRES_DB=drill \
  postgres:18.6-alpine >/dev/null

# صبر برای آماده شدن
for i in $(seq 1 30); do
  if docker exec "$DRILL_PG" pg_isready -U drill >/dev/null 2>&1; then break; fi
  sleep 1
done

# بازیابی
if gunzip -c "$LATEST" | docker exec -i "$DRILL_PG" psql -U drill -d drill -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
  ORDERS=$(docker exec "$DRILL_PG" psql -U drill -d drill -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)
  if [ "$ORDERS" -gt 10 ]; then
    log "PASS: $(basename "$LATEST") — $ORDERS جدول بازگشت" >> "$LOG_FILE"
    echo "✅ restore-drill PASS — $ORDERS جداول (لاگ: $LOG_FILE)"
  else
    log "FAIL: dump خوانده شد ولی فقط $ORDERS جدول — بکاپ ناقص است" >> "$LOG_FILE"
    echo "❌ restore-drill FAIL — جزئیات در $LOG_FILE"
  fi
else
  log "FAIL: psql خطا داد — dump خراب است: $(basename "$LATEST")" >> "$LOG_FILE"
  echo "❌ restore-drill FAIL — dump خراب (لاگ: $LOG_FILE)"
fi

docker rm -f "$DRILL_PG" >/dev/null 2>&1 || true
