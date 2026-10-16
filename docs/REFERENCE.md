# ═══════════════════════════════════════════════════════════════
# stage-57 — sinshin-food-delivery — فاز دیپلوی
# مسیر مقصد: docs/REFERENCE.md (پوشه‌ی docs — اگر نداری بساز)
# وضعیت: فایل جدید
# کامیت پیشنهادی: stage fifty-seven
# ═══════════════════════════════════════════════════════════════

# REFERENCE — مرجع عمیق سین‌شین

> این سند مکمل `README.md` است: جدول‌های کامل متغیرها، رفع اشکال‌های
> کمتر رایج (دِو و تولید)، میرورها، درگاه‌های پرداخت، تیونینگ برای سرور
> ۸ هسته/۱۶ گیگابایت و آناتومی CI/CD. راهنمای گام‌به‌گام خودِ استقرار در
> README است — اینجا فقط «چرا» و «جدول کامل».

---

## ۱) دو سیستم env — کدام فایل، کجا خوانده می‌شود؟

| فایل | کجا خوانده می‌شود | نقش |
|---|---|---|
| `.env` ریشه | docker compose (استک تولید) — `env_file` سرویس‌های api/migrate/seed/seed-deploy/postgres/backup + جایگزینی متغیرهای `${...}` در caddy/web | **تنها فایل کانفیگ تولید** |
| `apps/api/.env` | فقط اجرای API با bun روی سیستم خودت (`bun run dev`) | توسعه‌ی بدون داکر |
| `apps/api/.env.local` | اولویت بالاتر از `.env` (bun) — برای override آدرس‌ها | توسعه |
| `apps/web/.env.local` | فقط اجرای/build وب بدون داکر (VITE_*) | توسعه |
| `deploy/gitea/.env` | docker compose استک گیتا (در همان پوشه) | GIT_DOMAIN + توکن رانر |

> در استک داکری، فایل‌های داخل `apps/` به کانتینر اصلاً کپی نمی‌شوند
> (`.dockerignore`) و هیچ اثری ندارند. کامپوز فقط `.env` ریشه را می‌خواند.

مرجع کد متغیرها: `apps/api/src/infra/config/env.ts` — هر متغیری که آنجا
نباشد، اپی نمی‌خواندش (فقط docker-compose/Caddyfile مصرفش می‌کنند).

---

## ۲) جدول کامل متغیرهای `.env` ریشه (تولید)

علامت‌ها: **🔒 خودت بگذار (اجباری)** · 💡 پیش‌فرض معقول دارد (اختیاری)

### ۲-۱) دامنه و لبه

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `DOMAIN` | 🔒 | — | دامنه‌ی اصلی با `www` (بدون https) — caddy با همین نام TLS می‌گیرد؛ SITE_URL و callbackهای درگاه از همین ساخته می‌شود |
| `APEX_DOMAIN` | 🔒 | — | دامنه‌ی بدون پیشوند — فقط ریدایرکت دائمی به DOMAIN |
| `ACME_EMAIL` | 🔒 | — | ایمیل ثبت گواهی Let's Encrypt (هشدار انقضا/ابطال) |
| `GIT_DOMAIN` | 🔒 | `git.sinshin.localhost` | زیردامنه‌ی گیتا — باید عین مقدار `deploy/gitea/.env` باشد |
| `API_UPSTREAMS` | 💡 | `api:3000` | آپستریم‌های api پشت caddy — برای scale: `api:3000 api2:3000 api3:3000` |
| `SWAGGER_ENABLED` | 💡 | `false` | سرو `/swagger` و `/openapi` — در تولید خاموش |
| `HSTS_ENABLED` | 💡 | `false` | هدر HSTS بعد از اطمینان از پایداری HTTPS |

### ۲-۲) دیتابیس و رمزها

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | 💡 | `sinshin` | یوزر/نام دیتابیس — همان بماند (BACKUP و compose به آن وصل‌اند) |
| `POSTGRES_PASSWORD` | 🔒 | — | `openssl rand -base64 24` |
| `DATABASE_URL` | 🔒 | — | `postgres://sinshin:<همان رمز>@postgres:5432/sinshin` — داخلش همان رمز بالا |
| `JWT_SECRET` | 🔒 | — | `openssl rand -base64 48` — امضای توکن‌های ورود؛ لو رفتنش = جعل نشست |
| `SESSION_TTL_DAYS` | 💡 | `30` | عمر refresh token |
| `ACCESS_TOKEN_TTL_MINUTES` | 💡 | `15` | عمر access token |

### ۲-۳) ادمین‌ها و دستگاه

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `SUPER_ADMIN_PHONES` | 🔒 | — | شماره‌های ابرمدیر (کاما جدا) — خالی = پنل ادمین بی‌صاحب |
| `DEVICE_ENFORCEMENT` | 💡 | `on` | فعال‌سازی سهمیه‌ی دستگاه به‌ازای هر شماره + سقف شماره‌های هر دستگاه |
| `MAX_DEVICES_PER_USER` | 💡 | `5` | سقف دستگاه فعال هر کاربر |
| `DEVICE_MAX_PHONES_PER_DEVICE` | 💡 | `1` | سقف ثبت‌نام هر دستگاه (ویندوز/اندروید/اپل)؛ `0` = خاموش — هر دستگاه فقط یک ثبت‌نام؛ ثبت‌نام شماره‌ی دوم با `DEVICE_PHONE_LIMIT` رد می‌شود؛ ورود با شماره‌های از-قبل-ثبت‌نام‌شده همیشه آزاد |
| `DEVICE_LINK_THRESHOLD` | 💡 | `0.7` | آستانه‌ی تشابه اثر انگشت دستگاه |
| `DEVICE_AUTOBLOCK_SCORE` | 💡 | `80` | امتیاز مسدودسازی خودکار |
| `DEVICE_REFERRAL_BLOCK_AFTER` | 💡 | `3` | بعد از چند ثبت‌نامِ مشکوک، سود معرفی آن دستگاه بلوک شود |
| `DEVICE_SIMILARITY_WINDOW_DAYS` | 💡 | `7` | پنجره‌ی بررسی شباهت |

### ۲-۴) پیامک — SMS.ir

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `SMS_PROVIDER` | 🔒 | — | `real` (تولید) یا `console` (دِو — در تولید بوت را می‌کُشد) |
| `SMS_IR_API_KEY` | 🔒 | — | کلید از پنل SMS.ir (IP سرور را whitelist کن) |
| `SMS_TEMPLATE_ID_OTP` | 🔒 | — | شناسه‌ی قالب OTP (ورود) |
| `SMS_TEMPLATE_ID_COURIER_OTP` | 💡 | خالی | خالی = همان قالب OTP |
| `SMS_TEMPLATE_ID_DAILY` / `_WEEKLY` / `_HEALTH` | 💡 | خالی | گزارش روزانه/هفتگی و هشدار سلامت |
| `SMS_TIMEOUT_MS` | 💡 | `10000` | مهلت فراخوانی درگاه |

> SMS.ir با «قالب‌های تأییدشده» کار می‌کند (verify API) — آدرس گزارش در متن
> قالب است؛ بک‌اند فقط کلید و پارامترها را می‌فرستد.

### ۲-۵) درگاه پرداخت

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `GATEWAY_MODE` | 🔒 | `mock` | `direct`/`indirect` = درگاه واقعی؛ `mock` در تولید بوت را می‌کُشد |
| `ZARINPAL_MERCHANT_ID` | 💡 | خالی | کد ۳۶ کاراکتری پنل زرین‌پال |
| `ZARINPAL_SANDBOX` | 💡 | `false` | فقط دِو — سندباکس رسمی (در production بوت را می‌کُشد) |
| `SEP_TERMINAL_ID` | 💡 | خالی | ترمینال ۸ رقمی بانک سامان |
| `MELLAT_TERMINAL_ID` / `_USERNAME` / `_PASSWORD` | 💡 | خالی | ترمینال به‌پرداخت ملت |
| `PAYMENT_TIMEOUT_MS` | 💡 | `15000` | مهلت فراخوانی HTTP درگاه‌ها |

انتخاب درگاه در صفحه‌ی تسویه توسط مشتری است؛ هر کدام کلید بدهد فعال.
آدرس برگشت همه از `DOMAIN` ساخته می‌شود.

### ۲-۶) پوش نوتیفیکیشن (Web Push)

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 🔒 | خالی | `bun scripts/generate-vapid-keys.ts` — یک‌بار بساز، برای همیشه نگه دار؛ چرخش = پاک‌شدن همه‌ی اشتراک‌ها |
| `VAPID_SUBJECT` | 💡 | mailto:admin@… | شناسه‌ی تماس VAPID |
| `PUSH_TTL_SECONDS` | 💡 | `86400` | عمر پیام روی سرور پوش مرورگر |
| `PUSH_MAX_SUBS_PER_USER` | 💡 | `5` | سقف اشتراک فعال هر کاربر |

### ۲-۷) نقشه‌ی نشان

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `VITE_NESHAN_MAP_KEY` | 💡 | خالی | کلید web (SDK MapLibre) — موقع build داخل باندل می‌رود؛ دامنه‌های مجاز را در پنل نشان پر کن؛ خالی = فرم مختصات دستی |
| `VITE_NESHAN_API_KEY` | 💡 | خالی | نام قدیمی — fallback خوانده می‌شود |
| `NESHAN_SERVICE_API_KEY` | 💡 | خالی | کلید service (مسیریابی/ماتریس/آدرس معکوس) — سروری؛ IP سرور را whitelist کن؛ خالی = فاصله‌ی هوایی |
| `NESHAN_TIMEOUT_MS` / `NESHAN_CACHE_TTL_SECONDS` | 💡 | `10000`/`300` | مهلت و کش |

### ۲-۸) بکاپ (روی HDD)

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `BACKUP_DIR_HOST` | 💡 | `/srv/hdd/sinshin/backups` | مسیر بکاپ روی **HDD** — bind-mount در کانتینر backup |
| `BACKUP_HOUR` | 💡 | `5` | ساعت اجرا (تهران) — بعد از job نگهداشت ۰۴:۳۰ |
| `BACKUP_KEEP` | 💡 | `30` | نسخه‌های نگهداری‌شده (یک ماه روی HDD) |
| `BACKUP_RCLONE_REMOTE` | 💡 | خالی | مقصد offsite (بخش ۵ همین سند) |
| `BACKUP_AGE_PUBKEY` | 💡 | خالی | کلید عمومی age برای رمزنگاری E2E بکاپ offsite |

### ۲-۹) تیونینگ زیرساخت (کالیبره‌ی ۸ هسته/۱۶ گیگ)

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `PG_MAX_CONNECTIONS` | 💡 | `200` | سقف اتصال‌های پستگرس (با ریپلاها جمع می‌شود) |
| `PG_SHARED_BUFFERS` | 💡 | `256MB` | حافظه‌ی اشتراکی پستگرس |
| `PG_EFFECTIVE_CACHE_SIZE` | 💡 | `768MB` | تخمین کش OS برای planner |
| `PG_WORK_MEM` | 💡 | `8MB` | حافظه‌ی مرتب‌سازی/هاش هر عملیات |
| `REDIS_MAXMEMORY` | 💡 | `512mb` | سقف ردیس (سیاست `noeviction` — OTP/نشست بیرون نمی‌رود) |
| `DB_POOL_MAX` | 💡 | `10` | اتصال‌های هم‌زمان هر نمونه‌ی api |

> ارقام پیش‌فرض محافظه‌کارانه‌اند (برای ۸/۱۶ هم درست‌اند). اگر خواستی
> از ۱۶ گیگ کامل استفاده کنی: جدول بخش ۸.

### ۲-۱۰) سایر — jobها، گزارش، جغرافیا، مغایرت‌گیری

