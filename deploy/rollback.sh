#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# rollback.sh — رارد M19: بازگشت به آخرین استقرار سالم (یا SHA دلخواه)
# فایل جدید — رانر CI هنگام هر استقرار موفق، تگ sinshin/<svc>:<sha7>
# می‌زند (deploy.yml). این اسکریپت آن تگ را فعال می‌کند.
#
# استفاده (روی سرور، از ریشه‌ی پروژه):
#   ./deploy/rollback.sh            → آخرین تگ قبل از «الان»
#   ./deploy/rollback.sh a1b2c3d    → SHA مشخص
# ═══════════════════════════════════════════════════════════════
set -eu

cd /opt/sinshin-food-delivery
TARGET_SHA="${1:-}"

if [ -z "$TARGET_SHA" ]; then
  # آخرین تگ sinshin/api:* به‌جز کامیت فعلی
  CURRENT=$(git rev-parse --short HEAD)
  TARGET_SHA=$(docker images --format '{{.Tag}}' sinshin/api \
    | grep -E '^[0-9a-f]{7,}$' | grep -v "^${CURRENT}$" | head -1 || true)
  if [ -z "$TARGET_SHA" ]; then
    echo "❌ هیچ تگ rollback پیدا نشد — استقرار اول است یا CI قدیمی"
    exit 1
  fi
fi

echo "⟲ rollback به: ${TARGET_SHA}"
echo "  (پیش از ادامه، سلامتSHA بررسی کن: docker run --rm sinshin/api:${TARGET_SHA} echo OK)"

# ایمیج‌های تگ‌شده را به‌جای build استفاده کن:
# compose فایل override موقت — بدون build، فقط image
cat > /tmp/sinshin-rollback.yml <<EOF
services:
  api:
    image: sinshin/api:${TARGET_SHA}
  web:
    image: sinshin/web:${TARGET_SHA}
EOF

docker compose -f docker-compose.yml -f /tmp/sinshin-rollback.yml up -d
rm -f /tmp/sinshin-rollback.yml

echo "⏳ صبر برای سلامت..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS http://localhost/api/health >/dev/null 2>&1; then
    echo "✅ rollback کامل شد — سلامت تایید شد (${TARGET_SHA})"
    docker compose ps
    exit 0
  fi
  sleep 10
done

echo "❌ سرویس بعد از rollback جواب نداد — docker compose ps را ببین و لاگ‌ها را چک کن"
docker compose ps
exit 1
