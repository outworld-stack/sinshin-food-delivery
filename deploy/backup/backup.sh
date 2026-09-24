#!/bin/sh
# deploy/backup/backup.sh — بکاپ روزانه‌ی دیتابیس سین‌شین
# ══════════════════════════════════════════════════════════════════
# سرویس «backup» در compose.yml همین اسکریپت را اجرا می‌کند؛ تصویرِ
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
#   • جبرانِ ازدست‌رفته: boot بعد از ساعتِ مقررِ امروز + نبودِ بکاپِ موفق
#     → همین موقع یک‌بار اجرا می‌کند
#   • شکست هرگز اسکریپت را نمی‌کُشد — فقط لاگ؛ فردا دوباره تلاش می‌شود
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

# ساعت را به دو رقمی صفرپوشده نرمال می‌کنیم (5 → 05).
# مقایسه‌های زمانی همه «رشته‌ای» روی HHMM صفرپوشده‌اند — بدون محاسبات
# عددی که در busybox با صفرِ ابتدایی (08/09) اکتال خوانده می‌شوند.
case "$HOUR" in
    [0-9]) HOUR="0$HOUR" ;;
    [0-9][0-9]) : ;;
    *) HOUR="05" ;;
esac
TARGET_HM="${HOUR}00"

log() { echo "[backup] $(date '+%F %T') $*"; }

# ── یک اجرای pg_dump + نگهداشت ──
run_backup() {
    STAMP="$(date +%Y-%m-%d_%H%M)"
    TARGET="$DIR/$PREFIX-$STAMP.sql.gz"
    RAW="$DIR/.dump-$$.sql"
    ERR="$DIR/.dump-$$.err"

    log "pg_dump شروع شد → $TARGET"

    # مرحله ۱: dump خام — exit-code واقعی pg_dump همین‌جا در دست است
    if ! pg_dump --format=plain --no-owner --no-privileges > "$RAW" 2>"$ERR"; then
        log "خطا: pg_dump شکست خورد — بکاپ‌های قبلی دست‌نخورده ماندند:" >&2
        sed 's/^/  pg_dump: /' "$ERR" >&2
        rm -f "$RAW" "$ERR"
        return 1
    fi
    if [ ! -s "$RAW" ]; then
        log "خطا: خروجی pg_dump خالی است — کنار گذاشته شد" >&2
        rm -f "$RAW" "$ERR"
        return 1
    fi

    # مرحله ۲: فشرده‌سازی + انتشار اتمیک
    if ! gzip -9 -c "$RAW" > "$TARGET.tmp"; then
        log "خطا: gzip شکست خورد" >&2
        rm -f "$RAW" "$ERR" "$TARGET.tmp"
        return 1
    fi
    mv "$TARGET.tmp" "$TARGET"
    rm -f "$RAW" "$ERR"
    log "انجام شد: $(basename "$TARGET") ($(du -h "$TARGET" | cut -f1))"

    # ── نگهداشت: فقط BACKUP_KEEP نسخه‌ی جدید بماند ──
    ls -1t "$DIR/$PREFIX"-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
        rm -f "$old" && log "حذف نسخه‌ی قدیمی: $(basename "$old")"
    done
    return 0
}

# ── آیا امروز بکاپِ موفق وجود دارد؟ ──
has_today_backup() {
    [ -n "$(ls -1 "$DIR/$PREFIX"-"$(date +%Y-%m-%d)"_*.sql.gz 2>/dev/null)" ]
}

mkdir -p "$DIR"
# زباله‌های اجرای قبلیِ نیمه‌کاره (فقط یک نمونه از این اسکریپت وجود دارد)
rm -f "$DIR"/.dump-*.sql "$DIR"/.dump-*.err "$DIR"/"$PREFIX"-*.sql.gz.tmp 2>/dev/null || true

log "شروع شد — ساعت=$HOUR (TZ=${TZ:-unset}) نگهداشت=$KEEP مقصد=$DIR"

# جبرانِ ازدست‌رفته: boot بعد از ساعتِ مقرر و بدون بکاپِ موفقِ امروز
NOW_HM="$(date +%H%M)"
if [ "$NOW_HM" \> "$TARGET_HM" ] && ! has_today_backup; then
    log "بکاپِ امروز هنوز گرفته نشده — اجرای جبرانی"
    run_backup || true
fi

# حلقه‌ی دائمی — هر ۳۰ ثانیه؛ بعد از اجرا یک ساعت صبر می‌کند تا همان
# روز دوباره اجرا نشود. این فرایند هرگز exit نمی‌کند.
while true; do
    if [ "$(date +%H%M)" = "$TARGET_HM" ]; then
        run_backup || true
        sleep 3700
    fi
    sleep 30
done