| متغیر | علامت | پیش‌فرض | شرح |
|---|---|---|---|
| `COUPON_SCAN_TIME` / `COUPON_NUDGE_TIME` | 💡 | `02:00`/`11:00` | کرون داخلی (تهران) |
| `HEALTH_ALERT_PHONES` | 💡 | = SUPER_ADMIN | گیرنده‌های هشدار سلامت |
| `HEALTH_ALERT_EVERY_SECONDS` / `HEALTH_ALERT_REPEAT_MINUTES` | 💡 | `60`/`60` | فاصله‌ی سنجش/یادآوری |
| `RESTAURANT_LAT` / `RESTAURANT_LNG` | 💡 | انزلی | مبدأ هزینه‌ی ارسال؛ خالی = از تنظیمات پنل |
| `GEO_BYPASS_IPS` | 💡 | خالی | IPهای عبور از سد «فقط ایران» (با کاما) |
| `GEO_FETCH_TIMEOUT_MS` / `GEO_RETRY_MINUTES` | 💡 | `10000`/`15` | دروازه‌ی جغرافیایی |
| `REFERRAL_PERCENT` | 💡 | `10` | درصد سود معرف از پرداخت آنلاین غذاها |
| `REPORT_TOKEN_TTL_HOURS` | 💡 | `24` | عمر لینک گزارش پیامکی |
| `REPORT_LOGS_MAX_MB` | 💡 | `20` | سقف لاگ داکر داخل ZIP گزارش |
| `DOCKER_LOGS_ENABLED` / `DOCKER_LOGS_TRUNCATE` | 💡 | `on`/`on` | جمع‌آوری لاگ داکر در گزارش روزانه |
| `DOCKER_SOCKET` / `DOCKER_GID` | 💡 | `/var/run/docker.sock`/`999` | gid گروه داکر میزبان: `stat -c '%g' /var/run/docker.sock` |
| `TRANSLATOR_TOKEN` | 💡 | خالی | راز مشترک api ↔ مترجم (هدر x-translator-token) |
| `TRANSLATOR_URL` | 💡 | `http://translator:8300` | آدرس داخلی مترجم NLLB |
| `RECONCILE_AUTO_R1..R10` | 💡 | همه `off` | auto-fix چک‌های مغایرت‌گیری — فقط گزارش |
| `RECONCILE_R3_WINDOW_DAYS` | 💡 | `120` | پنجره‌ی چک برداشت کیف پول |
| `UPLOAD_DIR` | 💡 | `/data/uploads` | volume کانتینر — دست نزن |

### ۲-۱۰-۱) خط تولید اعلان‌ها و یادآور کوپن (stage-68)

> سین‌شین از فاز-۲ هیچ پیامکی برای کوپن/اعلان نمی‌فرستد — کانال‌ها:
> صندوق درون‌بری (`/dashboard/notifications`)، SSE شخصی `notify:{userId}`
> و Web Push (VAPID). پیامک فقط برای OTP ورود/پیک و گزارش‌های
> روزانه/هفتگی/هشدار سلامت زنده است.

| قطعه | شرح |
|---|---|
| جاب اسکن | `coupon-scan.job.ts` — ۰۲:۰۰ تهران؛ ردیف‌های «نامزد یادآور» می‌سازد (unique(user,coupon,scanDate)، نگهداشت ۹۰ روز) |
| جاب یادآور | `coupon-nudge-notification.job.ts` — ۱۱:۰۰ تهران (stage-68: rename از `coupon-nudge-sms.job.ts`؛ فقط نام/ایمپورت — منطق و ستون `sms_sent_at` عیناً دست‌نخورده)؛ ارسال ← سپس claim؛ re-check لحظه‌ی ارسال (فعال/cron/بن/ظرفیت/گرنت)؛ ددلاین ۱۳:۰۰ |
| صندوق اعلان‌ها | TTL هفت‌روزه از لحظه‌ی «ایجاد» هر ردیف (`NOTIFICATION_TTL_DAYS=7` در سرویس؛ پاسخ `GET /notifications` همان مقدار را در `ttlDays` می‌دهد)؛ prune فیزیکی روزانه در `retention.job` |
| گارد url پخش | `POST /notifications/broadcast` — url باید مسیر داخلی باشد: شروع با `/`، بدون `//` و بدون فاصله؛ وگرنه **422** (stage-68؛ آینه‌ی چک `urlClean` پنل — مرز امنیتی سرور) |
| بج ناوبری | داشبورد کاربر: بج خوانده‌نشده روی «صندوق اعلان‌ها» (سایدبار/منوی موبایل) — همان کوئری کش‌شده‌ی صفحه‌ی صندوق؛ SSE آن را invalidate می‌کند |
| نرمال‌سازی زمان‌ها | `COUPON_NUDGE_TIME>13:00` → هشدار + clamp به ۱۱:۰۰؛ `COUPON_SCAN_TIME ≥ NUDGE` → clamp به ۰۲:۰۰؛ قالب خراب → پیش‌فرض (stage-67) |

---

## ۳) جدول متغیرهای `apps/api/.env` (توسعه)

همان متغیرهای بخش ۲ اما آدرس‌های دِو: `DATABASE_URL=postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin`،
`REDIS_URL=redis://127.0.0.1:6379`، `SMS_PROVIDER=console`، `GATEWAY_MODE=mock`،
`DEVICE_ENFORCEMENT=off`، `APP_ENV=development`، `SITE_URL=http://localhost:3001`.
شرح کامل داخل خود `apps/api/.env.example` است.

---

## ۴) رفع اشکال — توسعه

| نشانه | علت و راه‌حل |
|---|---|
| OTP نمی‌آید | `SMS_PROVIDER=console` است؟ کد در لاگ API چاپ می‌شود (نه پاسخ HTTP). نرخها: ۵/ساعت، ۲۰/روز، cooldown ۶۰ ثانیه |
| API بوت نمی‌شود «JWT_SECRET…» | `apps/api/.env` را از `.env.example` بساز؛ JWT را با openssl بگذار |
| اتصال دیتابیس رد می‌شود | compose دِو healthy است؟ (`docker compose -f docker-compose.dev.yml ps`) — پسورد همیشه `sinshin_local`؛ اگر volume قدیمی: `down -v` |
| `bun install` کند/خطا | میرور npm — بخش ۶ |
| نقشه در تسویه نیست | `VITE_NESHAN_MAP_KEY` خالی است — عمداً؛ فرم مختصات دستی جایگزین است. مقدار بدهی → rebuild وب |
| ترجمه‌ی عربی pending می‌ماند | مترجم دِو بالا نیست: `docker compose -f docker-compose.dev.yml up -d translator` + `TRANSLATOR_URL=http://127.0.0.1:8300` |
| تست پرداخت | `GATEWAY_MODE=mock` — درگاه داخلی کامل بدون پول |

## ۵) رفع اشکال — تولید (دنباله‌ی جدول README)

| نشانه | علت و راه‌حل |
|---|---|
| migrate ناموفق (exit ≠ 0) | `docker compose logs migrate` — معمولاً پسورد DATABASE_URL≠POSTGRES_PASSWORD؛ بعد از رفع: `docker compose up -d` (migrate دوباره اجرا می‌شود) |
| بیلد روی دانلود ایمیج می‌ماند | میرور مرد — URL `daemon.json` را عوض کن + `systemctl restart docker`؛ `docker pull caddy:2.10-alpine` تست |
| بیلد روی `bun install` می‌ماند | `bunfig.toml` — registry را موقتاً `https://registry.npmmirror.com` کن (سازگار با bun.lock)؛ بعد برگردان |
| caddy: `connection refused` به api | api healthy نیست (`docker compose ps`) — لاگ api؛ هِلث‌چک caddy خودش دورش می‌زند و برمی‌گردد |
| SSE قطع می‌شود | transportهای caddy: `read_timeout 60s` عمدی است — کلاینت خودکار resync سه‌کاناله دارد؛ اگر بیش‌ازحد قطع شد `API_UPSTREAMS` را چک کن |
| upload خطای write | volume `sinshin_uploads_data` روی SSD — `df -h /srv/ssd` (پر بودن دیسک) |
| sms خطای 401/403 | کلید SMS.ir یا whitelist IP — پنل SMS.ir |
| پرداخت callback رد می‌شود | آدرس سایت در پنل درگاه ثبت نشده (زرین‌پال: بخش سایت‌ها) — DOMAIN دقیق با www |
| گیتا 502 (از پشت caddy) | `docker compose -f deploy/gitea/docker-compose.yml ps` — گیتا روی `127.0.0.1:3000` و شبکه‌ی edge است؛ restart معمولاً کافی |
| رانر: `level=error` در ثبت | توکن نو بساز (Actions ← Runners) و در `deploy/gitea/.env` بگذار؛ `up -d runner` |
| استک بعد از reboot نیامد | `df -h /srv/ssd` (fstab) + `systemctl status docker` — همه `restart: unless-stopped` دارند |
| ساعت لاگ‌ها عجیب | TZ کانتینرها Asia/Tehran؛ سرور هم با گام ۱ ست می‌شود — `timedatectl` |

---

## ۶) میرورها (ایران)

| لایه | فایل | پیش‌فرض | جایگزین |
|---|---|---|---|
| Docker Hub | `/etc/docker/daemon.json` → `registry-mirrors` | `docker.mobinhost.com` | هر میرور ایرانی معتبر — فقط URL را عوض کن + `systemctl restart docker` |
| npm (bun) | `bunfig.toml` ریشه → `registry` | `registry.npmjs.org` | `https://registry.npmmirror.com` — فقط موقع مشکل شبکه؛ بعد برگردان (قفل یکپارچگی `bun.lock` رعایت می‌شود چون tarballها همان‌اند) |

> ایمیج‌های بیرونی (postgres/redis/caddy/gitea/oven-bun) بدون پیشوند
> registry نوشته شده‌اند تا میرور بدون ابهام اعمال شود — `docker pull` و
> `docker build` هر دو از آن می‌گذرند.

---

## ۷) درگاه‌های پرداخت — جزئیات

| درگاه | کلید | تست | نکته‌ی callback |
|---|---|---|---|
| زرین‌پال | `ZARINPAL_MERCHANT_ID` | `ZARINPAL_SANDBOX=true` + مرچنت UUID دلخواه | در پنل زرین‌پال «سایت» را با DOMAIN ثبت کن |
| بانک سامان (SEP) | `SEP_TERMINAL_ID` | سندباکس عمومی ندارد — ترمینال تستی بانک | callback شاپرک روی آدرس ثبت‌شده |
| بانک ملت | `MELLAT_TERMINAL_ID` + `USERNAME` + `PASSWORD` | ترمینال تستی به‌پرداخت | بعد از فعال‌سازی ترمینال، نتیجه‌ی call در پنل |
| داخلی | — | `GATEWAY_MODE=mock` | بدون پول؛ برای دِو |

- `direct` و `indirect` یکسان‌اند (هر دو = درگاه واقعی)؛ انتخاب در صفحه‌ی تسویه.
- همه‌ی مسیرهای برگشت از `DOMAIN` ساخته می‌شوند — هیچ متغیر callback جدا نیست.
- `PAYMENT_TIMEOUT_MS` روی همه‌ی فراخوانی‌های HTTP درگاه‌ها اعمال می‌شود.
- بازگشت وجه از پنل ادمین (سفارش ← بازگشت) برای همه‌ی درگاه‌ها پیاده است.

---

## ۸) تیونینگ برای ۸ هسته / ۱۶ گیگابایت

سقف‌های فعلی compose (استیج-۵۷) برای ۸/۱۶ کالیبره شده — مجموع سقف‌ها ~۱۰.۵
گیگ تا میزبان (OS + page cache + گیتا) همیشه سهم خودش را داشته باشد:

| سرویس | CPU | RAM | منطق |
|---|---|---|---|
| api | 4 | 2g | Elysia+SSE+web-push؛ چند نمونه‌اش (scaled) همان سقف |
| web | 2 | 1536m | SSR تانک‌استک — فشرده |
| postgres | 4 | 4g | پرکارترین؛ حافظه‌ی اشتراکیش از .env |
| translator | 4 | 3g | مدل int8 + beam search — جدا بالا/پایین می‌شود |
| redis | 1 | 1g | OTP/نشست — noeviction |
| backup | 1 | 512m | فقط pg_dump شبانه |
| caddy | 1 | 256m | پروکسی/TLS — کم‌مصرف |
| gitea | 2 | 1g | sqlite تک‌کاربره |
| runner | 1 | 512m | فقط هماهنگی؛ سنگینی در jobها است |

