-- ═══════════════════════════════════════════════════════════════
-- stage-71 — sinshin-food-delivery — migration 0006
-- نام: device backfills (بازیابی بک‌فیل‌های stage-70)
-- زمینه: کامیت «stage seventy» مایگریشن ۰۰۰۵ را با drizzle-kit generate
-- بازتولید کرد (0005_many_marvel_zombies) — ستون‌ها/ایندکس‌ها هست، اما
-- بک‌فیل‌های داده‌ی نسخه‌ی دستی stage-70 در آن نیستند. این مایگریشن همان
-- بک‌فیل‌ها را به‌صورت «ایدمپوتنت» بازیابی می‌کند:
--   ① خنثی‌سازی clientId تکراری (no-op بعد از ایندکس یکتای ۰۰۰۵)
--   ② بک‌فیل نوع/برند دستگاه از user_agent
--   ③ بک‌فیل مالک (registered_owner_phone) از قدیمی‌ترین هویت
--   ④ آزادسازی مسدودی‌های «خودکارِ» قدیمی (auto:%) + رویداد AUTO_UNBLOCK
-- ماهیت: کاملاً افزایشی؛ هیچ حذف/تغییر ستونی وجود ندارد.
-- ایدمپوتنت: هر بلاک فقط ردیف‌هایی را می‌گیرد که هنوز مقدار ندارند؛
-- اجرای دوباره = no-op. مسدودی «دستیِ» ادمین هرگز دست نمی‌خورد.
-- ═══════════════════════════════════════════════════════════════

-- ۱) خنثی‌سازی clientIdهای تکراریِ ناشی از race قدیمی (ردیفِ با id کوچک‌تر
--    می‌ماند). اگر ایندکس یکتای ۰۰۰۵ قبلاً ساخته شده باشد no-op است؛
--    اگر ۰۰۰۵ هنوز ساخته‌اش نشده باشد، قبل از CREATE امنیت را برقرار می‌کند.
UPDATE "devices" d SET "client_id" = NULL
WHERE "client_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "devices" o
    WHERE o."client_id" = d."client_id" AND o."id" < d."id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_client_id_uidx" ON "devices" USING btree ("client_id") WHERE client_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_type_idx" ON "devices" USING btree ("device_type");--> statement-breakpoint

-- ۲) بک‌فیل نوع/برند برای ردیف‌های موجود — از user_agent (در دسترس‌ترین منبع).
--    مدل (device_model) عمداً خالی می‌ماند: استخراج مدل از UA در SQL کدر و
--    ناقص است؛ نام کامل با ورود بعدیِ همان کاربر (کلاینت stage-70) پر می‌شود.
UPDATE "devices" SET "device_type" = CASE
    WHEN "user_agent" ~* 'iPad' THEN 'tablet'
    WHEN "user_agent" ~* 'iPhone' THEN 'mobile'
    WHEN "user_agent" ~* 'Android' AND "user_agent" ~* 'Mobile' THEN 'mobile'
    WHEN "user_agent" ~* 'Android' THEN 'tablet'
    ELSE 'desktop'
  END
WHERE "device_type" IS NULL AND "user_agent" IS NOT NULL;--> statement-breakpoint
UPDATE "devices" SET "device_brand" = CASE
    WHEN "user_agent" ~* 'iPhone|iPad|Macintosh|Mac OS' THEN 'apple'
    WHEN "user_agent" ~* 'SM-|GT-|SC-|SAMSUNG|Galaxy' THEN 'samsung'
    WHEN "user_agent" ~* 'Redmi|POCO|Xiaomi|M2[0-9]{3}|HM ?[Nn]ote|Note ?[0-9]' THEN 'xiaomi'
    WHEN "user_agent" ~* 'Huawei|HUAWEI|ANE-|CLT-|Harmony' THEN 'huawei'
    WHEN "user_agent" ~* 'Pixel' THEN 'google'
    WHEN "user_agent" ~* 'Windows' THEN 'windows'
    WHEN "user_agent" ~* 'Macintosh|Mac OS' THEN 'macos'
    WHEN "user_agent" ~* 'Linux|Ubuntu|Fedora|CrOS' THEN 'linux'
    ELSE NULL
  END
WHERE "device_brand" IS NULL AND "user_agent" IS NOT NULL
  AND "device_type" IS NOT NULL;--> statement-breakpoint

-- ۳) P1-۲/P2-۵ — بک‌فیل مالکِ هر دستگاه از «قدیمی‌ترین هویت» (OWNER).
--    این همان قفلِ مالکیتی است که کارفرما خواسته («بعد ثبت‌نام موفق و ثبت
--    شماره در دیتابیس دستگاه کاربر قفل بشه») — فقط «ردیفِ دقیقِ دستگاه» را
--    قفل می‌کند، نه خوشه‌ی شباهتِ کاذب را. ردیف‌های بدون هویت (گوشی صرفاً
--    دیده‌شده، بدون ثبت‌نام) مالک نمی‌گیرند — طبق سیاست stage-70.
UPDATE "devices" d SET "registered_owner_phone" = sub.phone
FROM (
  SELECT DISTINCT ON (device_id) device_id, phone
  FROM "device_identities"
  ORDER BY device_id, first_login_at ASC, id ASC
) AS sub
WHERE d."id" = sub.device_id AND d."registered_owner_phone" IS NULL;--> statement-breakpoint

-- ۴) P1-۳ — رفع مسدودی‌های «خودکارِ» قدیمی: سیاست stage-70 مسدودسازیِ خودکار
--    را فقط «پس از ثبت‌نام موفق» و پشت flag اجرا می‌کند؛ مسدودی‌های auto:%
--    که با منطق قدیمی (پیش از ثبت‌نام، ریسک کاذب) ساخته شده بودند آزاد
--    می‌شوند. مسدودی «دستیِ» ادمین (blocked_reason بدون پیشوند auto:) و
--    مسدودی auto-cleared قبلی دست‌نخورده می‌مانند. برای هر ردیفِ آزادشده
--    یک رویداد AUTO_UNBLOCK در تاریخچه ثبت می‌شود.
INSERT INTO "device_events" ("id", "device_id", "phone", "event", "ip", "user_agent", "metadata", "created_at")
SELECT gen_random_uuid(), "id", NULL, 'AUTO_UNBLOCK', NULL, NULL,
  jsonb_build_object('reason', 'stage-71 migration', 'previousReason', "blocked_reason", 'riskScore', "risk_score"),
  now()
FROM "devices"
WHERE "is_blocked" = true AND "blocked_reason" LIKE 'auto:%';--> statement-breakpoint
UPDATE "devices"
SET "is_blocked" = false, "blocked_at" = NULL, "blocked_reason" = 'auto-cleared:stage-71'
WHERE "is_blocked" = true AND "blocked_reason" LIKE 'auto:%';
