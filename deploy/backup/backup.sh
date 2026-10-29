#!/bin/sh
# deploy/backup/backup.sh — بکاپ روزانه‌ی دیتابیس سین‌شین
# ══════════════════════════════════════════════════════════════════
# سرویس «backup» در docker-compose.yml همین اسکریپت را اجرا می‌کند؛ تصویرِ
# آن postgres:18.6-alpine است — یعنی pg_dump هم‌نسخه‌ی سرور است و
# از کشِ همین ایمیجِ موجود بالا می‌آید (دانلود جدیدی لازم نیست).
#
# چرا سایدکار و نه داخل API؟
#   • نسخه‌ی pg_dump باید دقیقاً با سرور یکی باشد؛ کانتینر API آن را ندارد.
#   • بکاپ باید از چرخه‌ی ری‌استارت/کرشِ API کاملاً مستقل بماند —
#     هیچ سناریویی در API نمی‌تواند بکاپ را متوقف کند.
#
# رفتار:
#   • هر روز ساعت BACKUP_HOUR (پیش‌فرض ۵ صبح تهران — بعد از retention ۰۴:۳۰)
#   • pg_dump قالب plain + gzip → فایل sinshin-YYYY-MM-DD_HHMM.sql.gz
#   • تشخیص دقیق شکست pg_dump (اول dump، بعد gzip — exit-code از pipe گم نمی‌شود)
#   • نوشتن اتمیک (tmp + mv) — فایل نیمه‌کار هرگز «معتبر» دیده نمی‌شود
#   • نگهداشت BACKUP_KEEP نسخه‌ی آخر (پیش‌فرض ۷ = یک هفته)
#   • عبور از دقیقه مقرر یا راه‌اندازی دیرهنگام → اجرای جبرانی همان روز
#   • شکست موقت → تلاش دوباره پس از ۵ دقیقه؛ فایل موفق فقط یک‌بار اعتبارسنجی می‌شود
#   • شکست offsite → ارسال مجدد همان فایل، بدون تولید بکاپ محلی تکراری
#
# بازیابی (روی هاست، با مقادیر .env خودتان):
#   gunzip -c sinshin-....sql.gz | docker exec -i sinshin-postgres \
#     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
# ══════════════════════════════════════════════════════════════════
set -u
umask 077   # بکاپ شامل کل داده‌ی مشتریان است — فقط مالک می‌خواند

KEEP="${BACKUP_KEEP:-7}"
DIR="${BACKUP_DIR:-/backups}"
HOUR="${BACKUP_HOUR:-5}"
PREFIX="sinshin"

log() { echo "[backup] $(date '+%F %T') $*"; }

# Reject configuration that could silently disable backups or delete every copy.
case "$KEEP" in ''|*[!0-9]*) log 'خطا: BACKUP_KEEP باید عدد مثبت باشد' >&2; exit 2 ;; esac
KEEP="$(printf '%s' "$KEEP" | sed 's/^0*//')"
if ! [ "$KEEP" -ge 1 ] 2>/dev/null || ! [ "$KEEP" -le 2147483646 ] 2>/dev/null; then
    log 'خطا: BACKUP_KEEP باید عدد مثبت معتبر باشد' >&2
    exit 2
fi

# Zero-pad without interpreting 08/09 as octal.
case "$HOUR" in
    [0-9]) HOUR="0$HOUR" ;;
    [01][0-9]|2[0-3]) : ;;
    *) log 'خطا: BACKUP_HOUR باید بین 0 و 23 باشد' >&2; exit 2 ;;
esac
TARGET_HM="${HOUR}00"

case "${1:-}" in
    '') ONCE=0 ;;
    --once) ONCE=1 ;;
    *) log 'Usage: backup.sh [--once]' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || exit 2

# ── یک اجرای pg_dump + نگهداشت ──
run_backup() (
    STAMP="$1"
    TARGET="$DIR/$PREFIX-$STAMP.sql.gz"
    WORK="$(mktemp -d "$DIR/.backup.XXXXXX")" || exit 1
    RAW="$WORK/dump.sql"
    ERR="$WORK/dump.err"
    ARCHIVE="$WORK/archive.sql.gz"
    cleanup() {
        rm -f "$RAW" "$ERR" "$ARCHIVE"
        rmdir "$WORK" 2>/dev/null || true
    }
    trap cleanup 0
    trap 'exit 1' HUP INT TERM

    log "pg_dump شروع شد → $TARGET"

    # مرحله ۱: dump خام — exit-code واقعی pg_dump همین‌جا در دست است
    if ! pg_dump --format=plain --no-owner --no-privileges > "$RAW" 2>"$ERR"; then
        log "خطا: pg_dump شکست خورد — بکاپ‌های قبلی دست‌نخورده ماندند:" >&2
        sed 's/^/  pg_dump: /' "$ERR" >&2
        return 1
    fi
    if [ ! -s "$RAW" ] || ! grep -q '^-- PostgreSQL database dump complete' "$RAW"; then
        log "خطا: خروجی pg_dump خالی یا ناقص است — کنار گذاشته شد" >&2
        return 1
    fi

    # مرحله ۲: فشرده‌سازی + انتشار اتمیک
    if ! gzip -9 -c "$RAW" > "$ARCHIVE"; then
        log "خطا: gzip شکست خورد" >&2
        return 1
    fi
    if [ ! -s "$ARCHIVE" ] || ! gzip -t "$ARCHIVE"; then
        log "خطا: فایل فشرده معتبر نیست — منتشر نشد" >&2
        return 1
    fi
    if [ -d "$TARGET" ] || ! mv "$ARCHIVE" "$TARGET"; then
        log "خطا: انتشار فایل بکاپ شکست خورد — نسخه‌های قبلی حفظ شدند" >&2
        return 1
    fi
    log "انجام شد: $(basename "$TARGET") ($(du -h "$TARGET" | cut -f1))"

    # ── نگهداشت: فقط BACKUP_KEEP نسخه‌ی جدید بماند ──
    ls -1t "$DIR/$PREFIX"-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
        rm -f "$old" && log "حذف نسخه‌ی قدیمی: $(basename "$old")"
    done
    return 0
)