**اگر خواستی از ۱۶ گیگ کامل استفاده کنی** (در `.env`):

```
PG_SHARED_BUFFERS=2GB
PG_EFFECTIVE_CACHE_SIZE=6GB
PG_WORK_MEM=16MB
PG_MAX_CONNECTIONS=300
REDIS_MAXMEMORY=1gb
DB_POOL_MAX=15
```

> این‌ها سقف‌اند نه رزرو — مصرف عادی خیلی پایین‌تر است؛ هدف فقط مهارِ نشتِ
> حافظه‌ی یک کانتینر است که نتواند بقیه را بکُشد.

---

## ۹) آناتومی CI/CD (گیتا + act_runner)

**زنجیره:** `git push gitea main` → گیتا (Actions) → رانر `sinshin-deploy`
(برچسب `deploy`) → job `deploy` (۵ قدم). همه روی خود سرور — بدون گیت‌هاب.

**چرا این شکل؟**

- `runner-config.yaml`: `capacity: 1` → استقرارها صف می‌شوند (دو up هم‌زمان
  استک را نترکانند)؛ `timeout: 60m` → بیلدِ با کش خالی هم تمام می‌شود؛
  `cache.enabled: false` → workflow هیچ اکشن بیرونی (uses:) ندارد تا
  نیازی به github.com نباشد؛ `workdir_parent: /tmp/act-runner-work`.
- رانر `network_mode: host` + ماونت `docker.sock` و `/opt/sinshin-food-delivery`
  → دستورهای job مستقیم روی همان داکر/کدِ میزبان اجرا می‌شوند.
- **دروازه‌ی کیفیت داخل `oven/bun:1.3.14-slim` اجرا می‌شود** (`docker run
  --rm -v /opt/...`) — نسخه‌ی bun دقیقاً هم‌قِد Dockerfileهای api/web و
  از کش موجود؛ رانر خودش bun ندارد. کش نصب باندل هم بین اجراها در volume
  `sinshin_ci_bun_cache` می‌ماند.
- **تگ‌های rollback:** بعد از هر build موفق، ایمیجها `sinshin/<svc>:<sha7>`
  تگ می‌خورند → `deploy/rollback.sh` بدون build برمی‌گردد؛ `docker image
  prune` این‌ها را نمی‌بیند (dangling نیستند) — فقط خودت با rollback یا
  `docker rmi` پاکشان کن.
- سلامت‌سنجی job: `curl http://localhost/api/health` — ۱۲×۱۰ ثانیه؛ jobِ
  قرمز یعنی استک بالا نیامده (لاگ همان‌جا).

**آپدیت ایمیج‌های پایه (رویه‌ی امن):**

```bash
cd /opt/sinshin-food-delivery
# بکاپ دستی بگیر (یا صبر کن شبانه):
docker compose exec backup echo "پیش از آپدیت — از آخرین بکاپ مطمئن شو"
docker compose pull postgres redis caddy        # فقط نسخه‌های پچ
docker compose up -d
docker compose ps && curl -s localhost/api/health
# اگر مشکل بود: rollback کانتینرها با نسخه‌ی قبلی ایمیج (docker tag) یا restore بکاپ
```

> نسخه‌های major (مثل postgres 18→19) هرگز بدون تست روی دِو و مطالعه‌ی
> release notes مهاجرت نشوند — pg_dump/restore مسیر ارتقای major است.

**ثابت‌های امنیتی کد (نه env):** OTP ۶رقمی/TTL ۱۲۰ث/cooldown ۶۰ث/۳ تلاش/
۵ در ساعت/۲۰ در روز؛ access token ۱۵ دقیقه؛ cookie رفرش HttpOnly+SameSite=Lax
(در prod اضافه‌ی Secure).

---

## ۱۰) بکاپ offsite — راه‌اندازی (اختیاری)

سرویس backup اگر `BACKUP_RCLONE_REMOTE` ست باشد، بعد از هر بکاپ موفق
`rclone copy` می‌زند (و با `BACKUP_AGE_PUBKEY` رمزنگاری E2E قبل از upload):

```bash
# ۱) روی سرور، rclone را برای مقصدت کانفیگ کن (یک‌بار):
rclone config   # → remote جدید، مثل b2 (Backblaze) یا هر S3

# ۲) کلید عمومی age (روی سیستم خودت بساز، عمومی را بفرست):
age-keygen -o ~/.config/age/key.txt        # خصوصی — هیچ‌جا نفرست
cat ~/.config/age/agePublicKey             # ← این را در BACKUP_AGE_PUBKEY بگذار

# ۳) در .env:
# BACKUP_RCLONE_REMOTE=b2:sinshin-backup
# BACKUP_AGE_PUBKEY=age1...

# ۴) اعمال:
docker compose up -d backup
```

> کانتینر backup ایمیج postgres:18.6-alpine است و rclone/age داخلش نیست —
> این دو خط مرحله‌ی offsite در محیطِ «میزبان» اجرا نمی‌شوند بلکه اگر بیلد
> سفارشی بخواهی، Dockerfile سرویس backup را با `apk add rclone age` گسترش
> بده؛ تا آن زمان، offsite را با cron میزبان انجام بده:
> `0 6 * * * rclone copy /srv/hdd/sinshin/backups b2:sinshin-backup --min-age 1m`
## ۲-۱۰-۲) stage-70 — سلامت دستگاه: قفل مالکیت «فقط پس از ثبت‌نام موفق»

### رفتار جدید (خلاصه)

| موضوع | قبل | بعد (stage-70) |
|---|---|---|
| اثر جانبی تأیید OTP | `resolve()` بلافاصله device+لینک+ریسک می‌ساخت و auto-block می‌زد — حتی اگر ثبت‌نام بعدش رد می‌شد | `peek()` فقط-خواندنی؛ همه‌ی اثرها در «یک تراکنش» فقط بعد از موفقیت ثبت‌نام/ورود |
| سقف «هر دستگاه یک ثبت‌نام» | روی «کل خوشه‌ی شباهت» (لینک کاذب = قفل بی‌گناه) | فقط روی «همان ردیفِ دستگاه» با claim اتمیک `registered_owner_phone` |
| مسدودسازی خودکار | قبل از بررسی قوانین/سقف، بدون flag، سشن‌ها را هم می‌بُرید | فقط بعد از ثبت‌نام موفق + پشت `DEVICE_ENFORCEMENT` + آستانه‌ی `DEVICE_AUTOBLOCK_SCORE` |
| سیگنال‌های unavailable | هشِ مشترک = امتیاز شباهت (۰.۷۰ = آستانه!) → لینک کاذب | پروتکل missing — هیچ امتیازی؛ لینک نیاز به ≥۲ سیگنال واقعی دارد |
| هش مرکبِ کیفیت‌پایین | دو مرورگر حریم‌خصوصی = یک device (ادغام کاذب) | scope به clientId/شماره — ادغام بین‌کاربر ناممکن |
| canvas-drift | یک تغییر = پرچم (+۲۵ ریسک) | فقط «دو تغییر متوالی» (prev_canvas_hash) |
| clientId در دیتابیس | ایندکس عادی — race = دو ردیف | ایندکس یکتای شرطی + درج race-safe (ON CONFLICT → re-find) |
| کاندیدهای شباهت | `limit(500)` بدون مرتب‌سازی | `orderBy(last_seen_at desc)` صریح |

### مایگریشن ۰۰۰۵ (`0005_stage70_device_integrity.sql`)

کاملاً افزایشی + بک‌فیل داده:

1. پنج ستون جدید: `device_type` / `device_brand` / `device_model` / `registered_owner_phone` / `prev_canvas_hash`
2. **dedupe clientId** (ناشی از race قدیمی) سپس `devices_client_id_uidx` یکتای شرطی
3. بک‌فیل نوع/برند از `user_agent` (مدل عمداً خالی — با ورود بعدی کاربر پر می‌شود)
4. بک‌فیل `registered_owner_phone` از قدیمی‌ترین identity هر دستگاه (قفل‌های معتبر قبلی حفظ می‌شوند)
5. **رفع مسدودی‌های خودکارِ قدیمی**: ردیف‌های `blocked_reason LIKE 'auto:%'` آزاد می‌شوند (با رویداد `AUTO_UNBLOCK` در تاریخچه). مسدودی‌های دستی ادمین دست‌نخورده.

> بعد از جای‌گذاری: `cd apps/api && bun run db:migrate` سپس `docker compose up -d --build web api`

### نکته‌های عملیاتی

- **دستگاه‌های auto-block قدیمی**: مهاجرت خودش آزادشان می‌کند؛ اگر خواستی ببینی کدام‌ها بودند، `device_events` با `event='AUTO_UNBLOCK'` را ببین. مسدودی دستی: پنل ادمین → دستگاه‌ها.
- **پیکربندی بدون تغییر**: `DEVICE_ENFORCEMENT`/`DEVICE_MAX_PHONES_PER_DEVICE`/`DEVICE_LINK_THRESHOLD` همان قبل؛ فقط معنایشان دقیق‌تر شد (سقف روی ردیف دقیق، نه خوشه). کلاینت قدیمیِ کش‌شده هم بی‌خطر است — سرور هشِ 'unavailable' قدیمی را هم missing می‌شناسد.
- **iOS و «نام دستگاه»**: سافاری iOS شناسه‌ی مدل را به وب نمی‌دهد (UA فریز است)؛ طبق تصمیم کارفرما این کاربران «اپل · iOS 17.5» می‌بینند. اندروید (کروم: از high-entropy؛ بقیه: از UA) و دسکتاپ مدل واقعی می‌دهند. نقشه‌ی اپل (تا iPhone 16) embed شده و هر شناسه‌ای که در دسترس باشد (WebViewها) به نام بازاریابی ترجمه می‌شود.
- `device_type/brand/model` فقط نمایشی‌اند — در سهمیه/ریسک/لینک هیچ دخلی ندارند و جعلشان بی‌اثر است.

### تست‌ها (E2E واقعی)

سوئیت HTTP + سرویس + مرورگر — جزئیات در ورک‌لاگ استیج ۷۰؛ سنجه‌های کلیدی:
لینک کاذب unavailable صفر • ادغام کاذب کیفیت‌پایین صفر • سقف فقط روی ردیف دقیق • رقابت هم‌زمان دو شماره = دقیقاً یک برنده • terms=false هیچ ردیف دستگاهی نمی‌سازد • auto-block با flag خاموش خاموش • deviceId یکتا در رقابت درج • فیلتر نوع/برند کاربران واقعی • «نام دستگاه» در کارت/جزئیات/پروفایل.

## ۲-۱۰-۳) stage-71 — رفع حلقه‌ی رندر پروفایل + بازیابی بک‌فیل‌های مایگریشن

### رفع حلقه‌ی «Maximum update depth» در /dashboard/info

علت (مستقل از زبان): هوک `useUserInfoPage` (فرم اطلاعات کاربری) پروفایل سرور را
به‌صورت آبجکتِ inline از والد می‌گیرد (هر رندر = رفرنس تازه) و در `useEffect` با
dep همان آبجکت، اکشن `HYDRATE` را dispatch می‌کرد؛ reducer هم همیشه آبجکت جدید
برمی‌گرداند ⇒ dispatch→رندر→افکت→dispatch… بی‌نهایت. React بعد از ~۵۰ آپدیت
تودرتو «Maximum update depth exceeded» می‌انداخت (در تست واقعی: ۱۰۲ خطا در یک
بازدید). هر زمان «داده‌ی کاربر» در بازدید لود شده باشد حلقه روشن می‌شد؛
«فقط عربی» بودنش از ترتیب تست راند ۷۰ بود (بازدید اولِ سرد هنوز داده نداشت)،
نه از خودِ زبان — در فارسی هم با داده‌ی آماده رخ می‌داد.

دو لایه‌ی رفع در `useUserInfoPage.ts` (رفتار کاربر صفر-تغییر):

1. **گارد مقداری در افکت** — HYDRATE فقط وقتی dispatch می‌شود که مقدار
   فیلدها واقعاً با سرور فرق دارد.
2. **bail-out در reducer** — HYDRATE با مقادیر یکسان، همان رفرنس وضعیت را
   برمی‌گرداند (React خودش از رندر صرف‌نظر می‌کند). `MARK_SAVED` هم همین‌طور.

معنای «ویرایش امن» دست‌نخورده: تا کاربر تایپ کند (`isDirty`) سینک سرور غیرفعال
است؛ بعد از ذخیره (MARK_SAVED) دوباره هیدریت می‌شود. تست مرورگر: تایپ نام →
ذخیره → ریلود → نام در فیلد (هیدریشن سالم)، صفر خطای کنسول.

### مایگریشن ۰۰۰۶ (`0006_stage71_device_backfills.sql`) — منسوخ در stage-72

کامیت «stage seventy» مایگریشن ۰۰۰۵ را با `drizzle-kit generate` بازتولید کرد
(`0005_many_marvel_zombies` — ستون‌ها/ایندکس‌ها هست)؛ بک‌فیل‌های داده‌ی نسخه‌ی
دستی stage-70 در آن نیامدند. ۰۰۰۶ همان بک‌فیل‌ها را «ایدمپوتنت» بازیابی می‌کرد:

1. خنثی‌سازی clientId تکراری (no-op بعد از ایندکس یکتای ۰۰۰۵) + `IF NOT EXISTS`
   برای هر دو ایندکس
2. بک‌فیل نوع/برند از `user_agent` (فقط ردیف‌های NULL)
3. بک‌فیل `registered_owner_phone` از قدیمی‌ترین identity (فقط ردیف‌های NULL)
4. آزادسازی مسدودی‌های `auto:%` قدیمی + رویداد `AUTO_UNBLOCK` (مسدودی دستی
   و `auto-cleared` قبلی دست‌نخورده)

> **stage-72**: این فایل به‌همراه snapshot و ورودی journal آن حذف شد — بک‌فیل‌ها
> به ران‌تایم `db:migrate` منتقل شدند (بخش ۲-۱۰-۴). دلیل: مایگریشنِ داده‌ایِ
> دستی با «تولید با drizzle-kit» ناسازگار است و ترتیبِ «ایندکس یکتا قبل از
> خنثی‌سازیِ تکراری‌ها» روی دیتابیس واقعی خطا می‌داد.

> بعد از جای‌گذاری: `cd apps/api && bun run db:migrate` سپس
> `docker compose up -d --build web api`

### نکته‌های عملیاتی (نسخه‌ی stage-71 — توسط stage-72 منسوخ)

- **اگر ۰۰۰۵ هنوز روی دیتابیس واقعی اجرا نشده و clientId تکراری دارید**: ۰۰۰۵
  (نسخه‌ی بازتولیدشده) موقع ساخت ایندکس یکتا خطا می‌دهد (خودش dedupe ندارد).
  راه‌حل: statement خنثی‌سازیِ بخش ۱ مایگریشن ۰۰۰۶ را دستی اجرا کنید، بعد
  `bun run db:migrate` — بقیه‌ی زنجیره ادامه می‌یابد. *(stage-72: دیگر لازم
  نیست — db:migrate خودش قبل از اعمال زنجیره خنثی‌سازی می‌کند؛ بخش ۲-۱۰-۴)*
- اجرای دوباره‌ی ۰۰۰۶ = no-op کامل (همه‌ی بلاک‌ها شرطی‌اند).
- بک‌فیل مالک، قفل‌های «جدید» را بازنویسی نمی‌کند — فقط ردیف‌های NULL را پر
  می‌کند؛ claimهای stage-70 که در حین ثبت‌نام ست شده‌اند معتبر می‌مانند.

## ۲-۱۰-۴) stage-72 — معماری مایگریشن «drizzle-kit خالص» + بک‌فیل ران‌تایم

### اصل

زنجیره‌ی مایگریشن (`drizzle/000*.sql` + `meta/*_snapshot.json` + `_journal.json`)
الان و برای همیشه **صورتِ تولیدشده با `drizzle-kit generate`** است — هیچ
SQL داده‌ایِ دستی داخل زنجیره نیست. مایگریشن ۰۰۰۶ِ دستی stage-71 (فایل +
snapshot + ورودی journal) حذف شد؛ در عوض `db:migrate` سه‌مرحله‌ای شد:

```
bun run db:migrate   (src/infra/db/migrate.ts)
├─ ۱) گیت داده (src/infra/db/backfills.ts — preMigrateDedupClientIds)
│     خنثی‌سازی clientIdهای تکراری — «قبل» از DDL تا CREATE UNIQUE INDEX
│     مایگریشن ۰۰۰۵ روی دیتابیس‌های قدیمی با داده‌ی تکراری موفق شود
│     (خودِ خطا: duplicate key → زنجیره روی ۰۰۰۵ می‌ایستاد)
├─ ۲) drizzle migrate — فقط زنجیره‌ی DDL تولیدشده با drizzle-kit
└─ ۳) بک‌فیل داده (postMigrateDeviceBackfills) — ایدمپوتنت:
      • نوع/برند از user_agent (هم‌راستا با deriveLegacyDevice؛ اندرویدِ
        ناشناخته برند null می‌گیرد نه «linux»، Mac→macos در دسترس)
      • مالک از «اولین REGISTER موفقِ همان ردیف» در device_events —
        هم‌معنای claim ران‌تایم stage-70 (نه از LOGIN قدیمی)
      • آزادسازی مسدودی‌های auto:% + رویداد AUTO_UNBLOCK
```

هر سه مرحله ایدمپوتنت‌اند: اجرای دوباره روی هر وضعیتی = no-op. تایم‌اوتِ
کوئری برای این اسکریپت ۵ دقیقه است (بک‌فیلِ جدول بزرگ) — pool تک-اتصالی.

### جریانِ کارفرما بعد از تغییر اسکیما

```bash
cd apps/api
bun run db:generate          # drizzle-kit: اسکیما → 0006_*.sql + snapshot + journal
bun run db:migrate           # اعمال (گیت داده + DDL + بک‌فیل)
bun run db:test:migrations   # (اختیاری) سوئیت E2E روی دیتابیس‌های موقتی
```

`db:generate` روی اسکیمای فعلی = «No schema changes» (زنجیره با اسکیما
هم‌راستاست)؛ بعد از هر تغییر اسکیما، مایگریشن بعدی (۰۰۰۶ به بعد) با همان
دستور تولید می‌شود — با snapshot و ورودی journal خودش.

### تست E2E (`scripts/test-migrations.ts` — ۳۵ بند، PostgreSQL واقعی)

روی دیتابیس‌های موقتیِ همان سرور (هرگز به دیتابیس اصلی دست نمی‌زند؛
پیش‌نیاز: اختیار CREATE DATABASE):

- **A** بازتولید خطای پروداکشن (migrator قدیمی بدون گیتِ pre روی clientId
  تکراری = duplicate key + rollback اتمی) → db:migrate جدید همان DB را شفا
  می‌دهد → ماتریس ۸تایی نوع/برند + مالک فقط-از-REGISTER + آزادسازی
  auto:% (مسدودی دستی محفوظ) → اجرای دوباره = صفر تغییر
- **B** فریش: زنجیره‌ی کامل + بک‌فیل no-op + تکرار no-op
- **C** «پروداکشن روی ۰۰۰۵»: ردیف‌های legacy بعد از ستون‌ها → بک‌فیل + تکرار
- **D** journal جلوتر از زنجیره (۰۰۰۶ِ قدیمیِ اعمال‌شده): رد شدن بی‌خطر بدون
  اعمال مجدد (سازگاری با دیتابیس‌هایی که ۰۰۰۶ِ دستی را اجرا کرده‌اند)

### بازیابی دیتابیسِ خطاخورده (وضعیت کارفرما)

اگر `db:migrate` قبلاً روی ۰۰۰۵ با «duplicate key / devices_client_id_uidx»
خطا خورده باشد، دیتابیس اتمی رولبک شده (همان ۰۰۰۴ مانده). بعد از
جای‌گذاری فایل‌های stage-72 فقط:

```bash
cd apps/api && bun run db:migrate
```

گیتِ داده تکراری‌ها را خنثی می‌کند → ۰۰۰۵ اعمال می‌شود → بک‌فیل‌ها پر
می‌شوند. هیچ دست‌کاریِ دستی لازم نیست.

---

## ۲-۱۰-۵) stage-73 — پاک‌سازیِ نسخه‌دارِ `auto:%` + سیاست جدید قفل دستگاه

### الف) «پاک‌سازی یک‌باره» — چرا و چطور

**باگ (یافته‌ی ۲ اسکن راند ۷۳):** بندِ آزادسازی مسدودی‌های `auto:%` در
بک‌فیل stage-72 در «هر» اجرای `db:migrate` تکرار می‌شد. مسدودیِ خودکاری که
بعد از deploy قبلی با منطق درست stage-70+ ساخته شده بود، در deploy بعدی
آزاد می‌شد — یعنی قفل‌های خودکار هرگز پایدار نبودند.

**رفع:** همان‌طور که خواستید، پاک‌سازی حالا «مهاجرت داده‌ی یک‌باره و
نسخه‌دار» است:

- جدول `backfill_runs` (DDL خالص — با همان `bun run db:generate` تولید
  می‌شود؛ اصل ۲-۱۰-۴ حفظ شد) دفتر ثبت است.
- بند ③ (آزادسازی `auto:%`) فقط یک‌بار در عمرِ دیتابیس اجرا می‌شود
  (مارکر `device-auto-unblock` نسخه ۱).
- بندهای ①/② (نوع/برند/مالک) همچنان در هر اجرا — فقط null می‌پرند و
  تکرارشان بی‌ضرر است؛ ردیف legacy در هر زمانی شفا می‌یابد.
- **تشخیصِ خودکارِ دیتابیسِ کاری:** اگر رویداد `AUTO_UNBLOCK` یا ردیف
  `auto-cleared:backfill` (شواهدِ اجرای stage-72) موجود باشد، فقط مارکر
  ثبت می‌شود و هیچ آزادسازی‌ای تکرار نمی‌شود — مسدودی‌های `auto:%`
  بعد از stage-72 شما دست‌نخورده می‌مانند.
- **شیر اطمینان اپراتور** (اگر بخواهید مطمئن‌تر باشید):

```bash
# قبل از اولین db:migrate استیج ۷۳، چک کنید:
psql "$DATABASE_URL" -c "select count(*) from devices where is_blocked and blocked_reason like 'auto:%';"
# اگر > 0 و می‌خواهید همه حفظ شوند، یک‌بار با پرچم اجرا کنید:
DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK=1 bun run db:migrate
# (بندهای بی‌ضرر اجرا می‌شوند؛ آزادسازی رد؛ مارکر ثبت — دفعات بعد عادی)
```

هر آزادسازی، رویداد `AUTO_UNBLOCK` با `reason=versioned backfill v1`
می‌نویسد → در پنل ادمین قابل بازبینی/جبران است.

**جریان شما بعد از stage-73:**

```bash
cd apps/api
bun run db:generate    # 0006_*.sql (فقط CREATE TABLE backfill_runs) + snapshot + journal
bun run db:migrate     # زنجیره + بک‌فیل ①/② + پاک‌سازیِ نسخه‌دار (تشخیص خودکار)
bun run db:test:migrations   # (اختیاری) ۵۷ بند روی دیتابیس‌های موقتی
bun run db:test:device       # (اختیاری) ۱۹ بندِ سیاست دستگاه
```

### ب) سیاست قفل دستگاه — تصمیم شما، پیاده‌سازی‌شده در همین استیج

fingerprint وب «شناسه‌ی قطعی سخت‌افزار نیست» (دو آیفونِ هم‌مدل/هم‌نسخه
سیگنال‌های کاملاً یکسان بدهند). دو گزینه روی میز بود:

| | گزینه الف: سخت فقط روی پروفایل مرورگر | گزینه ب: سخت روی کل خوشه |
|---|---|---|
| قفلِ ثبت‌نام دوم | فقط وقتی storage زنده است (clientId) | حتی بعد از پاک‌کردن storage |
| قفل کاذب کاربران واقعی | ندارد (طراحی جدید) | **برمی‌گردد** (باگ P1-۲ راند ۷۰) |