# Keep transfer retries independent of dump generation and retention.
copy_offsite() (
    [ -n "${BACKUP_RCLONE_REMOTE:-}" ] || return 0
    TARGET="$1"
    if ! command -v rclone >/dev/null 2>&1; then
        log 'خطا: rclone برای کپی خارج از سرور نصب نشده است؛ نسخه محلی حفظ شد' >&2
        return 1
    fi
    WORK="$(mktemp -d "$DIR/.backup.XXXXXX")" || return 1
    ENCRYPTED="$WORK/$(basename "$TARGET").age"
    cleanup() { rm -f "$ENCRYPTED"; rmdir "$WORK" 2>/dev/null || true; }
    trap cleanup 0
    trap 'exit 1' HUP INT TERM

    SOURCE="$TARGET"
    if [ -n "${BACKUP_AGE_PUBKEY:-}" ]; then
        if ! command -v age >/dev/null 2>&1 || ! age -r "$BACKUP_AGE_PUBKEY" "$TARGET" > "$ENCRYPTED"; then
            log 'خطا: رمزنگاری offsite شکست خورد؛ نسخه محلی حفظ شد و فایل بدون رمز ارسال نشد' >&2
            return 1
        fi
        SOURCE="$ENCRYPTED"
    fi
    # No --min-age: it silently skips files created by this very backup run.
    if ! rclone copy "$SOURCE" "${BACKUP_RCLONE_REMOTE}/"; then
        log 'خطا: کپی خارج از سرور شکست خورد؛ نسخه محلی حفظ شد' >&2
        return 1
    fi
    log "offsite: $(basename "$SOURCE")"
    return 0
)

# Sets LOCAL_ARCHIVE once for a pending day, rather than inflating it every poll.
find_day_backup() {
    for candidate in "$DIR/$PREFIX"-"$1"_*.sql.gz; do
        if [ -f "$candidate" ] && [ -s "$candidate" ] && gzip -t "$candidate" 2>/dev/null \
            && gzip -cd "$candidate" | grep -q '^-- PostgreSQL database dump complete'; then
            LOCAL_ARCHIVE="$candidate"
            return 0
        fi
    done
    return 1
}

if ! mkdir -p "$DIR"; then
    log "خطا: پوشه بکاپ قابل ایجاد نیست: $DIR" >&2
    exit 1
fi

# Also used for manual verification: success means a complete archive was published.
if [ "$ONCE" = 1 ]; then
    STAMP="$(date +%Y-%m-%d_%H%M)"
    run_backup "$STAMP" && copy_offsite "$DIR/$PREFIX-$STAMP.sql.gz"
    exit "$?"
fi

log "شروع شد — ساعت=$HOUR (TZ=${TZ:-unset}) نگهداشت=$KEEP مقصد=$DIR"

# One local timestamp supplies both date and time, including across midnight.
# An upload retries the existing archive; the next scheduled day's valid archive
# supersedes an older pending upload. A remote outage never blocks local backups.
LOCAL_DAY=''
LOCAL_ARCHIVE=''
UPLOAD_PENDING=0
while true; do
    STAMP="$(date +%Y-%m-%d_%H%M)"
    TODAY="${STAMP%_*}"
    NOW_HM="${STAMP#*_}"
    if [ "$LOCAL_DAY" != "$TODAY" ] && { [ "$NOW_HM" \> "$TARGET_HM" ] || [ "$NOW_HM" = "$TARGET_HM" ]; }; then
        if ! find_day_backup "$TODAY"; then
            if run_backup "$STAMP"; then
                LOCAL_ARCHIVE="$DIR/$PREFIX-$STAMP.sql.gz"
            else
                log 'بکاپ ناموفق بود — تلاش مجدد پس از ۵ دقیقه' >&2
                sleep 300
                continue
            fi
        fi
        LOCAL_DAY="$TODAY"
        UPLOAD_PENDING=1
    fi
    if [ "$UPLOAD_PENDING" = 1 ]; then
        if copy_offsite "$LOCAL_ARCHIVE"; then
            UPLOAD_PENDING=0
        else
            log 'ارسال offsite ناموفق بود — تلاش مجدد همان فایل پس از ۵ دقیقه' >&2
            sleep 300
            continue
        fi
    fi
    sleep 30
done