**پیاده‌سازی = گزینه الف + سیگنال‌های نرم روی خوشه** (بدون برگرداندن قفل
کاذب):

1. **هش مرکب شماره-scoped شد** (یافته‌های ۳/۴): لایه‌ی ۲ فقط در محدوده‌ی
   «همان شماره» هویت است — `FP = sha256(سیگنال‌ها + شماره)`. نتیجه:
   - غریبه با سخت‌افزار مشابه، ردیفِ شما را پیدا نمی‌کند → ردِ کاذب حذف؛
   - خودِ شما بعد از پاک‌کردن storage، با همان شماره همان ردیف را
     می‌یابید (تاریخچه/سهمیه ادامه می‌یابد)؛
   - متخلفی که storage را پاک کند و شماره‌ی دوم بیاورد → ردیفِ تازه +
     «لینک شباهت» → سیگنال نرم.
2. **سختِ واقعی** فقط روی پروفایل مرورگر (لایه‌ی ۱ clientId — claim اتمیک
   مالکیت، `DEVICE_MAX_PHONES_PER_DEVICE`، پیش‌فرض ۱).
3. **نرم روی خوشه** (بدون ردِ ورود): لینک‌ها + ریسک‌فلگ `crowded-cluster`
   (≥۴ شماره) + ردِ پاداش معرف (`DEVICE_REFERRAL_BLOCK_AFTER`، پیش‌فرض ۳).
   دفعات زیاد = پرچم/امتیاز برای ادمین، نه قفلِ خودکار کاربر واقعی.

**حد باقی‌مانده (صادقانه):** پاک‌کردن storage + شماره‌ی تازه = ثبت‌نام
موفق (با لینک و فلگ). fingerprint وب ذاتاً نمی‌تواند این را «سخت» بگیرد
بدون قفل کاذب. اگر روزی خواستید سخت‌تر شود، فقط env را تغییر دهید
(`DEVICE_REFERRAL_BLOCK_AFTER=2` یا تصمیمِ کسب‌وکار روی کوپنِ خوش‌آمد) —
بدون تغییر کد.

### ج) «هرگز-پرتاب-نکن» جمع‌آوری سیگنال (یافته‌ی ۵)

`getClientId`/`collectDeviceSignals` در مرورگرهای قفل‌شده (Block All
Cookies) دیگر شکست نمی‌خورند: هر مخزن جداگانه best-effort،
`randomUUID` با fallback، و در زمینه‌های ناامن (HTTP) همه‌ی هش‌ها
missing (قرارداد stage-70+) — مسیر تأیید OTP همیشه زنده می‌ماند.
تست: `cd apps/web && bun run test:device` (۱۱ بند).

---

## ۲-۱۰-۶) stage-74 — «مجموع پرداخت‌ها» فقط پولِ واقعی + لغوی زرین‌پال + پایداری PWA

### الف) قرارداد مالی «پولِ واقعاً دریافت‌شده»

جمعِ مبلغِ هر آمار مالی فقط روی سفارش‌هایی که **`payment_status='SUCCESS'
و `status<>'CANCELED'`** دارند حساب می‌شود (REFUNDED هم بیرون می‌ماند —
پول برگشته). این قرارداد از قبل در admin.service (درآمد KPI)،
report-query و myReferrals بود؛ **تنها جایی که جا افتاده بود
`myOrdersPage.totalSpent` بود** — همان باکس «مجموع پرداخت‌ها» در صفحه‌ی
سفارشات، که سفارشِ PENDING_PAYMENT (مثل پرداختِ لغوشده در زرین‌پال) را هم
جمع می‌زد. رفع: aggregate با `sum(...) filter (where payment_status='SUCCESS'
and status<>'CANCELED')` — شمارشِ `total` دست‌نخورده (لیست همه‌ی سفارش‌ها
را نشان می‌دهد).

### ب) callback زرین‌پال — لغو، شکلِ پاسخ، و خطای شبکه

**ریشه‌ی «سفارش تا ابد در انتظار پرداخت»:** زرین‌پال برای پرداختِ
لغوشده (Status=NOK در callback) در Verify پاسخی برمی‌گرداند که کدش
غالباً در **آرایه/شیءِ `errors`** می‌آید نه `data.code`. آداپتور فقط
`data.code` می‌خواند ⇒ undefined ⇒ indeterminate ⇒ سفارش PENDING می‌ماند
تا R12ِ ۲۴ساعته. رفع: کدهای -9/-10/-11 از **هر دو شکل** خوانده می‌شوند
(آرایه و شیء) ⇒ شکستِ قطعی ⇒ سفارش CANCELED + آزادسازی کیف/کوپن.

**چرا Status=NOK به‌تنهایی نهایی نمی‌کند؟** پارامترِ کوئری قابلِ جعل
است (state در URL پرداختِ خودِ کاربر است). منبعِ حقیقت فقط پاسخِ
سرور-به-سرورِ Verify است: پرداختِ واقعی + NOK جعلی ⇒ Verify=100 ⇒ موفق
(Verify مقدم). NOK فقط لاگ می‌شود — شکلِ واقعی پاسخِ indeterminate هم
لاگ می‌شود تا کدهای جدیدِ درگاه در تست‌های عملی دیده شوند.

**باگ جدید (کشف stage-74):** خطای شبکه در verify (تایم‌اوت/قطعی) تا
`runCallbackSafe` سرریز می‌کرد و مشتریِ تازه-پرداخت‌کرده **JSON خامِ 500**
می‌دید. الان: catch ⇒ indeterminate ⇒ 302 به صفحه‌ی سفارش با
`payment=pending` — کارِ تایم‌اوتِ ۵ دقیقه‌ای بعداً قطعی‌اش می‌کند.

### ج) پایداری PWA — معماری «هیچ درخواستی برای همیشه معلق نمی‌ماند»

علتِ «فریز نیم‌ساعته‌ی ادمین»: توکنِ ۱۵ دقیقه‌ای منقضی می‌شود ⇒ اولین
401 وارد `tryRefresh` می‌شود ⇒ تایمرِ refresh بعد از **headers** پاک
می‌شد و `res.json()` بی‌مرز بود ⇒ **refreshPromise مشترک** بین همه‌ی
درخواست‌های احراز برای همیشه معلق ⇒ کل پنل فریز؛ بستنِ اپ = ری‌ستِ
state ماژول. سه لایه‌ی رفع:

1. **`fetchWithTimeout` (api-fetch):** تایمر تا «پایان خواندنِ بدنه»
   زنده می‌ماند — پاسخ با Proxy پوشیده شده؛ بودجه = کلِ چرخه
   (اتصال+headers+بدنه). abort ⇒ خواندن reject.
2. **`tryRefresh` (auth-session):** ددلاین سرتاسری (fetch+بدنه) +
   **watchdog**: promise در سقفِ (۲×مهلت+۵s) «همیشه» settle می‌شود و
   `refreshPromise` آزاد می‌شود (finally روی خودِ promise) — حتی با
   باگِ آینده. watchdog فقط false (بدون خروج؛ خروج فقط از 401/403 قطعیِ
   خودِ سرور). 2xx بدون accessToken ⇒ false نرم (قبلاً undefined در
   setAccessToken می‌نشست و hasSession بی‌توکن true می‌شد).
3. **`sse-client` (فایل جدید):** کلاینتِ مشترکِ fetch-SSE —
   تایم‌اوتِ اتصال ۱۵s (headers گیر نکند) + **watchdog سکوت ۴۵s**
   (سرور هر ۱۵s ضربان می‌فرستد؛ نبودِ ۳ ضربان = مرگِ خاموش ⇒ بازسازی)
   + retry ۶۰s + بازسازی روی online/برگشت از پس‌زمینه (استریمِ کهنه >
   ۲۰s = بازسازی فوری — سوکتِ پس‌زمینه مرده). مصرف‌کنندگان:
   useAdmin2Panel + useNotificationInboxPage (useMenuLive با EventSource
   مرورگر — بدون auth — دست‌نخورده).

**پولینگ پس‌زمینه:** قبلاً PAID در صف ⇒ ۲.۵s حتی در تب مخفی
(~۱۴۴۰ req/h). الان: پس‌زمینه = ۳۰s (با SSE ۶۰s) + **refetch فوری روی
برگشت به اپ** (visibilitychange).

### تست‌ها (stage-74 — همه روی سرویس/سرور واقعی)

| تست | بند | دستور |
|---|---|---|
| آداپتور زرین‌پال (هر دو شکل errors، ضد-جعل، پارامترها) | ۱۶ | `cd apps/api && bun run db:test:zarinpal` |
| مسیر پول (myOrdersPage + callback×۵ روی PG واقعی) | ۱۸ | `cd apps/api && bun run db:test:pay` |
| fetchWithTimeout (بدنه‌ی گیرکرده/کند/abort بیرونی) | ۵ | `cd apps/web && bun run test:fetch-timeout` |
| auth-session (watchdog/پیوند/401/429/آزادسازی) | ۱۲ | `cd apps/web && bun run test:auth-session` |
| sse-client (مرگ خاموش/تایم‌اوت اتصال/wake/stop) | ۱۸ | `cd apps/web && bun run test:sse-client` |

مجموع: **۶۹ بند** — PG امبدد (`sinshin_e2e_pay_…`) برای مسیر پول؛
بقیه بدون دیتابیس.

## ۲-۱۰-۷) stage-75 — خطایابیِ تست نشست (محیط‌زدگی) + بستنِ P3های باقی‌مانده‌ی scan-72

### الف) راستی‌آزمایی کامیت seventy-four + ریشه‌یابیِ ۶ خطای «test:auth-session»

کامیت `11f0cea` بایت‌به‌بایت با تحویل ۷۴ راستی‌آزمایی شد (۱۷/۱۸ یکسان؛
`sse-client.ts` فقط تفاوتِ تورفتگی — محتوای منطقی یکسان).

شش خطای گزارش‌شده (R1×2، R4-hits=0، R4-آزادسازی، R5، R7-پس‌از-watchdog)
با الگوی `hits=0` + `dt≈2ms` قابل بازتولید کامل بود:

**ریشه — محیط‌زدگیِ تست، نه باگِ ماژول.** Bun هنگام اجرای
`bun scripts/test-auth-session.ts` (از `apps/web`) فایل‌های `.env` همان
پوشه را در `import.meta.env` بار می‌کند. در محیطِ توسعه‌ی روشنِ شما
`VITE_API_URL` ست است ⇒ `refreshFetch` (auth-session.ts:67 —
`import.meta.env.VITE_API_URL || window.location.origin`) به «API واقعی»
می‌رفت: بدون کوکی ⇒ 401ِ فوری ⇒ خروج و پاک‌شدنِ توکن ⇒ دقیقاً همان ۶
خطا (و دقیقاً همان ۶ موفقیتِ «انتظارِ شکست»). نشانه‌ها:
`hits=0` (هیچ درخواستی به سرورِ تست نرسید)، `dt≈0-2ms` (پاسخِ فوریِ
401، نه گیرکردن).

**اثبات (بازتولید + شفا):** سرورِ 401ِ جعلی روی پورت 9899 + `.env` با
`VITE_API_URL=http://localhost:9899` ⇒ تستِ ۷۴ دقیقاً **۶ ✓ / 6 ✗** با
همان شش خطا. سپس تستِ ۷۵ (هرمتیک) در «همان محیطِ آلوده» ⇒ **۱۳ ✓ / 0 ✗**
(×۳ دور + یک دورِ تمیز بدون `.env`).

**اصلاح:** `apps/web/scripts/test-auth-session.ts` — wrapper سراسریِ
fetch هر URL ای که به `/api/auth/refresh` ختم شود را به سرورِ خودِ تست
بازنویسی می‌کند (init دست‌نخورده — signal/credentials)؛ R0 تازه اضافه
شده: «بوت به سرورِ تست رسید — هرمتیک» و اگر `VITE_API_URL` در محیط
حاضر باشد گزارشش می‌کند. خودِ `auth-session.ts` **دست نخورد** —
`VITE_API_URL` در پروداکشن همان رفتارِ مطلوبِ تفکیکِ web/api است.

### ب) ده یافته‌ی P3 باقی‌مانده‌ی scan-72 (۲۴..۳۵ منجای بسته‌شده‌ها)

| # | یافته | اصلاح |
|---|---|---|
| 24 | لودینگ consumers متنِ «...» (پرش چیدمان) | اسکلتونِ هم‌قدِ ردیف‌ها + aria-busy — `$couponId.tsx` |
| 25 | خطای fetch اول = «کوپنی ثبت نشده» | حالتِ خطا + دکمه‌ی تلاش مجدد (الگوی InboxList) — `coupons/index.tsx` |
| 27 | z-9999 بنرهای PWA روی مودال‌ها (z-100) | z-90 (زیرِ مودال/بات‌شیت، بالای هدرِ z-40) — `PushAutoPrompt` + `register-sw` ×۳ |
| 28 | InboxList: aria-live نبود، callback درون‌خطی، سقف ۳۰ بی‌یادآوری | aria-live=polite + callbackهای پایدار از هوک + یادداشتِ «آخرین ۳۰» (کلید `notify.inbox.capped` fa/ar) |
| 29 | ترتیب دستگاه‌های پروفایل NULLS-first ≠ ادمین | `desc nulls last` + کلید دومِ firstLoginAt (آینه‌ی admin.service) — `auth.service.ts` |
| 30 | `<title>` فارسیِ هاردکد | `noindexHead('notifications')` + کلیدِ دوزبانه در dict سئو (fa/ar) |
| 31 | overmatch برند: «Note N» خالی ⇒ xiaomi | توکنِ بدونِ نشانه‌ی برند = null (صادق) — «Redmi Note…» همچنان xiaomi — `deviceIdentity.ts` |
| 32 | کد مرده: attachIdentity عمومی + releaseNudgeClaim | هر دو حذف + کامنت‌های تاریخی به‌روز + import پاک |
| 33 | role=switch بی‌نامِ accessible | prop اجباریِ `label` در Toggle + برچسبِ معنادار در هر ۲۳ استفاده (پرداخت چک‌آوت از dict دوزبانه) |
| 35 | محوِ تعویض زبان در تب مخفی می‌ماند (rAF متوقف) | تایمرِ اطمینانِ مستقل از رندر (700ms) + پاک‌سازیِ صحیح در کلیکِ سریع/unmount — `i18n/index.tsx` |

بسته‌شده‌های قبلی (stage-72): 24-جزئیات دیگر، 26 (min-w-0)، 34
(maxLength)، 27-بخش 44px، 30-بخش TTL، 31-بخش‌های کد مرده/ترناری.

### ج) تست‌ها و دروازه‌ها (stage-75)

| تست | نتیجه | دستور |
|---|---|---|
| auth-session هرمتیک (R0..R7) | **۱۳ ✓** ×۴ دور | `cd apps/web && bun run test:auth-session` |
| sse-client (رگرسیون) | ۱۸ ✓ | `cd apps/web && bun run test:sse-client` |
| fetch-timeout (رگرسیون) | ۵ ✓ | `cd apps/web && bun run test:fetch-timeout` |
| device-policy (رگرسیون — حذف attachIdentity) | ۱۹ ✓ | `cd apps/api && DATABASE_URL=… bun run db:test:device` |
| migrations (رگرسیون) | ۵۷ ✓ | `cd apps/api && DATABASE_URL=… bun run db:test:migrations` |
| مسیر پول (رگرسیون — coupon.service) | ۱۸ ✓ | `cd apps/api && DATABASE_URL=… bun run db:test:pay` |
| زرین‌پال (رگرسیون) | ۱۶ ✓ | `cd apps/api && bun run db:test:zarinpal` |

درگاه‌های ایستا: `tsc --noEmit` api و web = صفر · biome web =
**۶۴۱/۱۴/۹ = دقیقاً baseline کامیت شما** (صفر جدید؛ سه خطای فرمتِ
واردشده در همان لحظه فرمت شد) · برابری کلیدهای fa↔ar = ۴۹۴/۴۹۴.

### نحوه اعمال

```bash
# بسته‌ی fixes/stage75 را روی ریشه‌ی ریپو کپی کنید (۳۲ فایل؛ همه جایگزینی)
docker compose up -d --build web api
# تست تازه (در محیطِ روشنِ توسعه‌تان — دیگر مهم نیست .env چه دارد):
cd apps/web && bun run test:auth-session
```

---

## ۲-۱۰-۸) stage-76 — اسکن عمیق درگاه‌های سپ و ملت با سنجه‌ی زرین‌پال

مقیاسِ ممیزی = همان چک‌لیستی که باگ‌های زرین‌پال را گرفت (stage-74):
لغوی callback ⇒ حلِ فوری؛ منبعِ حقیقت = استعلامِ سرور-به-سرور؛ نامشخصِ
پول‌ایمن ⇒ indeterminate نه fail؛ خطای شبکه در callback ⇒ 302 امن نه 500
خام؛ قابل‌مشاهده‌بودنِ شکلِ واقعی پاسخ‌ها برای تست‌های عملی.

### الف) وضعیت سپ (سامان) — چه‌چیز از قبل درست بود

- **لغو (معادلِ NOK):** کوئریِ غیرخالیِ بدون RefNum ⇒ شکستِ قطعیِ فوری
  (سفارش CANCELED؛ «مجموع پرداخت‌ها» آلوده نمی‌شود؛ ۲۴h معلق نمی‌ماند) —
  نقطه‌ی مقابلِ باگِ زرین‌پالِ stage-74. چون برای پرداختِ بدون RefNum
  استعلامی وجود ندارد، این تنها راهِ حلِ سریعِ لغو است.
- **ضد-جعل:** RefNum ذخیره‌شده مقدم بر کوئری؛ چک مبلغ ریالی؛ state
  امضاشده؛ تطابق درگاه callback با درگاهِ خود پرداخت.
- **پنجره‌ی پول‌ایمن:** probe تایم‌اوت (کوئری خالی) ⇒ indeterminate (رارد
  H6 — پول ممکن است گرفته شده باشد).

**سه اصلاحِ این استیج:**
1. **CellNumber به فرمتِ مستندِ ۹۸+** — شماره‌ی کاربر با «۰۹…» ذخیره
   می‌شود و همان‌طور به سامان می‌رفت؛ مستنداتِ Token API فرمتِ
   `98xxxxxxxxxx` می‌خواهد و بعضی ترمینال‌ها مقدارِ خارج از فرمت را با
   خطا رد می‌کنند ⇒ «init ناموفق» بی‌دلیل. حالا 09…→98… نرمال و شکل‌های
   غیر-ایرانی حذف (فیلد اختیاری است).
2. **لاگِ ResultCode/State/TraceNo** روی مسیرهای قطعی-ناموفق و
   indeterminate (الگویِ `-9/-10/-11` زرین‌پال: کدهای «قطعاً
   پرداخت‌نشده» فقط از تست‌های عملی کشف می‌شوند).
3. **لاگِ init با پاسخِ نامعتبر** (null = صفحه‌ی HTML شاپرک).

### ب) وضعیت ملت (به‌پرداخت) — چه‌چیز از قبل درست بود

- **لغو:** ResCode=17 (انصراف) و هر ResCode≠0 ⇒ شکستِ قطعیِ فوری.
- **ضد-جعلِ قوی‌تر از زرین‌پال:** RefId فرم باید با توکنِ init یکی باشد.
- **کدهای رسمی:** verify ۰/۴۳ + settle ۰/۴۵ ⇒ موفق؛ ۴۸ ⇒ برگشت‌خورده
  (قطعی)؛ هر کدِ دیگر ⇒ indeterminate (قانونِ پول: fail بدون اطمینان
  ممنوع).
- **مرجعِ ماندگارِ `orderId:s:SaleReferenceId`:** در callbackِ نامشخص
  ذخیره می‌شود تا کارِ تایم‌اوت بدون فرم دوباره verify+settle کند —
  هم‌مکانیزمِ RefNum سامان.
- **رگرسیونِ stage-58 حفظ شد:** «X,0» هرگز «موفق با refId=X» خوانده
  نمی‌شود — فقط «0,X».

**چهار اصلاحِ این استیج:**
1. **`Bun.fetch` → `fetch` سراسری در bpCall** — آخرین درگاهِ متصل به
   Bun.fetch؛ درست همان چیزی که stage-74 در http-util رفع کرد: بدون آن
   تستِ بدون-شبکه‌ی ملت ناممکن بود (رفتارِ production یکسان — در Bun
   همان Bun.fetch است).
2. **رجکسِ `<return>` پیشوند-پذیر شد** — رجکسِ Fault همین تابع پیشوندِ
   namespace را می‌پذیرفت ولی `<return>` نه: پاسخِ ساب به شکلِ
   `<ns:return>`/`<ax23:return>` (بسته به استکِ بانک) ⇒ مقدار گم ⇒ null ⇒
   «همه‌ی پرداخت‌های ملت indeterminate». حالا `<([\w-]*:)?return>` با
   بست‌تگِ هم‌پیشوند (`\1`).
3. **qget حساسیت-به-حروفِ بی‌تفاوت** برای ResCode/RefId/SaleReferenceId
   (هم‌ترازِ Status/status زرین‌پال و RefNum/refNum سامان) — بازنویسیِ
   بزرگ/کوچک توسط واسط‌ها دیگر ResCode را گم نمی‌کند.
4. **لاگِ کدهای verify/settle** روی همه‌ی مسیرهای غیر-موفق (فالت/۴۸/کد
   ناشناخته/تسویه‌ی ناموفق) — پیش‌تر کامل بی‌صدا بودند.

### ج) مسیرِ مشترک — راستی‌آزمایی‌شده (بدون تغییر)

- **فرم POST ملت:** روتِ `POST /payments/:gateway/callback` فیلدهای
  urlencoded را با `flatForm` پارس می‌کند — با Elysia 1.4.30 زنده
  اثبات شد که body به‌صورتِ آبجکتِ رشته‌ای تحویل می‌شود و با کوئریِ URL
  (state) ادغام می‌شود.
- **«مجموع پرداخت‌ها»** و همه‌ی KPIهای مالی gateway-ناوابسته‌اند (فیلترِ
  paymentStatus='SUCCESS' در order.service/report/admin — استیج-۷۴).
- **کارِ تایم‌اوت ۵ دقیقه‌ای** و پنجره‌ی ۲۴h + R12 برای هر دو درگاه.

### تست‌ها (stage-76 — ۷۳ بند تازه/بازشده)

| تست | بند | دستور |
|---|---|---|
| آداپتور سامان — شکل‌های پاسخ، ضد-جعل، CellNumber | **۲۷** | `cd apps/api && bun run db:test:sep` |
| آداپتور ملت — SOAP، کدها، رگرسیون ۳۹,۰، ns:return | **۲۹** | `cd apps/api && bun run db:test:mellat` |
| مسیر پول با درگاه‌های «واقعی» (D+E: initiate→callback→job) | **۳۵** (۱۸+۱۷) | `cd apps/api && bun run db:test:pay` |
| رگرسیون‌ها | ۱۶+۱۹+۵۷ ✓ | zarinpal / device / migrations |

رگرسیون‌های ایستا: tsc api/web = صفر · biome web = ۶۴۱/۱۴/۹ (دقیقاً
baseline؛ فقط فایل‌های api تغییر کردند).

### نحوه اعمال

```bash
# بسته‌ی fixes/stage76 را روی ریشه‌ی ریپو کپی کنید (۷ فایل؛ همه جایگزینی)
docker compose up -d --build api
# تست‌های تازه:
cd apps/api && bun run db:test:sep && bun run db:test:mellat && bun run db:test:pay
```

## ۲-۱۰-۹ — stage-77: اسکن سراسری پرداخت/PWA/نوتیفیکیشن/سفارش/کوپن + روابط

**دامنه**: ۴۱ فایل (۳۷ جایگزینی + ۲ تستِ جدید + ۲ package.json). بدون مایگریشن، بدون env/پکیج جدید.

### یافته‌های P1/P2 (رفع‌شده)
- **N1 (P1)** — کلاینت SSE بعد از انقضای توکن در حلقه‌ی 60s×401 می‌افتاد: هیچ درخواست احراز دیگری روی صفحه‌ی متمرکز رخ نمی‌داد تا توکن تازه شود. رفع: هوک `onUnauthorized` (sse-client) + `tryRefresh` + اتصال فوریِ ~۱s + گاردِ ضد-حلقه (۳ بار).
- **N4 (P2)** — شکستِ قطعیِ پرداخت برای مشتری «بی‌خبر» تمام می‌شد: سفارش CANCELED ولی هیچ اعلان/پوشی نبود. رفع: notifyUser در finalize (فایر-اند-فورگت؛ type=system؛ url=صفحه‌ی سفارش).
- **N2 (P2)** — پخش‌های گروهی (broadcast/تخفیف/کوپن عمومی) هیچ SSE نداشتند — صندوقِ باز تا focus/navigation کور بود. رفع: کانال عمومی `notify:all` (realtime.routes: هر کاربرِ لاگین‌شده؛ بدون محتوا) + publish در broadcast + اشتراکِ دوم در useNotificationInboxPage.
- **P2-5** — رسیدِ چاپی/کارتِ ریز-مبلغ: «کسر از کیف پول» ردیفِ منفی بود ولی «مبلغ نهایی» = totalAmount (پیش از کیف پول) ⇒ جمعِ خط‌ها با خطِ آخر به‌اندازه‌ی walletDeduction نمی‌خواند. رفع: مبلغ کل سفارش → کسر کیف پول → مبلغ نهایی (پرداخت آنلاین) — سر و تهِ حساب می‌خورد.
- **P2-1** — سفارش‌های «پرداخت ناموفق» در «سفارشات من» برچسبِ «نامشخص» می‌گرفتند (کلیدِ ساختگی PAYMENT_FAILED در ORDER_STATUS_CONFIG نبود). رفع: همان status واقعی (CANCELED که برچسبش از طراحی «پرداخت ناموفق» است).
- **P2-2** — نقضِ قانونِ هوک‌ها در جزئیات سفارش (useMemo بعد از returnِ شرطی) — کرشِ بالقوه‌ی کل مسیر.
- **P2-3/P2-4** — پیامِ فارسیِ هاردکدِ «درگاه را انتخاب کنید» (کلید دوزبانه شد) + کیبورد فارسی «۲۰» می‌فرستاد نه «20» ⇒ کوپنِ معتبر رد می‌شد (نرمال‌سازی ارقام فارسی/عربی).
- **PWA P2-1** — آخرین fetchِ بی‌سقفِ «بدنه»: withTimeout فقط headers را می‌بست؛ enablePush/reconcile می‌توانست برای همیشه معلق بماند (بنرِ busy بدون دکمه‌ی رد). رفع: readJsonWithTimeout در ۳ مسیر.
- **PWA P2-2** — بنرِ نصب روی بنرِ آپدیت می‌افتاد (هر دو fixed bottom-4 z-90) — نصبِ نسخه‌ی کهنه روی SWِ در انتظار.

### یافته‌های P3 (نمونه‌ها)
- N5: markAllRead بدون cutoffِ ۷ روزه بود (marked > بج) · N6: پلِ Redis بعد از قطعیِ لحظه‌ای بازسازی نمی‌شد · N11: no-store روی GETهای اعلان · N12: مهلتِ ۱۳:۰۰ِ یادآور کوپن فقط ابتدای اجرا چک می‌شد (انباشتگی = پوش بعد از ناهار) · N13: خطای markRead بی‌صدا · N10: فرم broadcast بعد از ارسال پاک نمی‌شد (باز-ارسال ناخواسته) · P3-7: نوارِ موبایلِ سبد `<a>` خام (ریلود کامل) · P3-8: اینپوت کوپن بدون aria-label/Enter · P3-9: حذفِ بی‌صدای تخفیف بعد از تغییر سبد · P3-10: متنِ نظر قبل از نتیجه پاک می‌شد · P3-13/14/15: توست‌های فارسی به کاربر عربی + عنوان صفحات سفارش دوزبانه · P3-16: mockPay بی‌سقف + دوبله‌زدن · P3-18: سبدِ خطادار «۰ تومان» با دکمه‌ی فعال · P3-17: randomUUID بدون پشتیبان iOS<15.4 · PWA P3-1/2/4/7/8/9: precache خود-SW/آفلاینِ کشِ خالی/کش-فیل بی‌سقف/openWindow بی‌اعتبارسنجیِ مبدا/رقابت با اولین رندر/۴۰s صفحه‌ی سفید.

### شناخته‌شده و عمداً بی‌تغییر (مستند)
- i18n کاملِ نوتیفیکیشن‌های سرور (fa/ar): نیازمند ستون locale در users + قرارداد در تمام فراخوان‌ها — طراحی فعلی: fa فقط (بازار ایران)؛ پروژه‌ی آینده.
- سقف‌های ۵۰k/۵۰۰ پخش، retry نداشتن web-push در رخدادهای گذرا: تصمیم مستندِ stage-64.
- کانال `orders:{id}` (ردیابی مشتری): مجازشده ولی بدون producer/consumer — پولینگ ۴s موجود است؛ سیم‌کشیِ آن پروژه‌ی آینده.

### تست‌ها
`test:sse-client` ۱۸→۲۵ (S10-S13: 401→refresh→اتصال فوری/ریتم عادی/غیر-401/ضد-حلقه) · `test:push-json-timeout` جدید ۶ (سیاه‌چاله‌ی بدنه با سرور واقعی) · `db:test:notification` جدید ۱۴ (broadcast+notify:all/کانال شخصی/markAllRead-TTL/list) · `db:test:pay` ۳۵→۳۸ (D7: سه شکستِ قطعی ⇒ اعلان با url سفارش؛ موفق/نامشخص ⇒ نه).

## ۲-۱۰-۱۰ — stage-78: محصول ویژه — بج «ویژه» + Aurora دو-تم + پس‌زمینه‌ی متحرک WebGL

**درخواست کارفرما**: سه خواسته‌ی مشخص روی محصول ویژه — ① بج «ویژه» در گوشه‌ی چپِ بالای کارت محصول؛ ② پس‌زمینه‌ی Aurora کارت در دارک و لایت متفاوت (دارک: همین رنگِ فعلی، دست‌نخورده؛ لایت: رنگ‌های روشن از جنس همان خانواده)؛ ③ پس‌زمینه‌ی صفحه‌ی اختصاصی محصول ویژه = کد شیدر WebGL کارفرما (JS→TS + مچ با صفحه + رسپانسیو + رنگ‌های هم‌رنگ کارت در دو تم). + استلزام ضمنی: «محصولی که توسط ادمین اصلی ویژه می‌شود» — ویژه‌سازی فقط به دست ادمین اصلی.

### ۱) بج «ویژه» (ProductCard + i18n)
- ستون بج‌های گوشه‌ی چپِ بالا: بج «ویژه» (گرادیان سرخابی→فیروزه‌ای #E54CFF→#00C2FF + ستاره) **بالای** بج تخفیف می‌نشیند — قبلاً بج تخفیف تنها بود و با بج تکراری روی‌هم می‌افتاد؛ حالا flex-col بدون تداخل.
- متن بج از کلید دوزبانه `common.featuredBadge` (fa: «ویژه» / ar: «مميز») — پاریتی fa↔ar: ۴۹۶/۴۹۶.
- پیش‌نمایش فرم ادمین (interactive=false) همان کارت را می‌بیند — بج/aurora زنده در خود فرم.

### ۲) Aurora دو-تم (styles.css + متن‌ها)
- **دارک دست‌نخورده**: قاعده‌ی `.aurora-card` موجود همان است (سیاه + لکه‌های ۵۰/۴۵/۴۵/۶۰٪).
- **لایت جدید**: `html:not(.dark) .aurora-card` — زمینه‌ی سفید + همان چهار لکه با آلفای پاستلی (۲۵/۲۲/۳۰/۲۴٪) — «رنگ‌های روشن از جنس همین رنگ‌ها». خاصیت‌های انیمیشن/اندازه از قاعده‌ی پایه به ارث.
- متن‌های روی کارتِ ویژه حالا تم‌پیرو می‌شوند: لایت = تیره (text-gray-900/600)، دارک = سفید (همان قبلی) — ProductCard (عنوان/توضیح/قیمت/خط‌خورده/تومان) + ArticleCard (عنوان — zinc-800).

### ۳) پس‌زمینه‌ی متحرک WebGL (فایل جدید ShaderBackground.tsx)
- کد JS کارفرما به TS تبدیل شد؛ **منطق شیدر عمداً دست‌نخورده** (پالت کسینوسی + ۴ لایه‌ی حلقه + موج + پوشش گرادیان). فقط سه یونیفرم تم افزوده شد: `u_grad1/u_grad2/u_soft`.
  - دارک: گرادیان‌های عمیق خانواده‌ی Aurora (سرمه‌ای-فیروزه‌ای + سرخابی) و u_soft=0 ⇒ «دقیقاً همان تصویر شیدر اصلی».
  - لایت: پاستل‌های همان رنگ‌ها + محو به سفید (u_soft=0.62) — عین aurora-card لایت.
- رسپانسیو: resize + DPR (سقف ۲) + pointermove (ماوس و لمس). prefers-reduced-motion ⇒ یک قاب ثابت. `webglcontextlost/restored` ⇒ توقف/بازسازی. بدون WebGL ⇒ fallback همان `.aurora-card` (دو-تم خودکار).
- حذف‌شده‌های عمدی از دمو: دکمه‌ی Interactive/Static و تایتل overlay — این پس‌زمینه‌ی صفحه است نه دمو؛ تعامل اشاره‌گر همیشه روشن.
- **یکپارچگی لایه‌ها**: بوم `fixed inset-0 z-0 pointer-events-none`؛ ریشه‌ی محتوای صفحه‌ی محصول `relative` (بدون z-index ⇒ بدون stacking-context — z ایندکس‌های فرزندانِ ثابت مثل نوار موبایل z-50 و مودال‌ها در کانتکست ریشه می‌مانند و تغییری نمی‌کنند)؛ فوتر `relative` (بعد از main در ترتیب DOM ⇒ همیشه بالای بوم — قبلاً فوترِ ایستا زیر عناصر fixed دفن می‌شد). هدر z-40/نوار موبایل z-50/توست z-200 از قبل بالاترند.

### ۴) ویژه‌سازی فقط ادمین اصلی (فرانت + بک)
- بک (admin-menu.routes): POST/PATCH محصول — اگر نقش ≠ admin و isFeatured در بدنه آمده باشد، **نادیده گرفته می‌شود**: create ⇒ پیش‌فرض خاموش؛ patch ⇒ دست‌نخورده (ادمین۲ نه می‌تواند ویژه کند و نه می‌تواند ویژگیِ ادمین اصلی را بردارد — ویرایش‌های دیگرش سالم می‌مانند).
- فرانت: `canToggleFeatured` (نیامد = اجازه — سازگاری، مثل canToggleAvailability) — فقط new/edit محصول از `usePermissions().isMainAdmin` پاسش می‌دهند؛ ادمین۲ جعبه‌ی سوئیچ را اصلاً نمی‌بیند.

### راستی‌آزمایی
- دروازه‌ها: tsc api=۰ web=۰ · biome web = ۶۳۹/۱۴/۹ = دقیقاً baseline کامیت ۷۷ (صفر خطای جدید — سه خطای تازه‌ی ShaderBackground در لحظه فرمت/IGNORE شد) · پاریتی کلید ۴۹۶/۴۹۶.
- اجرای واقعی (پنل: PG + API + vite): گرید لایت/دارک (پاستل/vivid + بج «ویژه» روی بج تخفیف بدون تداخل — VLM) · صفحه‌ی محصول لایت/دارک (شیدر روشن/تیره، متن خوانا) · تعویض تم زنده (پالت شیدر همان لحظه) · فوتر بالای بوم · موبایل ۳90px: بدون overflowX، شیدر متحرک (۴۸.۶٪ پیکسل در ۱.۵s)، نوار پایین z-50 · کنسول پاک.
- گارد API (نشست‌های ساختگی + JWT): ادمین اصلی: isFeatured=true ⇒ ثبت ✓؛ ادمین۲: true ⇒ نادیده (false ماند) ✓ و false ⇒ نادیده (true ماند — ضد-خرابکاری) ✓.
- فرم ادمین A/B: ادمین اصلی جعبه‌ی سوئیچ روشن ✓؛ ادمین۲ (با productsWrite) وارد ویرایش می‌شود ولی جعبه را نمی‌بیند ✓؛ کلیک سوئیچ ⇔ پیش‌نمایش کارت aurora+بج زنده ✓.

### فایل‌ها (۱۳)
بج/i18n: ProductCard · fa · ar — تم: styles.css · ArticleCard — شیدر: ShaderBackground.tsx (جدید) · products/$productId · Footer — گارد: ProductForm · types/forms · new · edit · admin-menu.routes

## ۲-۱۰-۱۱ — stage-79: مجوز ثبت‌نام ویژه — استثنای ادمینِ اصلی + سوختنِ سختِ دستگاه

> خواسته‌ی کارفرما: «به منطق دست نزن. به جاش تو صفحه‌ی تنظیمات یک دسترسی ویژه به ادمینِ اصلی بده که با وارد کردن یک شماره، اون شماره بتونه ثبت‌نام کنه؛ بعد ثبت‌نام بلاک بشه دستگاهش» — پس از دیپلویِ ۷۸ که بک‌فیلِ آزادسازیِ auto:% صفر نفر را آزاد کرد.

### ۱) مدل داده (registration_permits — مایگریشن ۰۰۰۷)
- جدول جدید + ایندکس یکتایِ **جزئی** `…pending_phone_uidx ON (phone) WHERE status='pending'` — حداکثر یک مجوزِ در انتظار به‌ازای شماره (race-safe صدور)؛ تاریخچه (used/revoked/expired) برای ممیزی می‌ماند.
- چرخه: `pending → used` (claim اتمیک داخل tx ثبت‌نام) یا `revoked` (ادمین) یا `expired` (تنبل — در consume/list محاسبه، بدون job).
- `created_by/revoked_by` FK به users؛ `used_device_id` uuid بدون FK عمدی (رکورد ممیزی است؛ حذفِ دستگاه نباید تاریخچه را cascade کند).

### ۲) سرویس (registration-permit.service.ts — جدید)
- `issue`: نرمال‌سازی شماره (۰۹…، ارقام فارسی/عربی)، ردِ شماره‌ی ثبت‌نام‌کرده (CONFLICT)، تازه‌سازیِ pending موجود (صدور دوباره = همان ردیف با انقضای جدید)؛ رقابتِ صدورِ هم‌زمان → unique-violation → دوباره تازه‌سازی.
- `consumeForRegistration(dbOrTx, phone, deviceId)`: **claim اتمیکِ تک‌عبارتی** — `UPDATE … WHERE phone=? AND status='pending' AND expires_at>now() RETURNING` — الگوی CWE-367-safe (توکن دعوتِ تک‌مصرف). rollback ثبت‌نام ⇒ مجوز «نخورده» برمی‌گردد.
- اعتبار: پیش‌فرض ۲۴ ساعت، سقف ۷۲ (PERMIT_MAX_TTL_HOURS)؛ TTL و یادداشت (سقف ۵۰۰) از پنل.
- `revoke`: فقط pending (اتمیک)؛ لغوِ دوباره ⇒ CONFLICT.

### ۳) اتصال به ثبت‌نام (auth.service — جراحیِ حداقلی)
- ترتیبِ دو SELECT خواندنی عوض شد (user قبل از peek — محض تصمیمِ مجوز)؛ بقیه‌ی جریان همان است.
- مجوز فقط برای «کاربرِ تازه» معنا دارد — `permit = isNewUser ? peek : null`؛ **ورودِ کاربرِ موجود هیچ‌وقت از مسیرِ مجوز نمی‌گذرد**.
- مسدودیِ دستگاه (`peek.device.isBlocked`): بدون مجوز ⇒ همان FORBIDDENِ قبلی؛ با مجوز ⇒ گذر + رویداد `PERMIT_BYPASS` (ممیزی روی خودِ دستگاه).
- سقفِ DEVICE_PHONE_LIMIT (چکِ قبل از tx و بازبینیِ داخل tx): با مجوزِ «مصرف‌شده» نادیده — claim مالکیت در finalize بی‌قیدوشرط بازنویسی می‌کند.
- **داخل tx، قبل از هر تصمیمِ استثنا**: claim اتمیک مجوز. لغو/انقضای هم‌زمان (peek دید ولی claim نکرد) ⇒ permitOverride=false و «تصمیمِ گذر از مسدودی» برمی‌گردد (FORBIDDEN سخت) — پنجره‌ی TOCTOU صفر.
- پایانِ ثبت‌نامِ مجوزدار: دستگاه مسدود (`permit-burn`) + رویداد `PERMIT_BURN` (با permitId) + قطع سشن‌های همان دستگاه + پیامِ متمایز: «ثبت‌نام شما کامل شد، اما این دستگاه طبق مجوز ثبت‌نام بلاک شد؛ برای ورود از دستگاه دیگری استفاده کنید.» — همان فلسفه‌ی auto-blockِ راند ۷۲ (ثبت‌نام موفق، دستگاه مرده).
- **بدون مجوز، رفتار بایت‌به‌بایت همانِ پیش از ۷۹ است** (گروه A تست: ۵ رگرسیون).

### ۴) سوختنِ سخت — دفاع-در-عمق (device.service — گام ۵-b)
- دلیلِ `permit-burn` عمداً **خارج از خانواده‌ی `auto:%`** است — جاروی یک‌باره‌ی بک‌فیل ۷۳ (و هر جاروی آینده) هرگز نمی‌تواند مجوز-سوختن را آزاد کند.
- دستگاهِ از-قبل-مسدود: فقط رویداد PERMIT_BURN می‌گیرد (دلیل/زمانِ مسدودیِ اصلی — مثلاً دستِ ادمین — دست‌نخورده).
- دستگاه تازه/سوخته‌ی نرم: isBlocked + blockedAt + reason + قطع سشن‌ها — تضمین «هر دستگاه در عمرش یک ثبت‌نام» حتی در مسیرِ استثنا.
- مسدودیِ دستگاه قابلِ رفع با ابزارِ موجودِ UNBLOCK پنل دستگاه‌ها است (ادمین اگر شخص را می‌شناسد)؛ claim مالکیت می‌ماند ⇒ ثبت‌نامِ شماره‌ی دوم از همان دستگاه همچنان ناممکن.

### ۵) روت‌ها (admin-settings.routes — فقط ادمین اصلی، requireAdmin)
- `GET /admin/settings/registration-permits` — ۱۰۰ ردیفِ اخیر با وضعیتِ مؤثر.
- `POST /admin/settings/registration-permits` — {phone, note?, ttlHours? (۱-۷۲)} + ممیزی `REG_PERMIT_ISSUE`.
- `POST /admin/settings/registration-permits/revoke` — {id: uuid} + ممیزی `REG_PERMIT_REVOKE`.
- ادمین۲ روی هر سه ⇒ ۴۰۳ (تست با نشستِ واقعی).

### ۶) پنل (کارت تنظیمات — فقط ادمین اصلی)
- `RegistrationPermitCard.tsx` (جدید): فرم شماره (نرمال‌سازی ارقام فارسی/عربی — **کشفِ مرورگر: تبدیل کد بدون +0x30 = NUL، نه رقم**؛ درسِ عمومی برای همه‌ی نرمال‌سازهای ارقام) + اعتبار (۱۲/۲۴/۴۸/۷۲ ساعت) + یادداشت + دکمه‌ی صدور.
- فهرست: وضعیت (در انتظار/مصرف شد/منقضی/لغو شد) + تاریخ شمسی + `DEV-xxxxxx` (۶ رقم آخر uuid دستگاه برای پنل دستگاه‌ها) + یادداشت + دکمه‌ی لغو فقط برای pending. max-h-96 + اسکرول. ۳90px بدون overflowX.
- سیم‌کشی: qk.settingsRegistrationPermits + فکتوری staleTime=0 + سرور-فانکشن‌ها (authJson) + پری‌فچ loader + `RegistrationPermitDto` در @sinshin/shared.
- کارت زیرِ GeoAccessCard در ستونِ چپِ تنظیمات — ادمین۲ آن را نمی‌بیند (همان isMainAdmin که بقیه‌ی کارت‌ها را می‌پوشاند).

### ۷) مایگریشن و ابزار
- زنجیره: `0007_nebulous_monster_badoon.sql` (جدول + ۴ ایندکس + FK) — drizzle-kit generate، همان مسیرِ `db:migrate`.
- تست‌ها: `db:test:permit` (۳۳ بند — گروه A رگرسیونِ بدون-مجوز، گروه B جریانِ کاملِ مجوز شامل لغوِ mid-flight و rollback-اتمی، گروه C سرویس) + `db:test:migrations` ۵۷→۵۸ (سناریو A حالا ۰۰۰۷ را هم می‌سازد/برمی‌گرداند؛ E4 برشِ زنجیره معنایی شد — همه‌ی ورودی‌های بعد از ۰۰۰۵).

### راستی‌آزمایی
- دروازه‌ها: tsc api=۰ web=۰ shared=۰ · biome web = ۶۳۹/۱۴/۹ = دقیقاً baseline.
- تست‌ها (۲ دور): permit ۳۳/۳۳ · device ۱۹/۱۹ · migrations ۵۸/۵۸ · pay ۳۸/۳۸ · zarinpal ۱۶ · sep ۲۷ · mellat ۲۹ · notification ۱۴ · auth-session ۱۳ · fetch-timeout ۵ · sse ۲۵ · push-json ۶ · device-fingerprint ۱۱.
- اجرای واقعیِ HTTP: مسدودسازی دستگاه با پنل → صدور مجوز با curl → ثبت‌نام از دستگاهِ مسدود ⇒ کاربر ساخته شد + PERMIT_BYPASS/REGISTER/PERMIT_BURN + مجوز used + مالک بازنویسی + سشنِ همان دستگاه قطع شد (ادمینِ روی همان دستگاه هم بیرون افتاد — درست مثل بلاکِ دستی).
- اجرای واقعیِ مرورگر (vite:3001 + api:3002 + PG + mini-redis): ورودِ ادمین → کارت + فهرست (مصرف‌شده‌ها با تاریخ/DEV) → صدور با ارقام فارسی → لغو → مسیرِ طلایی: دستگاهِ مرورگر مسدود → ثبت‌نام ۰۹…۲۲/۳۳ از صفحه‌ی ورود ⇒ پیام «ثبت‌نام شما کامل شد، اما این دستگاه طبق مجوز ثبت‌نام بلاک شد…» روی فرم + ردیف used تازه در کارت · ادمین۲: کارت مخفی + هر سه روت ۴۰۳.
- کشف جانبی (گزارش، بدون دست‌کاری — بیرون از scope): الگوی `String.fromCharCode(x - 0x06f0)` در useCheckoutPage هم همان افسردگیِ NUL را دارد ⇒ ارقام فارسیِ کدِ کوپن در آن مسیر حذف می‌شوند؛ فرم OTP هم «خود-ارسالِ ۶رقمی» دارد (دوبار-ثبت اگر کاربر همان لحظه دکمه را هم بزند — دومین ۴۲۲ بی‌ضرر).

### فایل‌ها (۲۱: ۶ جدید + ۱۵ جایگزینی)
بک: registration-permits.ts (جدید) · schema/index · drizzle/0007 (جدید) + meta/0007_snapshot (جدید) + _journal · registration-permit.service.ts (جدید) · auth.service · device.service · admin-settings.routes · app · index · package.json (db:test:permit) · test-registration-permit.ts (جدید) · test-migrations — قرارداد: packages/shared/contracts — فرانت: admin.ts (server) · queryKeys · queryOptions · RegistrationPermitCard.tsx (جدید) · routes/admin/settings/index — مستند: REFERENCE.md
