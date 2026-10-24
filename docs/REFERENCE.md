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

## ۲-۱۰-۱۲ — stage-80: هوشِ جمعیتیِ دستگاه — وزنِ IDF، وراثتِ مسدودی، هم‌بستگیِ auto-block

> درخواست کارفرما: «پیشرفته‌ترین الگوریتم‌های بلاکِ دستگاه را عمیق بررسی کن، کدهای من را
> به آن‌ها عرضه کن و سیستم را پیشرفته‌تر/بهینه‌تر/بدون‌خطاتر کن — خصوصاً تشخیصِ
> اشتباهی (false positive) مطلقاً نباید باشد.»

### ۰) خلاصه‌ی تحقیق عمیق (الگوریتم‌های پیشرفته → کمبودهای ما)
| منبع/الگو | اصل | کمبودِ ما پیش از ۸۰ | رفع |
|---|---|---|---|
| Arkose/ShieldLabs — «collision در برابر division» | هر سیستم FP دو سو خطا دارد؛ تصمیمِ سخت باید «لایه‌بندی به اعتماد» باشد | امتیازِ ثابت | وزنِ جمعیتی (IDF) + دروازه‌های هم‌بستگی |
| Fellegi–Sunter (1969) — اتصالِ احتمالاتی رکورد | وزنِ توافقِ هر فیلد = تابعِ فراوانیِ مقدار در جمعیت (log m/u) | توافقِ مقدارِ فراوان همان وزنِ کمیاب | `idfFactor(df)`: df≤3 کامل؛ بیشتر = 3/df |
| anonymity-set (iOS هم‌مدل) | سیگنالی که جمعیت شریک‌اند تمییزنده نیست | دو آیفون هم‌مدل = لینکِ کاذب → crowded-cluster + قطعِ معرفی | جمعیت ≥ ۴ دستگاه → وزنِ هش‌ها فرو می‌ریزد |
| tiered identity (FingerprintJS Pro/Castle) | شناسه‌ی قطعی جدا از احتمالاتی؛ تصمیمِ سخت با اعتمادِ بالا | auto-block با انبارِ فلگ‌های ضعیف (۲۵+۲۰+۲۰+۱۵=۸۰) | `autoBlockEligible`: حداقل یک فلگِ قوی |
| graduated response (Sift/SEON) | approve/challenge/review/decline | auto/بازبینی دو حالت | `AUTO_BLOCK_DEFERRED` = صفِ بازبینی |
| گرافِ دستگاه + سوپاپِ اپراتور | فرارِ storage-clear باید روی گراف شکار شود؛ استثنا = مجوزِ ۷۹ | لینک‌ها فقط نرم بودند | `cluster-block-inherit` + `EVADED_BLOCK_LINK` |

### ۱) وزنِ جمعیتی (device-signals.ts — الگوی Fellegi–Sunter)
- `signalSimilarity(a, b, stats?)`: پارامترِ اختیاریِ `SignalPopulationStats` (df چهار هش)؛
  توافقِ هر هش در `idfFactor(df)` ضرب می‌شود؛ خروجی `weighted` + `agreeingHashes` اضافه شد.
- `idfFactor(df)`: df≤`RARE_DF_CAP`(3) → ۱؛ df بزرگ → `3/df` (df=30 → ۰٫۱). جمعیتِ هم‌مدل
  خودکار تخفیف می‌خورد؛ جفتِ واقعی (df=2) و دیتابیسِ کوچک/سرد بی‌آسیب.
- **بدون stats رفتار بایت‌به‌بایت همانِ قبل** (`weighted === score`) — سازگاریِ کامل عقب.
- سیگنال‌های غیر-هش (screen/platform/tzlang) عمداً بی‌تخفیف — اطلاع‌شان جمعیتی نیست.

### ۲) لینک‌سازی (device.service.ts — گام ۲)
- قبل از جست‌وجوی شباهت: `hashPopulationOn` = چهار `count(*)` ایندکس‌دار (مایگریشن ۰۰۰۸)
  داخل همان tx برای df سیگنال‌های «واقعی» (missing هرگز پرس‌وجو نمی‌شود).
- فیلترِ لینک: علاوه بر گاردهای قبلی، `weighted ≥ linkThreshold` — لینکِ کاذبِ جمعیتِ
  هم‌مدل عملاً غیرممکن؛ رویداد LINK_CREATED حالا weighted را هم ثبت می‌کند.

### ۳) وراثتِ مسدودی — شکارِ فرارِ «storage پاک + شماره‌ی جدید» (گام ۲-b + ۵-c)
- سناریو: متخلفِ مسدودشده storage را پاک می‌کند (clientId/هشِ مرکب تازه) و با شماره‌ی
  جدید ثبت‌نام می‌کند؛ لایه‌های ۱/۲ نمی‌گیرندش اما سیگنال‌های واقعی هنوز به ردیفِ مسدود
  می‌خورند.
- کاندیدهای مسدود «بدون پنجره‌ی زمانی» (سقف ۲۰۰، مرتبِ blockedAt) چک می‌شوند؛ معیارِ
  `strongEvasionMatch`: score ≥ ۰٫۸۵ **و** weighted ≥ ۰٫۵ **و** ≥۳ هشِ برابر **و**
  comparable ≥ ۴ — دستگاهِ بی‌گناهِ هم‌مدل هرگز (وزنِ جمعیتی) به این سطوح نمی‌رسد.
- اجرا: پس از ثبت‌نامِ موفق، ردیفِ تازه `cluster-block-inherit` می‌شود (خارج از auto:% —
  جاروی ۷۳ آزادش نمی‌کند) + سشن‌ها قطع + رویداد `EVADED_BLOCK_LINK` + لینکِ گراف.
  فلسفه همان auto-block/permit-burn: «ثبت‌نام موفق، دستگاهِ مرده». سوپاپِ رسمی = مجوزِ ۷۹.
- فقط REGISTER (ورودِ کاربرِ موجود دست‌نخورده). انتقالِ گذرا (ترانزیتیو) ممنوع — فقط
  تطابقِ مستقیمِ سیگنال‌های همین ثبت‌نام با ردیفِ مسدود.

### ۴) دروازه‌ی هم‌بستگیِ auto-block (گام ۵)
- `STRONG_RISK_FLAGS = {headless-ua, canvas-drift}`؛ `autoBlockEligible` = امتیاز ≥ آستانه
  **و** حداقل یک فلگِ قوی (پیش‌فرض؛ `DEVICE_AUTOBLOCK_REQUIRE_STRONG=false` = رفتارِ قبل).
- انبارِ فلگ‌های ضعیف (۸۰) دیگر مسدود نمی‌کند → `AUTO_BLOCK_DEFERRED` + riskScore/flags
  روی ردیف (بازبینیِ ادمین) — دستگاهِ بی‌گناهِ عجیب (رم کم/پلتفرم نادرست) قربانی نمی‌شود.

### ۵) forensics — رویدادِ تصمیم (گام ۶)
- هر REGISTER/LOGIN: `DEVICE_DECISION` با matchedBy/riskScore/flags/links/autoBlock/evadedBlock/
  permitOverride — پاسخِ «چرا؟» برای بازبینی.

### ۶) env (هر دو پیش‌فرض روشن — false = برگشتِ رفتارِ قبل)
| متغیر | پیش‌فرض | نقش |
|---|---|---|
| `DEVICE_AUTOBLOCK_REQUIRE_STRONG` | true | auto-block فقط با فلگِ قوی |
| `DEVICE_CLUSTER_BLOCK_INHERIT` | true | وراثتِ مسدودی فعال |

### مایگریشن ۰۰۰۸
- `0008_cool_thundra.sql` — چهار ایندکسِ btree (canvas/webgl/audio/fonts) برای countهای
  جمعیت؛ تولیدشده با همان `db:generate` (drizzle-kit) — اعمال: `bun run db:migrate`.

### تست‌ها
- `db:test:intel` (جدید — **بدون PG**، ۲۸ بند): idfFactor، سقوطِ وزنِ جمعیت، جفتِ کمیاب،
  سازگاریِ بدون-stats، دروازه‌های strongEvasionMatch، autoBlockEligible، پروتکلِ missing.
- `db:test:device` (رشد یافت — PG): S1 جمعیت ۱۵تایی → صفر لینکِ کاذب · S2 فرارِ کامل →
  cluster-block-inherit + EVADED_BLOCK_LINK + لینکِ گراف · S3 بی‌گناهِ هم‌مدل در جمعیتِ
  مسدوددار → مصون · S4 آستانه ۶۰: انبارِ ضعیف (۶۵) → DEFERRED؛ headless (۶۰) → مسدود ·
  S5 DEVICE_DECISION با متادیتای کامل. (رگرسیون‌های P0–P4 دست‌نخورده سبز.)
- `db:test:migrations`: A2 جدید — چهار ایندکسِ ۰۰۰۸ ساخته می‌شوند؛ CHAIN_COUNT داینامیک.

### راستی‌آزمایی
- tsc api=۰ · tsc web=۰ · biome web = ۶۳۹/۱۴/۹ = دقیقاً baseline.
- `db:test:intel` ۲۸/۲۸ (اجرای واقعی، بدون PG) · تست‌های PG (device/migrations/permit/…) در
  محیطِ دارای PostgreSQL اجرا شوند — الگوی همیشگی.

### فایل‌ها (۹: ۱ جدید + ۸ جایگزینی)
بک: device-signals.ts · device.service.ts · schema/devices.ts · env.ts · drizzle/0008 (جدید)
+ meta/0008_snapshot (جدید) + _journal · package.json (db:test:intel) · scripts/test-device-intel.ts (جدید)
· scripts/test-device-policy.ts · scripts/test-migrations.ts — مستند: REFERENCE.md

## ۲-۱۰-۱۳ — stage-81: ترمیمِ تست‌ها بعد از ۸۰ — تصادمِ replay با rewind ناقص + fixtureِ کهنه

> درخواست کارفرما: «اون تست‌هایی که ارور داده رو خودت اجرا کن و ببین چی می‌گه» —
> بعد از اجرای `db:test:migrations` روی ماشینِ خودش: خطای 42P07
> (`devices_canvas_hash_idx already exists`) + آبشارِ A2 + کرشِ `device_type`.

### ۰) بازتولید — PostgreSQL واقعی در سندباکس (embedded binaries 18.4)
- همان خطا **بایت‌به‌بایت** روی کلون با مایگریشنِ خودِ کلون (`0008_cool_thundra`)
  بازتولید شد؛ کارفرما فایلِ خودش (`0008_grey_expediter`) را داشت — پس ریشه،
  «تفاوتِ اسم فایل» نیست (فرضیه‌ی کارفرما رد شد). تست اصلاً name-agnostic است:
  `CHAIN_COUNT` را از journalِ روی دیسک می‌خواند و ایندکس‌ها را با «نامِ تعریفِ
  اسکیما» در pg_indexes می‌شمارد (برچسبِ ۸→۹ ورودی خودش عوض شد).

### ۱) ریشه — rewind ناقص در `buildLegacyAt0004` (سناریوی A)
- این تابع ابتدا کلِ زنجیره‌ی روی دیسک را اجرا می‌کند (پس هر مایگریشنِ تازه،
  شیءهایش را می‌سازد) و بعد حالتِ «۰۰۰۴ + دیتای کثیف» را باز می‌سازد: تا ۷۹
  جدول‌های ۰۰۰۶/۰۰۰۷، ایندکس‌های ۰۰۰۵، ستون‌های ۰۰۰۵ و ورودی‌های journal
  برمی‌گشتند — اما چهار ایندکسِ ۰۰۰۸ (stage-80) drop نمی‌شدند.
- A1: replay از ۰۰۰۵ تا ۰۰۰۸ روی ایندکس‌های موجود → **42P07** → rollbackِ کلِ
  batch (مهاجرت‌ها یک‌جا اجرا می‌شوند) → ۰۰۵/۰۰۶/۰۰۷ هم غایب می‌مانند → آبشارِ
  بندهای A2 + کرشِ «column device_type» در A3.
- شاهدِ قطعی از خروجیِ کارفرما: «چهار ایندکسِ ۰۰۰۸ ✓» همزمان با «ایندکسِ ۰۰۰۵ ✗ ·
  journal ✗ · ۰۰۰۶ ✗ · ۰۰۰۷ ✗» — ایندکس‌ها را **setup** ساخته بود، نه replay؛
  rollback هم به آن‌ها نرسید.
- اجرای اولِ کارفرما (قبل از db:generate) هم توضیحِ روشن دارد: زنجیره‌ی دیسک
  ۰۰۰۸ نداشت → تنها خطا «count=0» بندِ A2 بود — گزارشِ درستِ «فایل مفقود».

### ۲) اصلاح — test-migrations.ts
- rewind کامل شد: چهار `drop index if exists` برای ایندکس‌های جمعیتِ هش (همان
  الگوی stage-79 برای اشیاءِ ۰۰۰۷).
- کامنتِ «درسِ بازتولید»: هر استیجی که شیءِ DDL تازه می‌آورد باید «همان شیء» را
  در rewind برگرداند — وگرنه replay در A1 روی خودش «already exists» می‌خوابد.
- پیامِ خطای بندِ A2 از «count=0» مبهم به راهنمای صریح: «زنجیره‌ی روی دیسک هنوز
  ۰۰۰۸ ندارد — اول: bun run db:generate» (پرچمِ `CHAIN_HAS_0008` داینامیک از
  journal؛ فقط متنِ خطا — semantics دست‌نخورده).

### ۳) کشفِ دوم — fixtureِ کهنه‌ی تستِ مجوز (۲۷✓/۲✗ در سندباکس)
- `db:test:permit` بعد از ۸۰ در سندباکس شکست: B6 «پیش‌نیاز — ثبت‌نام عادی روی
  دستگاهِ تازه» → FORBIDDEN. علت: همه‌ی clientهای fixture هش‌های ثابتِ یکسان
  (a/b/c/d×64) داشتند؛ «دستگاهِ تازه» (client-E) با ۴ هشِ بایت‌یکسانِ devA
  (مسدود) → strongEvasionMatch → cluster-block-inherit — **دقیقاً همان رفتاری که
  S2 خودِ استیج-۸۰ تأیید کرده است** (۳۲/۳۲). یعنی رفتارِ محصول درست است و
  fixture از ۸۰ عقب مانده بود: دستگاهِ «تازه» باید هش‌های یکتا داشته باشد.
- اصلاح: هش‌های sha256 یکتا per-clientId (تکرارپذیر برای همان client) — همان
  الگوی test-device-policy. **صفر تغییر در سرویس‌ها** — device.service/auth.service
  و کلِ منطقِ ۷۳–۸۰ دست‌نخورده.

### ۴) نتیجه — برای نخستین‌بار همه‌ی تست‌های PG در سندباکس اجرا شدند
- `db:test:migrations` **59/59** · `db:test:device` **32/32** · `db:test:permit`
  **33/33** · `db:test:intel` **28/28** — جمعاً ۱۵۲ بندِ سبز روی PostgreSQL 18.4.
- دروازه‌های ایستا: tsc api=۰ · tsc web=۰ · tsc shared=۰ · biome web = ۶۳۹/۱۴/۹
  = دقیقاً baseline.

### راهنمای اعمال
- جای‌گذاریِ ۲ فایلِ تست (+ REFERENCE) — **بدون مایگریشن/env/پکیج جدید**؛ کارفرما
  ۰۰۰۸ خودش را قبلاً generate و migrate کرده، پس فقط اجرای دوباره‌ی تست‌ها کافی
  است: `db:test:migrations` → 59/59 و `db:test:permit` → 33/33.

### فایل‌ها (۳: ۲ جایگزینیِ تست + مستند)
apps/api/scripts/test-migrations.ts · apps/api/scripts/test-registration-permit.ts ·
docs/REFERENCE.md

## ۲-۱۰-۱۴ — stage-82: صفحه‌سازِ بلوکیِ مقالات — انیمیشن، رنگ، جانماییِ درگ‌اند‌دراپ

> درخواست کارفرما: «صفحات افزودن/ویرایش مقالات را پیشرفته کنم — امکانات کامل‌تر و
> زیباتر. ادمین اصلی و ادمین سطح ۲ (با مجوز ادمین اصلی) باید بتوانند کامل‌ترین و
> زیباترین صفحات را بسازند: انیمیشن‌های مختلف، انتخاب رنگ‌های مختلف، جانماییِ
> عناصر در صفحه در سایزهای مختلف با درگ‌اند‌دراپ… تحقیق گسترده انجام بده.»

### ۰) خلاصه‌ی تحقیق (۱۶+ جست‌وجو — الگو ← برداشت)
| منبع/الگو | اصل | برداشتِ ما |
|---|---|---|
| Editor.js / Puck | سند = `{ version, blocks[] }` — JSON خالص نه HTML؛ جدا بودن ادیتور از رندر | `ArticleBlocksDoc` در shared + دو مصرف‌کننده‌ی مستقل |
| WordPress Gutenberg | «invalid content» وقتی شکل عوض شود | `version` در سند + بلوکِ ناشناخته = حذف، نه reject کل سند |
| Notion | id پایدار GUID برای هر بلوک | `crypto.randomUUID()` — دوبل‌کردن id تازه می‌گیرد (هرگز key=index) |
| Ghost | عرضِ پله‌ای: normal/wide/full | `ab-w-sm/md/lg/full` + موبایل همه full (container-query) |
| AOS | data-attribute انیمیشن + delay پلکانی + once | `data-anim` + `--ab-delay` + unobserve بعد از ورود |
| Base Web DnD / whatwg#3114 | درگ فقط روی handle؛ پاک‌سازی در dragend | handle ⠿ جدا از فیلدها؛ cleanup در dragend (لغو با Esc تمیز) |
| Redux undo | استک snapshot فقط ساختاری | واگردِ ۳۰ مرحله‌ای (افزودن/حذف/جابجایی/دوبل) |
| WCAG 1.4.3 + C39 | کنتراست متن با luminance؛ reduced-motion | `pickContrastText` خودکار + خاموشیِ کامل انیمیشن‌ها |
| IBM rich-text XSS | sanitize در ۳ لایه | TypeBox پاکت → normalizer سخت‌گیر → رندر defensive |
| MDN prefers-reduced-motion | انیمیشن = خطر vestibular | media query خاموش‌کن + SSR مرئی |

### ۱) مدل داده (منبعِ حقیقت: packages/shared/src/blocks.ts)
- ۱۰ نوع بلوک: **hero · heading · paragraph · image · gallery · quote · callout ·
  list · cta · divider** — استایل مشترک `{bg?, fg?, align?, pad?}` + `width` +
  `anim` (۶ حالت). رنگ فقط hex ۶رقمی (رشته‌ی آزاد ممنوع).
- ذخیره: ستون jsonb `articles.blocks` (الگوی processes). **back-compat کامل:**
  NULL = همان مسیرِ متنیِ قبل (`content.split('\n\n')`).
- **content همیشه از بلوک‌ها مشتق می‌شود** (`blocksToPlainText` — فرانت و بک
  هردو): لیست/سئو/sitemap/صفِ ترجمه که روی content سوارند هرگز از صفحه‌ساز
  عقب نمی‌مانند (درسِ تحقیق: «content متنی را ول نکن»).
- دوزبانگی: بلوک‌ها فارسی‌زبان‌اند؛ نمایِ عمومی ar همان مسیرِ متنیِ contentAr را
  نگه می‌دارد (`toView: lang==='ar' → blocks=null`) — صادقانه و بدون کپیِ ادیتور.

### ۲) اعتبارسنجیِ سه‌لایه (هیچ HTML خامی ذخیره نمی‌شود)
1. **TypeBox (روت):** پاکتِ سند — version literal، enum های type/width/anim،
   hex pattern، maxItems ۲۰۰.
2. **`blocks-normalize.ts` (سرویس):** whitelist بسته‌ی per-type props + trim +
   سقف‌ها (متن ۵۰۰۰/گالری ۱۲/فهرست ۳۰×۳۰۰) + **URL فقط `^https://` یا `/` نسبی**
   (javascript:/http:/data: رد) + cta بدون href معتبر → تنزل امن به menu +
   id تکراری → بازتولید + سقف سند ۲۵۶KB.
3. **رندر عمومی:** بلوکِ ناشناخته/خراب = skip، نه کرشِ صفحه.

### ۳) ادیتور (ArticlePageBuilder — React خالص، صفر پکیج جدید)
- پالتِ افزودن (۱۰ بلوک) + درج بعد از بلوکِ انتخاب‌شده.
- **درگ‌اند‌دراپ HTML5 روی handle** (⠿) با خطِ جایگاه (placeholder) — منطقِ فقط-Y
  (ذاتاً RTL-safe)؛ + دکمه‌های ↑/↓ (a11y/لمس) + دوبل + حذف.
- تنظیماتِ داخلِ هر بلوک: عرض (۴ پله با نوارِ زنده)، انیمیشن (۶)، رنگِ پس‌زمینه
  (۸ preset + color-picker بومی + حذف) + **متنِ خودکارِ کنتراست** با هشدارِ AA،
  پدینگ، چینش.
- **واگرد** (استکِ ساختاری) + **پیش‌نمایشِ موبایل/دسکتاپ** با container-query
  (عرض‌ها به کانتینر واکنش نشان می‌دهند — نه iframe).
- آپلود عکس با همان `FileUploader` موجود (progress/retry/uuid).
- در فرم: سوییچِ «صفحه‌ساز بلوکی ⇄ متن ساده» — تبدیلِ دوسویه (متن→پاراگراف‌ها)
  + هشدارِ صریح وقتی ذخیره در حالتِ متنی سند را پاک می‌کند.

### ۴) رندر عمومی (ArticleBlocksRenderer)
- **SSR/سئو-امن:** حالتِ مخفیِ انیمیشن فقط بعد از mount با کلاس `ab-js` —
  کرالر/بدون-JS متنِ کاملاً مرئی می‌گیرد؛ یک IntersectionObserver مشترک،
  threshold ۰٫۱۵، once، stagger پلکانی (سقف ۵×۸۰ms).
- عرض‌ها: sm ۵۰٪/md ۷۰٪/lg ۱۰۰٪/full = خروجِ امن از حاشیه (calc + margin
  منفی؛ **هرگز 100vw** — درسِ overflowX موبایل).
- prefers-reduced-motion → همه‌چیز مرئی و بی‌حرکت.

### ۵) مجوزها — «ادمین۲ با مجوز ادمین اصلی»
- دو پرچم جدید: `articlesRead` / `articlesWrite` (admin2_profiles + قرارداد).
- روت‌های `/admin/articles`: خواندن با articlesRead، نوشتن/دسته‌ها با
  articlesWrite (`requireAdmin2Permission` — ادمین اصلی همیشه رد می‌شود).
- فرانت: پیشوندِ مجاز + آیتمِ منو (gated) + PermissionGate روی new/edit +
  دو سوییچ در PermissionsEditor (پیش‌فرضِ افزودن: read=روشن، write=خاموش).
- فرمِ ادمینی‌سازی دست‌نخورده: هر دو نقش صفحه‌سازِ کامل را می‌گیرند.

### ۶) مایگریشن ۰۰۰۹ + درسِ استیج-۸۱ اعمال شد
- `0009_rapid_sage.sql` (drizzle-kit): `articles.blocks` jsonb +
  `admin2_profiles.articles_read/articles_write` — **rewindِ سناریوی A همان
  لحظه در test-migrations گسترش یافت** (drop column ها) و دو بندِ A2 تازه با
  راهنمایِ داینامیکِ «زنجیره بدون ۰۰۰۹ → bun run db:generate».

### ۷) تست‌ها (۲۰۹ بندِ سبز روی PG 18.4 واقعی در سندباکس)
- `db:test:blocks` (جدید — ۵۵ بندِ خالصِ بدون-PG): پاکت/بلوک‌ناشناخته/id/سقف‌ها/
  URL-الگو/گالری/CTA-تنزل/فهرست/استایل-whitelist/۲۵۶KB + مشتقِ متن + کنتراست.
- `db:test:migrations` ۵۹→**۶۱** (rewind + دو بندِ ۰۰۰۹) · `db:test:device` ۳۲ ·
  `db:test:permit` ۳۳ · `db:test:intel` ۲۸ — همه‌ی رگرسیون‌ها سبز.

### ۸) دروازه‌ها
- tsc api/web/shared = ۰ · **biome web = ۶۳۹/۱۴/۹ = دقیقاً baseline** (فایل‌های
  جدید فرمت‌شده + بدون خطای تازه) · i18n دست‌نخورده — پاریتی ۴۹۶/۴۹۶ (فرم‌های
  ادمین مثلِ قبل فارسیِ hardcode — الگوی موجود).

### فایل‌ها (۳۱: ۶ جدید + ۲۵ جایگزینی)
مشترک: blocks.ts (جدید) · contracts · index — بک: schema/articles · schema/admin2 ·
drizzle/0009 (جدید) + meta/0009_snapshot (جدید) + _journal · blocks-normalize.ts
(جدید) · article.service · admin2.service · articles.routes · admin2.routes · app ·
scripts/test-article-blocks.ts (جدید) · test-migrations · package.json — فرانت:
builder/blockModel.ts (جدید) · builder/ArticlePageBuilder.tsx (جدید) ·
site/article/ArticleBlocksRenderer.tsx (جدید) · ArticleForm · types/forms ·
server/articles · admin/articles/new · admin/articles/$articleId/edit · admin/route ·
AdminLayout · usePermissions · PermissionsEditor · articles/$articleId · styles.css —
مستند: REFERENCE.md

## ۲-۱۰-۱۵ — stage-84: ده قابلیت — بسته‌بندی اقلامی، درگاه‌ها، شلوغی، چاپ فاکتور سفارشی، QR ۳ ساعته و…

> درخواست کارفرما (۱۰ محور): اقلام بسته‌بندی با قیمت سراسری + قیمت اقلام روی
> همه‌ی محصولات + مشتری فقط جمع کل را می‌بیند · سوئیچ فعال/غیرفعال درگاه‌های
> پرداخت · خدمت چاپ فاکتور سفارشی (نه چاپ خودکار مرورگر) با انتخاب فاکتور
> سالن/آشپزخانه + چاپ هر زمان + متن بولد مشکی/سفیدرومشکی + زمان/روز/تاریخ/
> ساعت + نوع سفارش در هر دو فاکتور + طول چاپ کوتاه · وضعیت «شلوغ» رستوران
> (ادمین اصلی + ادمین۲ با مجوز) + هشدار نارنجی اسم/شماره میز در چک‌اوتِ
> سرو در محل · QR پیک ۳ ساعته + نمایش مسیر رستوران→مقصد روی نقشه · باکس
> «وضعیت رستوران» (باز/بسته دائم + موقت + شلوغی) در تنظیمات · فیلتر «امروز»
> (پیش‌فرض) + حالت خالی زیبا در سفارشات · دکمه نوتیفیکیشن لندینگ + متنِ
> کوچک‌تر + توگل‌ها از absolute خارج · برند پنل ادمین → صفحه محصولات ·
> گرید محصولات/مقالات: هر ردیف پُر (گام ۶) · هشدار نصب PWA روی لاگین ·
> حالت‌های سفارش جزئیات محصول (آیکون+کلمه سبز/قرمز) · بلوک‌های لینک و
> موقعیت در صفحه‌ساز مقالات.

### ۱) اقلام بسته‌بندی (مایگریشن ۰۰۱۳)
- جدول `packaging_items` (عنوان/عنوان عربی/قیمت/فعال/ترتیب) + junction
  `product_packaging_items` (PK مرکب + cascade؛ الگوی productCategories).
- **قیمتِ هر قلم «سراسری»** است: تغییرش همان لحظه روی همه‌ی محصولاتِ دارایِ
  آن قلم اعمال می‌شود؛ هزینه‌ی مؤثرِ هر محصول = جمعِ اقلامِ فعالِ انتخابی‌اش؛
  بدون قلم → پشتیبانِ ستونِ legacy `packaging_cost` (نصب‌های موجود دست‌نخورده).
- مسیر پول: `loadPricingBases` یک join اضافه کرد (`packagingByProduct`)؛
  checkout/preview فقط خطِ `product.packagingCost` را با «مقدار مؤثر» عوض
  کردند — breakdown/assert/DINE_IN=0/referralBase همه همان قبل.
- فرم محصول: چیپ‌های انتخاب + جمعِ زنده + فیلد دستی فقط وقتی قلمی نیست.
  کارتِ «مدیریت اقلام بسته‌بندی» در صفحه محصولات (ادمین اصلی + ادمین۲ با
  canEditPackagingFee — پرچمِ الکی از round-34 بالاخره wired شد؛ ممیزی
  PACKAGING_ITEM_ADD/UPDATE/REMOVE).
- مشتری فقط `breakdown.packagingFee` را می‌بیند (چک‌اوت/فاکتور) — ریزِ
  اقلام هرگز عمومی نیست.

### ۲) سوئیچ درگاه‌های پرداخت
- کلید تنظیمات `payment_gateways` ({mellat,zarinpal,sep}؛ نبود = همه فعال).
- کارت «درگاه‌های پرداخت» در تنظیمات (فقط ادمین اصلی) با سه Toggle.
- اعمالِ سه‌لایه: ① اعتبارسنجی چک‌اوت داخل tx با خواندنِ بدونِ-کش (`enabledGateways(tx)`)؛
  ② preview فیلد `gateways[]` می‌دهد → رادیوهای چک‌اوت فقط فعال‌ها؛ درگاهِ
  انتخابیِ غیرفعال‌شده ریست می‌شود؛ همه خاموش + مبلغ>0 → پیام شفاف؛
  ③ callbackهای درگاهِ غیرفعال‌شده هرگز بلاک نمی‌شوند (پولِ در جریان).

### ۳) خدمت چاپ فاکتور سفارشی (پایان چاپِ خودکار)
- چاپِ خودکار بعد از تایید «کاملاً حذف شد» (مودال تایید فقط وضعیت را عوض
  می‌کند؛ متن‌ها/دکمه‌ها به‌روز شدند).
- کامپوننت جدید `InvoicePrintCenterModal`: تیکِ فاکتور فروش (سالن/مشتری) و
  فاکتور آشپزخانه (پیش‌فرض هر دو روشن؛ انتخاب در localStorage ذخیره می‌شود)؛
  دکمه چاپ → هر فاکتور یک پنجره‌ی چاپ جدا (صف موجود) تا پرینتر مقصد همانجا
  انتخاب شود؛ در دسترس از: ① کارت سفارش در صفحه سفارشات (کنار جزئیات) ②
  کارت سفارش زنده — «هر زمانِ» بعد از تایید.
- موتور چاپ: استایل حرارتی `mono` (اعداد/نوشته‌ها مشکیِ بولد؛ هدرها/برچسب‌ها
  سفیدِ بولد روی نوار مشکی) + `fitHeight` (طولِ چاپ = طولِ محتوا: اندازه‌گیری
  بعد از رندر + تزریق @page؛ کلمپ ۴۰..۲۹۷mm — کلِ رول چاپ نمی‌شود).
- فاکتورها: «زمان سفارش: روزِ هفته، تاریخ کامل — ساعت» + «نوع سفارش»
  (پیک/بیرون‌بر/سرو در سالن) در هر دو نسخه.

### ۴) وضعیت «شلوغ» رستوران
- کلید `restaurant_busy` + متد‌های SettingsService + `isBusy` در
  RestaurantStatusDto/Display (عمومی از همان `/orders/restaurant-status`).
- روت `POST /admin/settings/busy` (shared؛ مجوز داخل سرویس) — ادمین اصلی
  همیشه + ادمین۲ با `canAnnounceBusy` (پرچمِ جدیدِ ۱۱-نقطه‌ای).
- چک‌اوت (فارسی+عربی): سرو در محل + شلوغ → هشدارِ نارنجیِ زیرِ باکس توضیحات
  («رستوران شلوغ است… مثال: علی امیری - 22») + گارد کلاینت و **سرور داخل
  tx** (۴۲۲ فارسی؛ کلید idempotency تمیز release می‌شود).
- باکس واحد «وضعیت رستوران» در تنظیمات: ① باز/بسته دائم ② اعلام شلوغی
  (بج‌های زنده) ③ بسته/باز موقت (کارت موجود) — رسپانسیو.

### ۵) QR پیک — ۳ ساعت + مسیر
- `COURIER_TOKEN_TTL_SECONDS` ۳۶۰۰→۱۰۸۰۰ (متن‌های ۳ جا هم).
- اسکن موفق پاسخِ `route` می‌دهد: origin (رستوران) + destination +
  polyline مسیرِ بدونِ-ترافیک (نشان، best-effort) + فاصله/زمان؛ صفحه‌ی اسکن
  نقشه‌ی «رستوران → مقصد» (ScanRouteMap؛ خطِ مستقیم اگر polyline نبود) می‌شود.

### ۶) سفارشات — فیلتر «امروز» (پیش‌فرض)
- sortDate گزینه‌ی `today` گرفت و پیش‌فرض شد (URL-driven)؛ مرزِ روزِ تهران
  سمت کلاینت با Intl (مستقل از TZ سرور) → dateFrom/dateTo → شرط gte/lte
  سرور (هم count هم rows؛ هر دو نقش).
- حالت خالی زیبا: «شما امروز سفارشی نداشتید» + دکمه «مشاهده همه».

### ۷) لندینگ + برند + گرید + PWA + جزئیات محصول
- دکمه «فعال‌سازی نوتیفیکیشن» زیر «دیدن محصولات» (enablePush در کلیکِ
  کاربر — الگوی درس stage-64؛ حالت‌های granted/denied با آیکون).
- متن هیرو در موبایل کوچک‌تر + فاصله خطوط کمتر؛ توگل‌های زبان/دارک از
  fixed به نوارِ بالای صفحه (جریان عادی) — برند دیگر زیر «العربية» نمی‌رود.
- برند پنل ادمین (۳ نقطه: سایدبار/هدر/دراور) → `/products`.
- گرید محصولات/مقالات: گام ۱۲ و +۶ (مضربِ LCM(2,3)) — هر ردیفِ قبل از
  دکمه «بیشتر» پُر می‌ماند (تک‌آیتمِ آخر ردیف حذف شد؛ سنجاش ویژه حفظ شد).
- صفحه لاگین: pb-28 تا بنرِ نصبِ PWA (bottom-4 جهانی) روی فرم نیفتد.
- حالت‌های سفارشِ جزئیات محصول: تیک/ضرب/پس‌زمینه/بوردر حذف؛ «آیکون +
  کلمه» سبز اگر مجاز، قرمز اگر نه.

### ۸) بلوک‌های «لینک» و «موقعیت» در صفحه‌ساز مقالات
- ۱۲ نوع بلوک شد: `link` (label + href https/نسبی + title/text + دکمه|کارت؛
  مسیر نسبی همان صفحه، خارجی تب جدید) و `location` (lat/lng ±۹۰/۱۸۰ گردِ
  ۶رقمی + عنوان/آدرس).
- سه لایه: TypeBox enum → normalizer (link بدون href معتبر = حذف؛ مختصات
  نامعتبر = حذف؛ variant=button ذخیره نمی‌شود — سند کوچک) → رندر defensive.
- رندر عمومی location: عنوان/آدرس (SSR-مرئی) + نقشه‌ی تعاملیِ کلاینتی
  (SDK نشان؛ بدون کلید → فقط آدرس + دکمه بیرونی) + دکمه «مشاهده روی نقشه».
- blocksToPlainText: عنوان/توضیحِ لینک و عنوان/آدرسِ موقعیت مشارکت می‌کنند
  (label دکمه نمی‌کند — نویز نیست)؛ گارد فرم: بلوک لینک بدون href معتبر →
  توستِ قبل از ذخیره.
- تست: N11 (لینک×۹) + N12 (موقعیت×۹) + N13 (مشتق متن×۳) — ۸۲ بند سبز.

### ۹) تست‌ها و دروازه‌ها
- `db:test:blocks` ۵۵→**۸۲** بند (لینک/موقعیت/مشتق) — بدون PG، سبز.
- `db:test:migrations`: rewind کامل ۰۰۱۳ (۲ جدول + can_announce_busy) +
  دو بند A2 با راهنمای داینامیک — الگوی درسِ ۸۱/۸۲.
- tsc api/web/shared = **۰** · biome web = ۶۰۴/۱۲/۷ (قبل از استیج ۶۶۲ —
  فرمت/organize-imports خودکار؛ ۵۸ خطای کمتر، هیچ خطای تازه) · i18n پاریتی
  (کلیدهای stage-84 هم‌زمان fa+ar).

### فایل‌ها (۷۱: ۹ جدید + ۶۲ جایگزینی)
مشترک: blocks.ts · contracts — بک: schema/{menu,settings,admin2} ·
drizzle/0013 + snapshot + journal · packaging.service.ts (جدید) ·
menu.service (loadPricingBases junction + sync + جزئیات) · order.service
(بسته‌بندی مؤثر + گارد شلوغی + درگاه‌های تنظیماتی + preview) · settings.service
(busy/gateways) · admin2.service (canAnnounceBusy + setBusy) · admin.service
(بازه تاریخ) · courier.service (TTL + routeForScan) · routes: admin-menu
(CRUD اقلام + packagingItemIds) · admin-settings (busy + gateways) · admin
(dateFrom/dateTo) · admin2 (مجوز) · articles (enum) · courier (متن) · app ·
index · test-article-blocks · test-migrations — فرانت:
InvoicePrintCenterModal (جدید) · PackagingItemsManager (جدید) ·
PaymentGatewaysCard (جدید) · RestaurantStatusCard (جدید) · ScanRouteMap
(جدید) · ArticleLocationMap (جدید) · printDocument (mono/fitHeight) ·
invoicePrint (زمان/نوع/استایل) · ConfirmOrderModal (حذف اتو-پرینت) ·
LiveOrderCard (دکمه چاپ) · live-orders + orders (مودال چاپ + امروز + خالی) ·
products/index (کارت اقلام) · ProductForm (چیپ‌ها) · settings/index ·
checkout/{index,PaymentSection,CustomerNoteBox,useCheckoutPage,server} ·
courier/scan (نقشه) · courier/index + courierSession · landing · login ·
AdminLayout · ProductInfo · ArticleForm (گارد لینک) · builder/{blockModel,
ArticlePageBuilder} · ArticleBlocksRenderer · useProductsPage/
useArticlesPage (گام ۶) · useAdminOrdersPage · usePermissions ·
PermissionsEditor · filters · server/{admin,products,courier} · queryKeys/
queryOptions · types/forms · i18n fa+ar — مستند: REFERENCE.md

### ۱۰) ترمیم پس از اسکن (stage-84 — راند دوم)
> اسکنِ عمیقِ همان استیج، ۱۲ اشکال در کدِ راند اول پیدا کرد — همه قبل از تحویل
> ترمیم شدند (این همان «مواردِ به‌تعویق‌افتاده به پنجره‌ی بعدی» نیست؛ آن‌ها
> بندِ ۱۱ همین سندند):
- **QR پیک — اسکنِ مجددِ idempotent**: قبلاً یک‌بارمصرف بود؛ حادثه/رفرش/بستنِ
  صفحه پیک را گیر می‌انداخت. حالا سفارشِ «در مسیر» تا ۳ ساعت پس از اولین
  اسکن، دوباره «موفق + مسیر» جواب می‌دهد (`alreadyScanned` → توستِ متفاوت؛
  وضعیت/زمان جابه‌جا نمی‌شود)؛ پس از آن پیامِ انقضای صریح (courier.service +
  server/courier + صفحه‌ی اسکن + پاک‌کردنِ watchPositionِ قبلی قبل از استریمِ
  تازه).
- **رمزگشایی polyline — سه خطای مرگبار**: `result=1` به‌جای ۰ · `+=` به‌جای
  `|=` · `-63` روی charCode اعمال نمی‌شد → خروجی زباله و خطِ مسیر هرگز
  رسم نمی‌شد. حالا عین الگوریتم تست‌شده‌ی CourierTrackingMap.
- **نشتِ WebGL نقشه**: cleanup داخل `.then` بود که React نادیده می‌گیرد →
  هر unmount یک context نشت می‌کرد و remount خطای «Container is already
  initialized» می‌داد. حالا map در ref + remove در cleanupِ واقعیِ افکت
  (ScanRouteMap + ArticleLocationMap).
- **کرشِ چاپ فاکتور با تاریخِ ISO**: `inv.date` در زمانِ اجرا رشته است (JSON
  بدون reviver) و Intl «Invalid time value» می‌داد و کلِ چاپ می‌افتاد →
  نرمال‌سازی safeDate؛ تاریخِ خراب فقط خطِ زمان را حذف می‌کند.
- **توگل‌های درگاه — قفلِ تا رسیدنِ وضعیت**: کلیکِ زودهنگام با پیش‌فرضِ
  «همه فعال» مقدارِ persist شدهٔ بقیه را بی‌صدا بازنویسی می‌کرد.
- **`[]` در برابرِ `undefined` در gateways**: «همه خاموش» با «کلاینتِ قدیمی»
  اشتباه می‌شد → رادیوها نمایش می‌یافتند و پیامِ gatewaysUnavailable مرده
  بود (سرور ۴۲۲ می‌داد) — حالا تفکیکِ صریح (هوک + PaymentSection).
- **انتخابِ اقلام بسته‌بندی = هزینه‌ی پولی**: create هم مثل update فقط با
  canEditPackagingFee یا ادمین اصلی (بدون مجوز ⇒ قلم حذف، پشتیبانِ legacy)؛
  چیپ‌های فرمِ محصول بدونِ مجوز قفل با راهنمای فارسی؛ خالی‌کردنِ فیلدِ قیمتِ
  سراسری دیگر «صفر» commit نمی‌کند.
- **گاردِ فرمِ بلوکِ موقعیت**: input عددی max=90 جلوی تایپِ دستی را نمی‌گیرد
  و سرور بلوکِ نامعتبر را بی‌صدا حذف می‌کرد → توستِ قبل از ذخیره.
- **پیوندهای داخلیِ بلوکِ link**: ناوبری SPA (router.history.push) + برچسبِ
  دکمه‌ی نقشه از i18n (فارسیِ هاردکد روی UI عربی نمی‌افتد).
- **فاکتور**: deliveryType هاردکد حذف (اختیاری؛ راهنمای QR فقط برای پیک) +
  پیش‌واکشی هنگامِ باز شدنِ مودالِ چاپ.
- **لندینگ**: نوارِ بالای صفحه mx-auto گرفت؛ متنِ هشدارِ شلوغی عینِ رسمِ
  کارفرما («رستوران شلوغ است ، لطفا … مثال : علی امیری - 22»)؛
  ProductInfo وضعیت‌ها role="status"؛ کلید article.viewMap (fa+ar).
- **فرمت**: بیوم روی فایل‌های راند اول (printDocument/invoicePrint و…) —
  بدون تغییرِ رفتار.

### ۱۱) مواردِ به‌تعویق‌افتاده (پنجره‌ی بعدی) — وضعیت نهایی
> شش مورد از اسکنِ استیج-۸۲ که کارفرما گفت «فعلاً نادیده بگیر، پنجره‌ی بعدی».
> پنج مورد را کارفرما خودش در کامیتِ stage eighty-three راند اولِ فیکس را
> زد؛ اینجا فقط راستی‌آزمایی شدند. موردِ ششم الان ترمیم شد:
- ✅ tsc×2 در `scripts/test-migrations.ts` — رفعِ مشابهِ `Number(articlePerms
  ?? 0)` — **تایپ‌چک api/web/shared = ۰** (راستی‌آزماییِ این راند).
- ✅ سندِ >256KB خاموش=null — حالا `Err.validation` با پیامِ صریحِ فارسی
  (blocks-normalize؛ کامیتِ ۸۳).
- ✅ URL_RE و «//evil.com» — `isArticleBlockUrl` پروتکل-نسبی را صریح رد
  می‌کند + منعِ نویسه‌های کنترلی + URL-parser (کامیتِ ۸۳).
- ✅ PATCH بدونِ کلیدِ blocks — سندِ موجود حفظ می‌شود
  (`input.blocks === undefined ? current.blocks : …`؛ کامیتِ ۸۳).
- ✅ clamp عرضِ full — `.ab-block.ab-w-full { max-width: calc(100% + 2rem) }`
  (کامیتِ ۸۳) + print-mode انیمیشن‌ها خاموش.
- 🔧 **403 ادمین۲ در آپلود — الان ترمیم شد** (تنها موردِ باقی‌مانده):
  `upload.routes.ts` از requireAdmin به requireAdmin2 رسید؛ ادمین۲ با
  `productsWrite` یا `articlesWrite` (هر دو مصرف‌کننده‌ی FileUploader)
  آپلود می‌کند؛ فقط-خواندن → 403 با پیامِ صریح؛ ادمین اصلی همیشه. مجوزِ
  جدیدی اضافه نشد — «مجوزِ نوشتنِ همان بخشی که تصویرش را آپلود می‌کند» =
  کمترینِ امتیاز. سیم‌کشی: app.ts (`admin2` پاس داده شد).

فایلِ تازه‌ی همین راند: upload.routes.ts (+ app.ts جایگزینی) — جمعِ بسته‌ی
stage-84: **۷۳ فایل (۱۰ جدید + ۶۳ جایگزینی)**.

### ۱۲) دروازه‌های نهاییِ این تحویل (اندازه‌گیریِ مجدد)
- blocks **۸۲/۰** (بدون PG) · migrations **۶۷/۰** · device **۵۱/۰** · permit **۳۸/۰**
  · intel **۲۸/۰** — همه روی PG 18.4 واقعیِ سندباکس، سبز.
- tsc api/web/shared = **۰** · biome web = **۶۰۴/۱۲/۷** (وب دست‌نخورده در این
  راند — هیچ خطای تازه) · lint پنل نمایش = **۰**.
- شمارشِ بندهای تست‌ها از کارِ قبلی رشد کرده (۶۱→۶۷ و ۳۲→۵۱ و ۳۳→۳۸) —
  فایل‌های تست در بسته‌ی همین استیج همین نسخه‌ی جدید هستند.

---

## ۲-۱۰-۱۶ — stage-85: مرکز چاپ فاکتور نسخهٔ ۲ — چاپ مستقیم + پیش‌نمایش + رسید فشرده

> درخواست کارفرما: «پیش‌فرض مشخص کنم کدام فاکتور با کدام پرینتر چاپ شود؛
> بعد از زدن چاپ دیگر واردِ انتخابِ پرینتر نشوم؛ داخلِ همان مودال
> پیش‌نمایش فاکتور باشد و قبلِ چاپ ببینمش؛ طولِ چاپِ فاکتور هنوز بلند
> است؛ باگ‌ها و گیرکردن‌های بخش چاپ را هم بررسی کن (الگو: اسنپ‌فود و
> پیاده‌سازی‌های پیشرفته)» + «باکسِ نوتیفیکیشنِ فعال از لندینگ برداشته
> شود؛ فقط اگر فعال نیست دکمه‌ی خالصِ "فعال‌سازی نوتیفیکیشن" زیرِ دیدنِ
> محصولات باشد و بعد از فعال‌سازی هیچ‌چیز نماند».

### ۱) چاپ مستقیم با تأیید QZ Tray

- **چرا؟** دیالوگِ چاپِ مرورگر هر بار «انتخابِ پرینتر» می‌خواهد و مقصدِ
  انتخابی‌شده سراسری است — رستورانِ دوپرینتری (سالن + آشپزخانه) باید هر
  سفارش دو بار دستی انتخاب کند. راه‌حلِ استانداردِ وب (همان الگوی کیت‌های
  فروشندگانِ اسنپ‌فود و پنل‌های POS): یک «عاملِ چاپ محلی» روی دستگاهِ
  صندوق — نرم‌افزارِ رایگانِ **QZ Tray** (qz.io) — پرینترهای سیستم را
  از طریق WebSocket لوکال به صفحه می‌دهد و فاکتور مستقیم به «پرینترِ
  منتخبِ همان نوع فاکتور» می‌رود. درخواست‌ها در QZ Tray تأیید می‌شوند.
- فایل جدید `apps/web/src/lib/printAgent.ts` — کلاینتِ پروتکلِ رسمیِ
  qz-tray.js با **صفر وابستگی جدید** (بدون کتابخانه):
  - سوکت: `wss://localhost:8181` و پشتیبانِ `ws://localhost:8182`
    (لوکال‌هاست برای مرورگر «قابل‌اعتماد» است) — هر کدام که جواب داد.
  - پاکتِ پیام: `{call, params, timestamp, uid, signature,
    signAlgorithm, position}` — عینِ کتابجهٔ رسمی.
  - پیامِ نخست: `certificate: null`؛ درخواست‌ها با `signature: ''`
    از مسیر رسمیِ بدون امضا استفاده می‌کنند و QZ تأیید کاربر می‌خواهد.
    کلید خصوصی و گواهیِ قبلی از باندل عمومی حذف شده‌اند.
  - «ping» خام هر ۲۵ ثانیه (زنده‌ماندنِ سوکت) — همان الگوی رسمی.
- **فعال‌سازی در مغازه** (یک‌بار، ۲ دقیقه): نصبِ QZ Tray از qz.io روی
  دستگاهِ صندوق → بازِ مودالِ چاپ → «تلاش مجدد» → تأیید درخواست‌های QZ.
  اتصالِ wss نیاز دارد کاربر یک بار `https://localhost:8181` را باز
  کند و استثنای گواهی را بپذیرد (QZ خود-signed است)؛ مسیرِ ws:8182
  معمولاً بدونِ آن کار می‌کند.
- **کلید خصوصی**: چاپ بدون تأیید نیازمند امضاکنندهٔ سمت سرور و کلید
  خصوصیِ خارج از باندل است. اگر قبلاً گواهی «Sinshin Web Print» را
  در QZ مورد اعتماد قرار داده‌اید، آن را از فهرست اعتماد حذف کنید؛ کلید
  قبلی عمومی بوده است. نسخهٔ فعلی از آن گواهی استفاده نمی‌کند.
- **fallback کامل**: بدونِ QZ Tray / بدون Secure Context / هر خطای
  مسیرِ مستقیم → همان رفتارِ stage-84 (دیالوگِ مرورگر)؛ هیچ سفارشِ
  چاپی نمی‌میرد.

### ۲) پرینترِ پیش‌فرضِ هر فاکتور + پیش‌نمایش داخل مودال

- هر نوع فاکتور (فروش/آشپزخانه) یک `<select>` پرینتر دارد — گزینهٔ اول
  «دیالوگ مرورگر (پیش‌فرض)»، بقیه = فهرستِ واقعیِ پرینترهای دستگاه (از
  QZ). ذخیره در `localStorage: sinshin-invoice-printers` (جدا از
  `sinshin-invoice-kinds` تیک‌ها). پرینترِ ذخیره‌شده اگر در فهرستِ فعلی
  نباشد (تغییر نام/حذف) خودش به دیالوگ برمی‌گردد — state + حافظه.
- **پیش‌نمایش**: تبِ «فروش / آشپزخانه» بالای کاغذِ ۸۰mm — همان HTMLِ
  چاپ (`buildPrintDocumentHtml` — یک موتور، دو مصرف) داخلِ iframe
  سفیدِ کاغذی؛ ارتفاع بعد از لودِ فونت‌ها اندازه‌گیری می‌شود؛ در
  عرض‌های باریک scale می‌خورد (نه برشِ افقی). فاکتورها هنگامِ باز
  شدنِ مودال پیش‌ساخته می‌شوند (شبکه + QR) تا پیش‌نمایش و چاپ آنی
  باشد.
- نتیجهٔ چاپ (`InvoicePrintResult`): direct/dialogs/agentErrors —
  توستِ درست: «مستقیم به پرینتر ارسال شد» / «چاپ ارسال شد» / خطای
  مستقیم + «با دیالوگ جایگزین شد».

### ۳) طولِ چاپ کوتاه‌تر — «رسید فشرده»

- علتِ بلندیِ قبلی: فاصله‌های هوایی (line-height 1.9، marginهای ۳-۴mm،
  QR ۲۸mm، حاشیهٔ ۲.۵mm + اَسنک ۸mm) — مجموعاً ~۲۰-۳۰mm کاغذِ خالی
  در هر فاکتور. حالا (RECEIPT_CSS + fitReceiptHeight):
  - `@page` margin: `2.5mm 2mm` → `1.5mm 1.5mm`
  - اَسنکِ ارتفاع: `+8mm` → `+3mm` (جای برشِ حرارتی)
  - line-height: 1.9 → 1.55 (meta/note/cap) · فونت‌ها ۱-۲px کوچکتر
  - marginهای بلوک‌ها نصف · QR: 28 → 24mm
  - عرضِ پروبِ اندازه‌گیری: 288 → **291px** (= عرضِ قابل‌چاپِ واقعیِ
    ۷۷mm بعد از کاهشِ حاشیه — هم‌ترازِ چاپ)
- به‌علاوه مسیرِ مستقیم (QZ) هم «قدِ محتوا» را با همین اندازه‌گیری به
  عنوانِ `size` کاغذ می‌فرستد — چاپ حرارتیِ بی‌رولِ اضافه.

### ۴) ترمیم باگ‌ها/گیرکردن‌های چاپ

- **۹۰ ثانیه گیر**: اگر `afterprint` در بعضی کروم/اندروید (بعد از
  لغوی دیالوگ) نیاید، مودال تا سقفِ ۹۰s «در حال چاپ» می‌ماند. حالا
  `matchMedia('print')` هم گوش می‌دهد — کروم/فایرفاکس هنگامِ بازشدنِ
  دیالوگ مدیاکوئری print را فعال و بعدِ بستن غیرفعال می‌کنند؛ همان
  لحظهٔ خروج = سیگنالِ اتمام (afterprint و سقفِ ۹۰s همچنان پشتیبان).
- خطای چاپِ مستقیم هرگز سفارش را نمی‌کُشد — همان فاکتور با دیالوگِ
  مرورگر جایگزین و پیامِ صریح برمی‌گردد.
- iOS: مسیرِ پنجرهٔ جدید (بدونِ تغییر) — پیامِ واضحِ پاپ‌آپ‌بلاک.
- دکمهٔ پاپ‌آپ/چاپ دوباره‌کلیک: گاردِ printing (مثل قبل) + پیش‌ساختِ
  specها.

### ۵) لندینگ — باکسِ نوتیفیکیشن

- «فعال است» حذف شد: `granted → null` (حتی یک px ارتفاع نمی‌ماند).
  فقط وقتی فعال نیست، **یک** دکمه با متنِ «فعال‌سازی نوتیفیکیشن» +
  آیکون زنگ زیرِ «دیدنِ محصولات» — بدونِ هیچ کلمه/بج/حالتِ رنگیِ دیگری
  (خواستهٔ عینی کارفرما). denied هم «فعال نیست» → همان دکتهٔ واحد.
- کلیدهای i18n قدیمی (`landing.notifyGranted/Ask/Fail`) در دیکشنری
  ماندند (پاریتی fa/ar دست‌نخورده) ولی دیگر مصرف نمی‌شوند.

### ۶) دروازه‌ها و راستی‌آزمایی

- tsc api/web/shared = **۰** · biome web = **۶۰۳/۱۰/۷** (از ۶۰۹/۱۲/۷ِ
  کامیتِ eighty-four — هر ۵ فایلِ این استیج صفر خطا؛ ۶ خطا کمتر) ·
  `db:test:blocks` = **۸۲/۰** سبز.
- بوتِ `vite dev` + GET / = HTTP 200 (لودِ ماژول‌ها/SSR سالم).
- تست‌های جاری: `bun run test:printing` — پروتکل QZ بدون امضا، اتصال
  همزمان، رخدادهای پایان چاپ، خطاها، مهلت فونت‌ها و پاک‌سازی iOS.

### فایل‌ها (۵: ۱ جدید + ۴ جایگزینی)

- `apps/web/src/lib/printAgent.ts` — **جدید** — کلاینتِ QZ Tray (پروتکل
  + تأیید QZ + keepalive + fallback).
- `apps/web/src/lib/printDocument.ts` — رسیدِ فشرده + ثابت‌های کاغذ +
  `buildPrintDocumentHtml` + `measureReceiptHtmlHeightPx` +
  سیگنالِ matchMedia + حذفِ non-null.
- `apps/web/src/utils/invoicePrint.ts` — `buildInvoicePrintSpecs` عمومی
  + `printOrderInvoices` با agentPrinters + جایگزینیِ امنِ مسیرِ مستقیم.
- `apps/web/src/components/admin/admin2/InvoicePrintCenterModal.tsx` —
  نسخهٔ ۲: پیش‌نمایش + پرینترِ پیش‌فرض + وضعیتِ سرویس + toasts دقیق.
- `apps/web/src/routes/index.tsx` — دکمهٔ نوتیفیکیشنِ «تک‌حالته» (گرنتed
  → هیچ).

---

## ۲-۱۰-۱۷ — stage-86: غیرفعال‌سازی خرید دسته‌بندی‌ها (والد + زیردسته)

> خواستهٔ کارفرما: «هر دسته‌بندی والد و هر دسته‌بندی زیر اش رو غیر فعال
> کنم؛ بعدِ غیرفعال‌کردن، گزینهٔ اضافه‌به‌سبد در کارت محصول و صفحهٔ
> مخصوصِ محصول غیرقابل‌کلیک بشه. این امکان در صفحهٔ محصولاتِ پنل ادمین
> اصلی باشه و ادمین سطح ۲ هم با مجوز (دسترسی و ویرایش محصولات) بتونه
> این کار رو انجام بده.»

### ۱) مدل داده — مایگریشن ۰۰۱۴ (`0014_sticky_mimic.sql`)

- `categories.purchase_enabled` + `main_categories.purchase_enabled`
  (هر دو `boolean NOT NULL DEFAULT true`) — «امکان خریدِ محصولاتِ
  این دسته/والد». پیش‌فرضِ true یعنی رفتارِ همهٔ استیج‌های قبل دست‌نخورده.
- **جدا از `main_categories.is_active` است** (آن = نمایش/پنهان‌شدنِ تب در
  سایت). غیرفعال‌سازیِ خرید = محصولات می‌مانند و فقط خرید قفل می‌شود —
  دقیقاً همان چیزی که کارفرما توصیف کرد.
- «مؤثرِ» هر محصول = `purchase_enabled` دستهٔ **اولیه** AND والدِ **اولیه**
  (زنجیرهٔ مسیر پول — `p.category_id` خام؛ سازگار با M2M های stage-60).

### ۲) بک — menu.service + روت‌ها

- `loadCategoryPurchaseStates(db, ids)` — هلپرِ صادرشده (الگوی
  `loadCategoryModes`): join دسته→والدِ اولیه؛ نقشهٔ
  `{categoryPurchase, mainPurchase, categoryName, mainName}` (نام‌ها برای
  پیام‌های خطا).
- `withSizes` → فیلد تازهٔ `purchasable` روی **هر** ProductDto (منوی عمومی،
  جزئیات محصول، لیست ادمین، فرم ویرایش) — محاسبهٔ سروری زنجیرهٔ دسته.
- `setMainPurchase(id, enabled)` / `setCategoryPurchase(id, enabled)` —
  ایدمپوتنت (پیامِ «از قبل») + `cache.invalidate()` + رویداد `menu:live`
  با `reason: 'category'` → سبد/چک‌اوتِ باز همان لحظه رفرش می‌شوند.
- `adminPurchaseState()` — لیستِ کاملِ والد+زیردسته برای پنل (بدون کش).
- روت‌ها (گاردِ عمدی = **`productsWrite`** — طبقِ خواستهٔ کارفرما، نه
  mainCategoriesWrite):
  - `GET /admin/menu/purchase-state` (productsRead)
  - `POST /admin/menu/mains/:id/purchase` و
    `POST /admin/menu/categories/:id/purchase` (productsWrite؛ ممیزی
    MAIN/CATEGORY_PURCHASE_ON/OFF برای ادمین اصلی)
  - **ادمین۲ با «مشاهده+ویرایش محصولات»** کامل می‌تواند (ادمین اصلی همیشه).

### ۳) گارد پولی — سبد و چک‌اوت

- `cart.service`: `available = ACTIVE && isAvailable && دسته && والد`؛
  آیتمِ قفل‌شده = `available:false` + **`blockedReason:'category'`** +
  خارج از جمع (رفتارِ stage-48 برای ناموجودی، با پیامِ مخصوص).
- `order.service` (ثبت + پیش‌نمایش): آیتمِ دسته/والدِ غیرفعال → خطای
  صریح «خرید «نامِ دسته/والد» فعلاً غیرفعال شده است — این محصول را از
  سبد حذف کنید.» + همان فیلد در آیتم‌های preview.
- ترمیمِ ریزِ همراه: گاردِ ناموجودی/دسته حالا **مقدم بر** «هیچ آیتم
  معتبری در سبد نیست» است (پیامِ مشخص‌تر برای سبدِ تک‌آیتمیِ تماماً-قفل).

### ۴) فرانت — پنل + سایت

- **`CategoryPurchaseManager` (جدید)** در صفحهٔ محصولات: کارتِ «فعال‌سازی
  خرید دسته‌بندی‌ها» — والد‌ها (با سوئیچ + بج قفل/باز + شمارِ زیردسته‌ها)
  و زیردسته‌های هر والد (سوئیچ + بجِ «خرید غیرفعال»). سوئیچ = productsWrite
  (ادمین۲ بدونِ آن فقط می‌بیند)؛ نامعتبرسازیِ کامل (منو/جزئیات/سبد/چک‌اوت).
- بج‌های اطلاعیِ غیرفعال در `MainCategoryManager`/`CategoryManager` (بدون
  اکشن — فقط نمایش) + بجِ «خریدِ دسته غیرفعال» روی کارتِ محصولِ ادمین.
- **کارت محصول سایت**: `purchasable=false` → دکمهٔ سبد قفل (خاکستری +
  cursor-not-allowed + aria/title مخصوص) + برچسبِ نارنجیِ روی تصویر
  **بدون تاری** (محصول موجود است — جدا از حالتِ «ناموجود» که تار می‌کند).
- **صفحهٔ محصول**: `purchasable` به‌عنوان prop جدیدِ PriceBox/MobileBar →
  دکمهٔ سبد قفل + هشدار نارنجی با متنِ مخصوصِ «دسته‌بندی غیرفعال»
  (دسکتاپ + نوارِ موبایل) + گارد/توست در هوک صفحه.
- **ردیفِ سبد**: پیام بر اساس `blockedReason` — «خرید این محصول توسط
  مدیریت غیرفعال شده است…» (جدا از «ناموجود»).
- i18n: ۴ کلیدِ جدید fa/ar (`common.purchaseDisabledBadge`،
  `pdetail.categoryDisabledNotice/Toast`، `cart.purchaseBlockedItem`) —
  پاریتی ۵۱۲/۵۱۲ دست‌خورده.

### ۵) تست‌ها (روی PostgreSQL 18.4 واقعی)

- `db:test:purchase` (جدید — `scripts/test-category-purchase.ts`): ۷ بند —
  پیش‌فرض‌ها · قفلِ زیردسته در جزئیات/لیست/ادمین · ایدمپوتنسی · سبد
  (blockedReason + خارج از جمع) · preview + ردِ سفارش با نامِ دسته ·
  قفلِ والد با نامِ والد در پیام · برگشتِ لحظه‌ای + سفارشِ موفق.
- `db:test:migrations` = **۶۹/۰** (+۲ بندِ ۰۰۱۴: ستون‌ها + پیش‌فرضِ true؛
  rewind هم `drop column if exists` های ۰۰۱۴ را برمی‌گرداند — درسِ استیج-۸۱).
- **ترمیمِ میراثِ ۸۴**: `db:test:order` (test-order-safety) از stage-84
  قرمز مانده بود (استابِ `isBusy`/`enabledGateways` به‌روز نشده بود و در
  دروازه‌ها اجرا نمی‌شد) — الان **۱۶/۱۶ سبز** و دوباره بخشِ دروازه.
- بقیه: device **۵۱/۰** · permit **۳۸/۰** · intel **۲۸/۰** · blocks **۸۲/۰**
  = ۲۹۱ بندِ سبز.

### ۶) دروازه‌ها

- tsc api/web/shared = **۰** · biome web = **۵۸۸/۱۰/۷** (از ۶۰۳/۱۰/۷ِ
  کامیتِ eighty-five — هر فایلِ دست‌خورده صفر خطای تازه؛ ۱۵ خطای فرمتِ
  پیش‌existingِ همان فایل‌ها هم با biome format بسته شد) · lint پنل = ۰.

### ۷) اعمال

1. جای‌گذاری فایل‌ها → `bun run db:migrate` (مایگریشن ۰۰۱۴)
2. `docker compose up -d --build api web`
3. (اختیاری) `bun run db:test:purchase` و `db:test:migrations`

### فایل‌ها (۳۰: ۴ جدید + ۲۶ جایگزینی)

- **جدید**: `drizzle/0014_sticky_mimic.sql` + `meta/0014_snapshot.json`
  (+`_journal.json`) · `scripts/test-category-purchase.ts` ·
  `components/admin/products/CategoryPurchaseManager.tsx`
- **بک**: `schema/menu.ts` · `menu.service.ts` · `admin-menu.routes.ts` ·
  `cart.service.ts` · `order.service.ts` · (`test-migrations.ts` +
  `test-order-safety.ts` + `package.json` — تست/اسکریپت)
- **مشترک**: `packages/shared/src/contracts.ts` (MainCategory/Category
  `purchaseEnabled` · `Product.purchasable` · `CartItemDto/
  CheckoutPreviewItem.blockedReason` · `PurchaseStateDto` + دو DTO)
- **فرانت**: `ProductCard` · `ui.ts` · `useProductPage` · `$productId` ·
  `ProductPriceBox`/`ProductMobileBar` · `CartItemRow` ·
  `server/products.ts` · `queryKeys`/`queryOptions` · صفحهٔ products ادمین ·
  `AdminProductCard`/`CategoryManager`/`MainCategoryManager` (بج‌های اطلاعی)
  · `i18n/fa+ar`

---

## ۲-۱۰-۱۸ — stage-88: پل چاپ سرور — تشخیص/پیکربندی/انتخاب چاپگر بدونِ ابزارِ ثالث + طولِ کاغذ = طولِ محتوا

> خواستهٔ کارفرما: «در مودال چاپ فاکتورِ صفحهٔ سفارشات، بخشِ انتخاب چاپگر
> فقط "پنجرهٔ مرورگر" را نشان می‌دهد؛ چاپگرهای شناسایی‌شدهٔ سیستم نشان
> داده نمی‌شوند. یک راه‌حلِ استاندارد برای تشخیص/پیکربندی/انتخاب چاپگر
> (برای هر نوع فاکتور) می‌خواهم که به هیچ ابزارِ شخصِ ثالث یا ابزارِ
> مرورگر نیاز نداشته باشد. به‌علاوه فاکتورهای چاپی باید با اندازهٔ واقعیِ
> محتوا مطابقت داشته باشند — الان کاغذِ زیادی هدر می‌رود.»

### ۰) نتیجهٔ تحقیق (دسته‌بندی‌شده — دو رکنِ مسئله)

**رکنِ اول — چرا «چاپگرهای سیستم» در مودال دیده نمی‌شد؟**

- **A) حقیقتِ سندباکسِ وب**: صفحهٔ وب هرگز فهرستِ چاپگرهای سیستم‌عامل را
  نمی‌بیند. `window.print()` فقط دیالوگِ خودِ مرورگر را باز می‌کند و
  Web Print API پیشنهادی (WICG) فقط برای **Isolated Web App**های امضاشدهٔ
  کروم شمارهٔ `147` است — نه صفحهٔ عادی. WebUSB روی ویندوز توسط درایورِ
  خودِ چاپگر قفل است؛ WebBluetooth فقط BLE؛ fetch مستقیم به IPP (پورت
  `631`) با CORS رد می‌شود. **هیچ مسیرِ استانداردی از دلِ صفحهٔ وب به
  فهرستِ چاپگرهای OS وجود ندارد** — این طراحیِ پلتفرم است، نه نقصِ کدِ ما.
- **B) پلِ چاپِ سرور (راهِ استانداردِ POSهای واقعی — Toast/Deliverect و
  همهٔ هم‌رده‌ها)**: خودِ سرور با سوکتِ خام حرف می‌زند. پروتکلِ عملی:
  **RAW/JetDirect پورت 9100** — هر چاپگرِ فیشِ شبکهٔ سازگار-ESC/POS
  (Epson TM / Xprinter / Posiflex / Rongta و…) آن را باز می‌کند و
  بایت‌ها را همان‌جا چاپ می‌کند؛ حتی `DLE EOT` وضعیتِ کاغذ/آنلاین بودن
  را همان سوکت برمی‌گرداند. mDNS از پشتِ docker bridge رد نمی‌شود ⇒
  تشخیص = «اسکنِ زیرشبکه از سرور (NAT خروجی عبور می‌کند) + ورودِ دستیِ
  IP» — سندکیسِ داکر.
- **C) ابزارِ ثالث (QZ Tray و هم‌گروه‌ها)**: به‌درخواستِ صریحِ کارفرما
  کنار گذاشته شد — مسیرِ stage-85 حذف شد از مودال (کتابخانهٔ `printAgent`
  دست‌نخورده می‌ماند ولی هیچ‌جای اپ دیگر به آن وصل نیست).

**رکنِ دوم — چرا کاغذ هدر می‌رفود؟**

- چاپ از مرورگر «صفحه‌محور» است؛ `@page { size: 80mm auto }` در کروم
  عملاً بی‌اثر است و اندازهٔ فرمِ درایور (A4/297mm) اعمال می‌شود — رسیدِ
  ۱۰ سانتی‌متری روی فرمِ ۲۹۷mm پَد می‌شود.
- **راه‌حلِ استانداردِ POS**: رسید = **راسترِ ESC/POS** (`GS v 0`): پرینتر
  دقیقاً به‌اندازهٔ ارتفاعِ تصویر کاغذ می‌کشد (مستقل از line-spacing) +
  فیدِ برش + `GS V`. طولِ کاغذ = طولِ محتوا + چند میلی‌مترِ حاشیهٔ برش.
- **قیدِ فارسی**: هیچ کدپیجِ ESC/POS (1256/864/720) شکل‌گیریِ حروفِ فارسی
  ندارد — حروف جدا و وارونه چاپ می‌شوند. راه‌حلِ استاندارد: **رندر در
  canvasِ مرورگر** (مرورگر با HarfBuzz خودش RTL/اتصال را کامل می‌کند) →
  بیت‌مپِ 1bpp → `GS v 0`. عین‌همین کار را esc-pos-encoder-canvas و
  POSهای فارسیِ واقعی می‌کنند.

### ۱) بک — `domain/print/` (صفر پکیج)

- `escpos.ts` — کدگذارِ بایت‌به‌بایت طبقِ مرجعِ رسمیِ اپسون:
  `ESC @` · `LF` · `ESC d n` (فید) · **`GS v 0`** (راستر: xL/xH=«بایتِ
  ردیف» و yL/yH=«dot» — نامتقارن، LE؛ bit=1 مشکی؛ MSB چپ) · **قطعه‌بندی
  ≤ ۹۶۰ dot + LF بینِ قطعه‌ها** (سرریزِ بافر چاپگرهای کلون) · `GS V 66 0`
  (برشِ جزئی + فید تا محلِ تیغه) · `DLE EOT 1/4` (وضعیتِ لحظه‌ای —
  حتی وقتی بافر پر است) + تفسیرِ بیت‌ها (کاغذ تمام/رو‌به‌اتمام/آفلاین) ·
  صفحهٔ تستِ اسکی (PC437).
- `print.service.ts` — `PrinterService`:
  - **CRUD** جدول `printers` + یکتاییِ `(host,port)` (تکرار = 409 صریح)
  - **probe زنده**: اتصال + `DLE EOT 1+4` با کشِ ۸ ثانیه‌ای؛ نتیجه روی
    ردیف ذخیره می‌شود (status/detail/lastStatusAt) — مودال بدونِ اسکنِ
    دوباره وضعیت را نشان می‌دهد.
  - **dispatch**: اعتبارسنجی (عرض = سرِ چاپ، طولِ داده = ⌈w/8⌉×h، سقف
    ۴۰۰۰ dot) → پیش‌پروازِ کاغذ (**کاغذِ تمام = خطای صریح قبل از ارسال**) →
    `buildRasterJob` → سوکت با مهلتِ اتصال ۳s/نوشتن ۲۰s و drain-aware.
  - **discover**: اسکنِ CIDR (پورت‌های 9100/631، هم‌روندیِ ۶۴، سقفِ ۵۱۲
    میزبان، مهلتِ ۳۵۰ms) — پیش‌فرض از env `PRINT_SCAN_CIDRS` وگرنه
    کارت‌های سرور. نتیجه فقط «پیشنهاد» است؛ ثبت نهایی دستی.
  - **تخصیص**: settings `invoice_printers` = `{sales, kitchen}` (الگوی
    درگاه‌ها) — حذفِ چاپگر، تخصیصش را خودکار null می‌کند.
- `print.routes.ts` — `/admin/print/*`:
  - **shared (ادمین اصلی + ادمین۲)**: `GET printers` (وضعیتِ زنده) ·
    `GET/POST assignment` · `POST receipt` (بیت‌مپِ 1bpp؛ bodyLimit ۸MB).
  - **owner (فقط ادمین اصلی)**: `POST/PATCH/DELETE printers` ·
    `POST printers/:id/test` · `POST discover` (timeout ۹۰s) — مدیریتِ
    سخت‌افزار کارِ رئیس (الگوی ناحیه‌ها/درگاه‌ها). ممیزی:
    PRINTER_ADD/UPDATE/REMOVE/TEST/DISCOVER/ASSIGN.

### ۲) مایگریشن ۰۰۱۵ (`0015_amusing_ben_parker.sql`)

- جدول `printers` (id/name/host/port/width_dots/auto_cut/last_status/
  last_status_detail/last_status_at/timestamps) + `unique(host,port)` +
  ایندکسِ status. `width_dots`: ۵۷۶=۸۰mm · ۳۸۴=۵۸mm کلون · ۴۲۰=اپسون۵۸.
- `test-migrations.ts` += سه بندِ A2 (جدول/پیش‌فرضِ 576/ایندکسِ یکتا) +
  rewind در `buildLegacyAt0004` (`drop table printers`).

### ۳) فرانت — رندرِ canvas + مودالِ نسخهٔ ۳

- `lib/receiptCanvas.ts` (جدید) — همان چیدمانِ «رسیدِ mono» مرحلهٔ ۸۴/۸۵
  اما روی canvas: برند (Morabba) · هدرِ سفیدرومشکی · متا/آمار (برچسب
  راست/مقدار چپ + خط‌چین) · جدول با قاب و سلول‌های کلمه‌شکسته (نسخهٔ
  آشپزخانه درشت) · نکته در قابِ خط‌چین · **QR به‌صورت تصویرِ SVG با
  نزدیک‌ترین‌همسایه** (ماژول‌ها نرم نمی‌شوند) · فوتر. خروجی: `1bpp`
  MSB-first/ردیف‌major/آستانه‌ی ۱۲۸ (تیزترین متن در 203dpi) + base64؛
  صفِ تک‌به‌تک (رندرهای هم‌زمان بر هم نمی‌غلتند)؛ فونت‌ها با
  `document.fonts.load` آماده می‌شوند (fallback: Tahoma).
- `InvoicePrintCenterModal` نسخهٔ ۳:
  - **منبعِ چاپگرها = سرور** (`useQuery(adminPrintersOptions)`) — وضعیتِ
    زندهٔ هر چاپگر (● آنلاین / ○ آفلاین + علت) در خودِ گزینه‌ها.
  - **تخصیصِ هر فاکتور → چاپگر، سروری است** (mutation + invalidate؛
    بینِ همهٔ ایستگاه‌ها مشترک). «دیالوگ مرورگر» گزینهٔ اول/پیش‌فرض می‌ماند.
  - **چاپ مستقیم**: `printOrderInvoices(inv, kinds, {directTargets})` →
    برای هر فاکتورِ دارای چاپگر: `renderSpecToReceiptBitmap` →
    `POST /admin/print/receipt` → سرور → سوکت. خطا = همان فاکتور با
    دیالوگِ مرورگر (سفارشِ چاپ هرگز نمی‌میرد) + توستِ دقیق.
  - QZ Tray حذف شد از مودال (چیپِ وضعیت/لینکِ نصب) — `printAgent.ts`
    کتابخانه‌اش می‌ماند اما بی‌مصرف است (حذفِ کدِ کارفرما لازم نبود).
  - **PrinterManager** (فقط ادمین اصلی، بخشِ تاشو): افزودن (نام/IP/پورت/
    عرض/برش) · تستِ اسکی · حذف · **اسکنِ CIDR** با «قرار بده در فرم +».
- `server/admin.ts` += ۹ تابعِ چاپ · `queryKeys/queryOptions` += دو
  کلید/فکتوری · `invoicePrint.ts`: مسیرِ مستقیم با `DirectPrintTarget`.

### ۴) سیم‌کشی/مستندات

- `app.ts` (`printRoutes`) + `index.ts` (`PrinterService({db, settings})`)
  + shared `contracts.ts` (PrinterDto/InvoicePrinterAssignmentDto/
  PrinterDiscoveryDto) · compose/env: `PRINT_SCAN_CIDRS` (اختیاری).

### ۵) تست‌ها (PG 18.4 واقعی + چاپگرِ فیکِ TCP در همان پروسه)

- `scripts/test-print-service.ts` (جدید — `bun run db:test:print`) — ۲۵ بند:
  بایت‌های GS v 0 (xL=بایت/yL=dot/LE) · قطعه‌بندی 960/960/120 · دنبالهٔ
  LF+ESC d 2+GS V 42 0+ESC @ · autoCut=false بدونِ برش · تفسیرِ DLE EOT ·
  صفحهٔ تستِ اسکی · CRUD + تکراری + hostِ نامعتبر · probe آنلاین · تخصیص
  (+ردِ مجهول) · **چاپِ واقعی روی سوکتِ فیک** (probe + ESC @ + هدرِ
  رستری + برش در سیم) · عرضِ ناهمخوان · دادهٔ ناقص · **کاغذِ تمام =
  خطا قبل از ارسال و بدونِ رستر روی سیم** · ویرایش/حذف (تخصیص پاک شد) ·
  404 بعد از حذف · **اسکنِ CIDR فیک را روی 127.0.0.1:9100 پیدا کرد** ·
  CIDRهای نامعتبر/بزرگ.
- `test-migrations`: ۶۹→**۷۲** (سه بندِ ۰۰۱۵) · چاپگرِ فیک DLE EOT واقعی
  جواب می‌دهد (12/72) و فرمورِ کاغذِ تمام (0x72).
- دروازه‌ها: tsc×3 = ۰ · biome web = **۵۹۲/۱۰/۷** (بیس‌اینِ ۵۹۳ — یک خطای
  کمتر؛ فایل‌های جدید صفر) · پنل lint = ۰.

### ۶) راه‌اندازی در رستوران (بدونِ هیچ نصبِ اضافه)

1. جای‌گذاری فایل‌ها → از ریشهٔ پروژه: `bun --cwd apps/api run db:migrate` (۰۰۱۵)
2. `docker compose up -d --build api web` (+ اختیاری:
   `PRINT_SCAN_CIDRS=192.168.1.0/24` در `.env`)
3. پنل سفارشات → مودالِ چاپ → «مدیریت چاپگرهای شبکه» → اسکن یا ورودِ
   دستیِ IP (از صفحهٔ تستِ خودِ چاپگر — دکمهٔ FEED) → «تست» → تخصیص به
   فاکتورِ فروش/آشپزخانه → چاپ: بی‌دیالوگ، فارسیِ کامل، طول = محتوا.
4. چاپگر باید **در شبکه** باشد (LAN/WiFi با IP ثابت). چاپگرِ USBِ وصل به
   کامپیوترِ صندوق از سرور قابلِ دسترسی نیست (مرزِ فیزیکی) — همان
   «دیالوگ مرورگر» پشتیبانش است؛ آداپتورِ USB-to-LAN (~چند دلار) یا مدلِ
   شبکهٔ همان چاپگر مسئله را کامل می‌کند.
5. پورتِ 9100 احرازِ هویت ندارد — فقط LAN؛ در فایروال به بیرون باز نکنید.

### فایل‌ها (۱۸: ۷ جدید + ۱۱ جایگزینی)

- **جدید**: `infra/db/schema/print.ts` · `drizzle/0015_amusing_ben_parker.sql`
  (+meta) · `domain/print/escpos.ts` · `domain/print/print.service.ts` ·
  `http/routes/print.routes.ts` · `scripts/test-print-service.ts` ·
  `web/src/lib/receiptCanvas.ts` · `web/.../PrinterManager.tsx` (۸)
- **بک**: `schema/settings.ts` (+کلید) · `schema/index.ts` · `app.ts` ·
  `index.ts` · `test-migrations.ts` · `package.json` (db:test:print)
- **مشترک**: `packages/shared/src/contracts.ts` (۳ DTO)
- **فرانت**: `InvoicePrintCenterModal.tsx` (نسخهٔ ۳) · `invoicePrint.ts` ·
  `server/admin.ts` · `queryKeys.ts` · `queryOptions.ts`
- **دیپلوی**: `docker-compose.yml` · `apps/api/.env.example` (PRINT_SCAN_CIDRS)

---

## ۲-۱۰-۱۹ — stage-89: سخت‌سازیِ پل چاپ — پاسخِ بند‌به‌بند به بازبینیِ استیج-۸۸ (P1..P5 + مجوز + تستِ canvas)

> بازبینیِ کارفرما: پنج ایراد به‌ترتیبِ اولویت (P1 معماریِ شبکه/VPS ·
> P2 محدودسازیِ مقاصد · P3 محاسبهٔ CIDR · P4 پورت ۶۳۱ · P5 وضعیتِ
> آفلاینِ سبزنما) + دو تذکر (مجوزِ اختصاصیِ ادمین۲ برای تخصیص/چاپ ·
> تستِ مستقیمِ `receiptCanvas.ts`).

### ۰) P1 — «مسیرِ واقعیِ شبکه» شفاف شد (معماری، نه حدس)

حقیقتِ فیزیکی: چاپِ مستقیم یعنی «همین API» به سوکتِ 9100 چاپگر وصل
می‌شود. اگر API روی VPSِ بیرون از شبکهٔ رستوران باشد، IP خصوصیِ چاپگر
(مثل 192.168.1.50) **بدونِ مسیر/تونل از اینجا قابلِ دسترسی نیست** و
تنظیمِ `PRINT_SCAN_CIDRS` به‌تنهایی مسیر نمی‌سازد (NATِ داکر هم که
مسیرِ شبکه‌ای به LANِ جداگانهٔ رستوران نمی‌سازد). کد نمی‌تواند فیزیک را
حل کند — ولی می‌تواند **راستش را بگوید**، و همین حالا می‌گوید:

- **`networkReport()`** (سرویس + `GET /admin/print/network` — فقط ادمینِ
  اصلی): کارت‌های شبکهٔ واقعیِ سرور **با ماسکِ واقعیِ کارت**، جایِ IPِ
  هر چاپگر نسبت به آن‌ها (`inServerSubnet`)، حالتِ استقرار
  (`lan`/`remote`/`empty`) و راهنمایِ فارسیِ صریح.
- **پنل**: باکسِ «شبکهٔ سرور و مسیر چاپگرها» بالای بخشِ مدیریتِ چاپگرها —
  چیپِ حالت (سبز/کهربایی/خاکستری) + کارت‌ها + جایِ هر چاپگر + راهنما؛
  و پیش‌فرضِ هوشمندِ بازهٔ اسکن = زیرشبکهٔ واقعیِ خودِ سرور.
- **خطاها صادقانه**: چاپ/تست به IP خصوصیِ بیرونِ زیرشبکه‌های سرور که
  شکست بخورد، خودِ خطا می‌گوید «اگر API روی سرورِ ابری/VPS است، بدونِ
  تونل/VPN به LAN رستوران نمی‌رسد».
- **راه‌حل‌های استقرار (مستند در compose و .env.example)**: (۱) اجرای API
  داخلِ رستوران (مینیسِرور/همان سیستمِ صندوق) — توصیه‌شده برای چاپِ
  مستقیم؛ (۲) تونلِ site-to-site (WireGuard) بینِ سرور و روترِ رستوران؛
  (۳) چاپ با «دیالوگِ مرورگر» — پشتیبانِ همیشگی، هرگز نمی‌میرد.

### ۱) P2 — سیاستِ «مقصدهای مجاز» (ضدِ SSRF از نشستِ ادمین)

فایلِ جدیدِ `domain/print/printNet.ts` = منبعِ واحدِ حقیقت (توابعِ خالص
و تست‌پذیر):

- **دسته‌بندیِ IP**: `loopback`(127/8) · `linklocal`(169.254/16 — شاملِ
  سرویس‌های metadata ابر) · `privatelan`(10/8، 172.16/12، 192.168/16) ·
  `cgnat`(100.64/10) · `multicast` · `broadcast` · `public`.
- **سیاست**: مقصدِ چاپ فقط شبکهٔ خصوصیِ رستوران است. آدرسِ عمومی،
  link-local/metadata، CGNAT، multicast و broadcast با **پیامِ فارسیِ
  علت‌دار** رد می‌شوند؛ loopback فقط با پرچمِ dev
  (`PRINT_ALLOW_LOOPBACK=1`) — در تولید بسته.
- **hostname**: پیش از هر اتصال resolve می‌شود («IP نهایی» بررسی
  می‌شود — همهٔ نشانی‌های حل‌شده باید مجاز باشند) و اتصال به همان IP
  **پین** می‌شود (ضدِ DNS-rebind). ثبت چاپگر با نامِ حل‌نشدنی رد می‌شود
  («IP چاپگر را مستقیم وارد کنید»).
- **پورت**: فقط `9100` (تنها انتقالِ پیاده‌شده: RAW/JetDirect) — در
  ثبت/ویرایش/چاپ/تست. `PRINT_ALLOW_ANY_PORT=1` فقط dev/test.
- **dispatch/test دوباره سیاست‌گذاری می‌کنند** (ردیفِ کهنه/DNSِ تغییرکرده
  هم دیوارِ پشتش بسته است) و probe مقصدِ مسدود را **بدونِ باز‌کردنِ
  سوکت** آفلاین برمی‌گرداند.
- **اسکن**: بازهٔ صریح هم باید شبکهٔ خصوصی باشد؛ metadata/عمومی/CGNAT با
  علت رد؛ `PRINT_SCAN_CIDRS`ِ غیرمجاز = خطای صریح.

### ۲) P3 — محاسبهٔ CIDR درست شد (ریاضیاتِ کاملِ ۳۲ بیتی)

- **باگ**: `cidrHosts` قدیمی فقط سه اکتتِ اول را می‌دید —
  `192.168.1.128/25` عملاً `192.168.1.0/25` را اسکن می‌کرد و اکتتِ چهارم
  اصلاً اعتبارسنجی نمی‌شد.
- **اصلاح**: `cidrParse` همهٔ ۴ اکتت + پیشوند را اعتبارسنجی و
  network/broadcast را با ماسکِ کاملِ ۳۲ بیتی می‌سازد؛ میزبان‌ها =
  `network+1 .. broadcast-1`. تستِ رگرسیون: `192.168.1.128/25 →
  129..254` (نیمهٔ بالایی).
- **پیش‌فرضِ اسکن**: فقط کارت‌های خصوصیِ شبکه؛ بازه‌های /23 تا /30 با
  ماسک واقعی اسکن می‌شوند و بازه‌های بزرگ‌تر به /24 محلِ IP کارت محدود
  می‌شوند تا شبکه‌های Docker/VPN از سقف میزبان عبور نکنند. گزارش توپولوژی
  همچنان ماسک واقعی را نشان می‌دهد. کارت‌های internal، عمومی و /31-/32
  اسکن نمی‌شوند. مقدار صریح `PRINT_SCAN_CIDRS` باید کامل در محدودهٔ مجاز
  و سقف ۵۱۲ میزبان باشد؛ بازهٔ نامعتبر به‌صورت جزئی اسکن نمی‌شود.

### ۳) P4 — اسکن فقط پورتِ 9100

تنها انتقالِ پیاده‌شده RAW/JetDirect است؛ پورتِ 631 یعنی IPP و «باز
بودنش» به معنیِ پذیرشِ ESC/POS خام نیست — حذف شد. تستِ میدانی:
listener فیکِ 631 در کنارِ چاپگرِ واقعیِ فیک؛ اسکن **فقط 9100 را
برمی‌گرداند** و decoy پیدا نمی‌شود.

### ۴) P5 — «سبزِ دروغین» ممنوع (وضعیت = TCP «و» بیتِ دستگاه)

- `combinedStatus` = اتصالِ TCP برقرار **و** بیتِ آفلاینِ خودِ دستگاه
  (DLE EOT 1) صفر. سوکتِ باز + خود‌گزارشِ آفلاین ⇒ نمایشِ **آفلاین** با
  علتِ فارسی («درِ باز / صف پارچه / خط»).
- `dispatch` و `test` هر دو پیش‌پروا می‌کنند: کاغذ تمام و
  **دستگاهِ خود-آفلاین** ⇒ خطای صریح **قبل از ارسال** (رستر روی سیم
  نمی‌رود).
- جزئیاتِ وضعیت روی ستونِ `last_status_detail` (140 حرف) ذخیره می‌شود —
  با برشِ امن که هرگز لیست را نمی‌شکند.

### ۵) مجوزِ اختصاصیِ «printingManage» (ادمین۲)

تخصیصِ سراسریِ چاپگرها و ارسالِ کارِ چاپ، کنشِ جهانی‌اند نه عملیاتِ
روزمرهٔ سفارش — از الگویِ استیج-۸۴ (`canAnnounceBusy`):

- ستونِ `admin2_profiles.printing_manage` (مایگریشن ۰۰۱۶، پیش‌فرض
  **false**) + کلیدِ `printingManage` در `SubAdminPermissionsDto` +
  `ALL_ADMIN2_PERMISSIONS` (ادمینِ اصلی همیشه دارد) + `DEFAULT_…`
  (پیش‌فرضِ افزودن: خاموش — فقط با مجوزِ صریح).
- روت‌ها: خواندنِ لیست/وضعیت/تخصیص = هر دو ادمین (مودال لازم دارد)؛
  **POST /assignment** و **POST /receipt** =
  `requireAdmin2Permission('printingManage')`؛ CRUD/تست/اسکن/گزارشِ
  شبکه = فقط ادمینِ اصلی (کماکان).
- پنل: سلکتِ چاپگر برای ادمین۲ بدونِ مجوز **قفل با توضیح** + چاپِ
  مستقیم به دیالوگِ مرورگر می‌افتد (خطا نمی‌دهد)؛ ویرایشگرِ دسترسی‌ها
  کلیدِ «چاپ مستقیم فاکتور و تخصیص چاپگر شبکه» را گرفت.

### ۶) تستِ مستقیمِ `receiptCanvas.ts` — `bun run test:receipt-canvas` (۲۳ بند)

بازخوردِ کارفرما: تستِ سرویسِ سمتِ سرور، «صحتِ بصری» را اثبات نمی‌کند.
تستِ جدید روی **Skia** (@napi-rs/canvas — همان چیدمانِ HarfBuzzِ مرورگر)
با **فونت‌های خودِ محصول** (Dana/Morabba از `public/fonts`) اجرا می‌شود
(devDependencies: @napi-rs/canvas + @resvg/resvg-js + jsqr — فقط تست):

- **رسیدهای فارسیِ واقعی** (فروش با ۷ ریزِ مبلغ + متا + نکته · آشپزخانه
  با جدولِ درشت) در **هر سه عرضِ کاغذ** (۵۷۶/۳۸۴/۴۲۰).
- **اتصالِ حروف**: «سلام» (45px) باید از «س ل ا م» (82px) باریک‌تر باشد —
  اثباتِ HarfBuzz.
- **قرارداد 1bpp بایت‌به‌بایت**: هر ۸۴۲,۶۸۸ پیکسلِ یک رسید با canvas
  مقایسه می‌شود (bit=1 ⇔ lum<128، MSB-first) + بیت‌های پدینگِ کاغذِ ۴۲۰
  صفر.
- **QR**: با مولدِ خودِ محصول (qrcode.react) ساخته و با **jsQR** در هر
  سه عرض دوباره خوانده می‌شود — همان چیزی که گوشیِ پیک می‌بیند.
- **طول = محتوا**: ۱ قلم=۱۰۳۴ < ۱۲ قلم=۱۴۶۳ < ۴۰ قلم=۲۵۵۵ dot با رشدِ
  خطی (×۲.۵۵)؛ نامِ طولانیِ ۹۰-حرفی شکسته و کلیپ می‌شود (لبهٔ فیزیکی
  پاک)؛ رسیدِ عجیب = خطای صریحِ ۴۰۰۰.
- **صفِ تک‌به‌تک**: دو رندرِ هم‌زمان مستقل می‌مانند.

### ۷) تست‌ها (جمعاً ۱۱۸+ بندِ سبز در این استیج)

- `test-print-service.ts` (بازنویسی، **۴۵ بند**): بخشِ خالصِ printNet
  (CIDR/دسته‌بندی/سیاست) + چاپگرِ فیکِ ESC/POS با حالتِ
  **خود-آفلاین** (0x1a) + decoy فیکِ 631 + hint مقصدِ دور + گزارشِ
  توپولوژی + «حالتِ تولید» (بدونِ پرچم‌ها: loopback بسته).
- `test-migrations.ts`: زنجیرهٔ ۰۰۱۶ + ستونِ printing_manage با
  پیش‌فرض false + rewind (۷۳/۰).
- رگرسیونِ PG: blocks ۸۲ · device ۵۱ · intel ۲۸ · coupon ۳۰ ·
  payment-safety ۲۴ · order ۱۶ · purchase ۷ · menu ۹ · permit — همه سبز.
- تست‌های خودِ کارفرما (۸۷: print-agent/print-document) هم سبز ماندند.

### ۸) اعمال (Apply)

1. مایگریشن از ریشهٔ پروژه: `bun --cwd apps/api run db:migrate` (۰۰۱۶ — فقط `ALTER TABLE
   admin2_profiles ADD COLUMN printing_manage boolean NOT NULL DEFAULT
   false`؛ بی‌خطر، بدونِ تغییرِ مخرب).
2. تست‌ها: `db:test:print` + `db:test:migrations` + (وب)
   `bun run test:receipt-canvas` — در سندباکس/تولید `PRINT_ALLOW_LOOPBACK`
   را روشن نکنید.
3. دیپلوی: `docker compose up -d --build api web`.
4. برای ادمین‌های سطح-۲ که باید چاپِ مستقیم/تخصیص بگیرند: پنل ادمین →
   ادمین‌های سطح ۲ → «چاپ مستقیم فاکتور و تخصیص چاپگر شبکه» را روشن کنید
   (پیش‌فرض خاموش).

### فایل‌ها (۲۳: ۴ جدید + ۱۹ جایگزینی)

- **جدید**: `apps/api/src/domain/print/printNet.ts` ·
  `apps/api/drizzle/0016_icy_purifiers.sql` (+meta) ·
  `apps/web/scripts/test-receipt-canvas.ts` · (+) در بسته نیست ولی
  devDeps: @napi-rs/canvas · @resvg/resvg-js · jsqr
- **بک**: `print.service.ts` (P1..P5) · `print.routes.ts` (مجوز + روتِ
  network) · `admin2.service.ts` · `admin2.routes.ts` · `schema/admin2.ts`
  · `test-print-service.ts` · `test-migrations.ts`
- **مشترک**: `contracts.ts` (printingManage + PrinterNetworkReportDto)
- **فرانت**: `InvoicePrintCenterModal.tsx` (قفلِ مجوز) ·
  `PrinterManager.tsx` (باکسِ شبکه) · `PermissionsEditor.tsx` ·
  `usePermissions.ts` · `server/admin.ts` (+گزارشِ شبکه) ·
  `queryKeys.ts` · `queryOptions.ts` · `package.json` (اسکریپتِ تست)
- **دیپلوی/مستند**: `docker-compose.yml` · `apps/api/.env.example`
  (معماری + سیاست + پرچم‌های dev)

---

## ۲-۱۰-۲۰ — stage-91: شمارهٔ کاملِ مشتری در فاکتور چاپی + یادداشت‌های دیپلوی (پس از کامیت ninety کارفرما)

> زمینه: استیج-۸۹ توسط کارفرما با کامیتِ «stage eighty-nine» ثبت شد و سپس
> اصلاحاتِ خودش با کامیتِ «ninety» وارد شد. بازبینیِ کاملِ ninety انجام شد
> (پایین) و دو خواستهٔ جدید اجرا شد: (۱) شمارهٔ «کاملِ» مشتری در فاکتورهای
> چاپی (شماره با `***` ماسک می‌شد) و (۲) یادداشت‌های دیپلویِ مجدد با
> توجه به تغییرِ `docker-compose.yml`.

### ۰) بازبینیِ کامیت ninety — جمع‌بندیِ اصلاحاتِ کارفرما (همگی درست و سبز)

- `printTransport.ts` (فایل جدید) — `sendRaw` از `print.service` جدا شد:
  تخریبِ سوکتِ زیرِ فشارِ write ممنوع شد (رسیدِ ارسال‌نشده دور ریخته
  می‌شد)؛ پنجرهٔ جمعِ پاسخ ثابت و محدود (چاپگرهای status-خون هم درخشان
  را نگه نمی‌دارند)؛ بافرِ پاسخ محدود به ۲۵۶ بایت؛ «close قبل از write»
  = آفلاین (قبلاً سبزِ دروغین).
- `escpos.ts` — LF بینِ قطعه‌های GS v 0 حذف شد: GS v 0 خودش دقیقاً به
  اندازهٔ h dot جلو می‌برد؛ LF بینِ قطعه‌ها یک خطِ خالیِ متنی وسطِ
  فیشِ یکپارچه تزریق می‌کرد.
- `receiptCanvas.ts` — SVGِ QR بدونِ xmlns در Image لود نمی‌شد: namespace
  تزریق می‌شود و شکستِ رندرِ QR حالا خطا می‌دهد (مربعِ خالی هرگز
  «QR چاپ‌شده» گزارش نمی‌شود)؛ توکن‌های بی‌فاصله (شماره/مبلغ/نامِ
  طولانی) کاراکتر‌به‌کاراکتر می‌شکنند (انتهای توکن کلیپ نمی‌شود)؛
  تایمرِ race فونت cleanup شد.
- `print.service.ts` — probe فقط 9100؛ پاسخِ تک‌بایتی DLE معتبر؛ درجِ
  چاپگر race-free شد (`onConflictDoNothing` روی unique(host,port))؛
  ویرایش، نقضِ یکتایی را به خطای فارسی می‌برد؛ کارت‌های /16+/8 داکر در
  اسکنِ پیش‌فرض به /24 خودِ IP کارت محدود شد؛ میزبان‌های CIDRها
  یکتا شدند.
- `payment.service.ts` — رِتریِ پرداخت دیگر جلسهٔ نامشخصِ درگاه را دور
  نمی‌زند: بازگشت به همان URL جلسهٔ موجود (`resumeExisting`)، بازنشسته‌شدنِ
  تلاش‌های دیگرِ امنِ اثبات‌شده زیرِ همان قفل‌های تسویه؛ چند جلسهٔ
  نامحلول = 409 صریح.
- تست‌های جدید: `test-print-transport.ts` (۲۳۶ خط) ·
  `test-invoice-print-center.tsx` · `test-payment-retry-client.tsx` ·
  توسعهٔ `test-receipt-canvas.ts` — همه در دروازه‌ها سبز.

### ۱) شمارهٔ کاملِ مشتری در فاکتور چاپی (حذفِ ماسکِ stage-55 از `invoiceForStaff`)

- **علتِ `***`**: `maskPhone()` (stage-55) در `order.service.ts ::
  invoiceForStaff` شمارهٔ خریدار را همیشه به `0912***456` ماسک می‌کرد —
  فاکتور چاپی (اشپزخانه/فروش/رسید ۸۰mm) همان مقدار را می‌گرفت.
- **اصلاح** (۲ خط): `userPhone: buyerPhone ?? null` — شمارهٔ کامل روی
  سندِ عملیاتیِ چاپی؛ importِ `maskPhone` از فایل حذف شد.
- **چرا درست است**: فاکتور سندِ عملیاتیِ آشپزخانه/پیک است — باید بتوانند
  به مشتری زنگ بزنند. سیاستِ stage-55 برای «لیست‌ها» (نمای زنده/آمار/
  جست‌وجوی ادمین۲: `live.service.ts` و `admin.service.ts` با opts)
  دست‌نخورده ماند — شماره در نمای ادمین۲ همچنان ماسک است.
- **تستِ رگرسیون**: `test-order-safety.ts` — بندِ جدید «printed staff
  invoice carries the full customer phone number (stage-91)»: شمارهٔ
  فاکتور == شمارهٔ کاملِ خریدار و بدونِ `*`.
- هر دو مسیرِ چاپ پوشیده شد: چاپ مستقیم (canvas → GS v 0) و دیالوگِ
  مرورگر — هر دو از همان `invoiceForStaff` تغذیه می‌کنند
  (`invoicePrint.ts`: `موبایل: ${inv.userPhone}` در meta هر دو فاکتور).

### ۲) یادداشت‌های دیپلویِ مجدد (سرورِ تولید — `/opt/sinshin-food-delivery`)

جریانِ موجودِ شما درست است و همین بماند؛ فقط نکته‌ها:

```bash
cd /opt/sinshin-food-delivery
git pull origin main
docker compose build migrate api web
docker compose run --rm migrate     # مایگریشن 0016 (printing_manage) + زنجیره
docker compose up -d --no-deps api web
```

1. **`docker-compose.yml` تغییر کرده اما فقط کامنت/مستند است** (بخشِ
   stage-89 دربارهٔ معماریِ چاپ و پرچم‌های dev). سرویس/پورت/حجم/متغیرِ
   جدیدی اضافه نشده ⇒ نیازی به `down`/بازسازیِ کل استک نیست؛ همان
   `up -d --no-deps api web` کافی است (compose در صورت تغییرِ کانفیگِ
   مؤثر خودش کانتینر را بازسازی می‌کند).
2. **مایگریشن 0016** (`admin2_profiles.printing_manage`) فقط یک
   `ALTER TABLE ... ADD COLUMN` است — سریع و بی‌خطر؛ همان
   `docker compose run --rm migrate` اجرایش می‌کند. (اگر قبلاً استیج-۸۹
   را روی سرور اعمال کرده‌اید، این مرحله از قبل انجام شده است.)
3. **بسته‌های جدید** (bun.lock): فقط devDepsِ تستِ canvas وب
   (@napi-rs/canvas · @resvg/resvg-js · jsqr) و اسکریپت‌های تست —
   rebuildِ `api` و `web` همان کار را می‌کند؛ چیزی در زمانِ اجرا اضافه
   نشده.
4. **پس از up**: برای ادمین‌های سطح-۲ که باید چاپ مستقیم/تخصیصِ چاپگر
   داشته باشند، از پنلِ ادمین → ادمین‌های سطح ۲، مجوزِ «چاپ مستقیم
   فاکتور و تخصیص چاپگر شبکه» را روشن کنید (پیش‌فرضِ امن: خاموش).
5. **`.env` (اختیاری)**: برای «اسکنِ خودکار» چاپگرهای LAN رستوران:
   `PRINT_SCAN_CIDRS=192.168.1.0/24` (جدا با کاما؛ تا ۴ بازه؛ فقط
   شبکهٔ خصوصی RFC1919). چاپ به هر IPِ خصوصی مستقل از این متغیر کار
   می‌کند — این فقط کشفِ خودکار را هدایت می‌کند.
6. **در تولید روشن نکنید**: `PRINT_ALLOW_LOOPBACK=1` ·
   `PRINT_ALLOW_ANY_PORT=1` — فقط توسعه/تست (در compose کامنت‌اند).
7. **توپولوژی**: چاپِ مستقیم یعنی «کانتینرِ api» به 9100 چاپگر وصل
   می‌شود — سرور باید داخلِ شبکهٔ رستوران باشد (یا تونل WireGuard)؛
   روی VPSِ ابریِ بیرون، فاکتور با «دیالوگِ مرورگر» چاپ می‌شود
   (پشتیبانِ همیشگی). گزارشِ زنده: پنل سفارشات → مودال چاپ →
   مدیریتِ چاپگرها → «شبکهٔ سرور و مسیر چاپگرها».
8. **راستی‌آزمایی پس از استقرار**: `docker compose logs -f api` (بدونِ
   خطای مایگریشن) · بازِ یکِ سفارش → چاپ فاکتور → شمارهٔ مشتری باید
   «کامل» باشد (این استیج) · اگر چاپگر شبکه دارید: دکمهٔ «تست چاپ».

### فایل‌ها (۲)

- **بک**: `apps/api/src/domain/order/order.service.ts`
  (شمارهٔ کامل + حذفِ importِ ماسک) ·
  `apps/api/scripts/test-order-safety.ts` (بندِ رگرسیونِ جدید)
- این استیج مایگریشن/قرارداد جدید ندارد؛ تغییرِ deploy فقط از میراثِ
  ۸۹/ناینتی است (بالا).

## ۲-۱۰-۲۱ — stage-92: دیپ‌لینک‌های واقعیِ نشان در بلوک موقعیت + انتخاب نقطه روی نقشه (ادمین)

> زمینه: کارفرما گزارش کرد: «در بلوک‌بندیِ مقالات، دکمهٔ «مشاهده روی
> نقشه» فقط نشان را باز می‌کند — مختصاتِ انتخابی روی نقشهٔ نشان باز
> نمی‌شود. این را درست کن؛ بعد مسیرِ موقعیتِ کنونی تا نقطهٔ انتخابی باید
> در نشان نشان داده شود. ادمین هم موقعِ اضافه/ویرایش باید بتواند نقطه را
> روی نقشه انتخاب کند، نه اینکه دستی طول/عرض جغرافیایی بنویسد.»

### ۰) تحقیقِ تجربی — دیپ‌لینک‌های وب‌اپِ نشان (neshan.org/maps)

> روشِ راستی‌آزمایی: نشست‌های تازهٔ مرورگر + «صحت‌سنجیِ زمینی» — راست‌کلیک
> روی نقشه → «مسیریابی به اینجا/از اینجا» مختصاتِ نقطهٔ کلیک‌شده را در URL
> رمزگذاری می‌کند (نمونه: `destination/37.482200,49.441800`)؛ با این ترفند
> مرکزِ واقعیِ نقشه بعد از باز شدنِ هر URL خوانده شد — نه حدسِ VLM از
> اسکرین‌شات (که دو بار گمراه کرد).

| فرمت | نتیجه |
|---|---|
| `/maps/@{lat},{lng},{zoom}z` | ✅ کار می‌کند — نقشه در «مرکزِ نقطه» باز می‌شود (دسکتاپ + وبِ موبایل). زوم نادیده گرفته می‌شود؛ خودِ اپ مدیریتش می‌کند. |
| `/maps#c{lat}-{lng}-{zoom}z` | ❌ در «بارگذاریِ تازه» کاملاً نادیده گرفته می‌شود (فقط حالتِ SPA-درونی است؛ اپ خودش می‌نویسدش اما نمی‌خواندش). **هرگز استفاده نشود.** |
| `/maps/routing/car/destination/{lat},{lng}` | ✅ پینِ قرمزِ مقصد دقیقاً روی نقطه + خط مسیر از «موقعیتِ کنونیِ» کاربر (خودِ نشان مبدأ را از موقعیت مرورگر/گوشی می‌گیرد) + پنل مسیریابی. همان چیزی که منوی راست‌کلیکِ خودِ نشان با «مسیریابی به اینجا» می‌سازد. |
| `/maps/routing/car/origin/{oLat},{oLng}/destination/{lat},{lng}` | ✅ همان مسیریابی با مبدأِ صریح (آزموده شد؛ برای مبدأ=موقعیتِ کاربر لازم نیست). |

- نکتهٔ دقت: هشِ `#c…` با عرضِ جغرافیاییِ منفی هم نمی‌خواند (خط‌تیرهٔ
  جداکننده است) — برای ایران بی‌اثر (همه مثبت‌اند) اما دلیلِ دیگری برای
  نکردنِ هش. گرد‌کردن ۶رقمی (مثل نرمالایزرِ API) در هر دو فرمتِ مسیر و
  نما آزادانه پذیرفته می‌شود.
- درسِ ثبت‌شده: شکافِ «فرمتِ کار می‌کند در دسکتاپ» ≠ «تجربهٔ کاربر»:
  نما بدونِ پین در زومِ شهری، «وسطِ هیچ» به نظر می‌رسد — ریشهٔ واقعیِ
  گزارشِ کارفرما همین بود؛ جواب = پینِ مسیریابی + انتخابگرِ نقشه.

### ۱) صفحهٔ مقاله (سمت سایت) — دو دکمهٔ راستی‌آزمایی‌شده

- فایل: `ArticleBlocksRenderer.tsx` (بلوک location) + `fa/ar.ts`
  (کلیدِ جدید `article.routeMap`).
- «مشاهده روی نقشه» (همان برچسبِ قبلی) → `neshanViewUrl` =
  `@{lat},{lng},15z` — باز شدنِ نقشه روی نقطه (فرمتِ تصدیق‌شده؛ حالتِ
  مشترک با `utils/neshanLinks.ts`).
- **«مسیریابی از موقعیت من»** (جدید، دکمهٔ پررنگ primary) →
  `neshanRouteUrl` = `routing/car/destination/{lat},{lng}` — پین روی
  نقطهٔ انتخابی + مسیرِ موقعیت کنونی تا آنجا، دقیقاً خواستهٔ کارفرما.
- بلوکِ نامعتبر (مختصاتِ خارج از محدوده) همچنان از رندر حذف می‌شود
  (`isRenderableBlock`); دو دکمه فقط با مختصاتِ معتبر رندر می‌شوند.

### ۲) صفحه‌ساز ادمین — انتخابِ نقطه با کلیک، نه تایپِ دستی (ریشه‌ی باگ)

- فایل جدید `LocationPickerField.tsx` — تاشو: دکمهٔ «انتخاب روی نقشه» +
  چیپِ مختصات + دو لینکِ «تست» (همان دیپ‌لینک‌های نهایی، پیش‌نمایشِ
  همان چیزی که خواننده می‌بیند).
- بازِ شدن → `MapPicker` مشترکِ تسویه (همان SDK نشان/MapLibre): کلیک =
  جابه‌جایی پین + نوشتنِ lat/lng در بلوک + آدرسِ معکوس از API خودِ
  سرور (`/geo/reverse`؛ کلیدِ service هرگز واردِ باندلِ وب نمی‌شود).
- تاشو ماندن عمدی است: فقط بلوکِ در حالِ ویرایشِ موقعیت، WebGL می‌سازد
  (۲۰۰ بلوکِ موقعیتی = ۲۰۰ نقشه نمی‌شود).
- بدونِ `VITE_NESHAN_MAP_KEY`: همان سقوطِ نرمِ تسویه — فیلدهای دستیِ
  قبلی + هشدارِ راه‌اندازی (کلیدِ web از platform.neshan.org) رندر
  می‌شود.
- `ArticlePageBuilder.tsx` — فیلدهای عددیِ دستیِ lat/lng از `BlockFields`
  حذف و `LocationPickerField` نشست؛ `patchProps` همان UNDO/تاریخچه را
  می‌گیرد (واگردِ هر کلیکِ نقشه ممکن است).

### ۳) پیکِ اسکن — همان اصلاح در پیوندِ مقصد

- `ScanRouteMap.tsx` (شاخهٔ بدونِ کلیدِ نقشه): پیوندِ «مشاهده مقصد روی
  نقشه» به `neshanViewUrl` رفت و «مسیریابی تا مقصد در نشان ↗» (جدید)
  کنارش نشست — پیک با یک لمس، مسیرِ ناوبریِ گوشی را می‌گیرد.

### ۴) `utils/neshanLinks.ts` — منبعِ حقیقتِ واحد

- `neshanViewUrl(lat, lng, zoom=15)` · `neshanRouteUrl(lat, lng)` ·
  `isNeshanCoord(lat, lng)` — خالص، بدونِ وابستگی، گرد‌کردن ۶رقمی
  هم‌عرضِ نرمالایزرِ API. مقصدِ تحقیق (بالا) در سربرگِ فایل ثبت شده تا
  استیج‌های بعدی به هشِ `#c` (که در لودِ تازه کار نمی‌کند) برنگردند.

### ۵) تست‌ها

- `test-article-rendering.tsx`: رندرِ SSRِ بلوکِ موقعیت حالا هر دو
  دیپ‌لینکِ «دقیق» را می‌خواهد
  (`@37.000000,49.000000,15z` ·
  `routing/car/destination/37.000000,49.000000`) + شمارِ لینک‌های
  `neshan.org/maps` = ۲ (قبلاً ۱) — بلوکِ نامعتبر هنوز هیچ لینکی
  نمی‌سازد.
- `test-articles-admin.tsx`: ماکِ `MapPicker` (الگویِ `ImageField`) +
  رگرسیونِ stage-92: فیلدهای عددیِ دستی حذف شده‌اند ·
  `LocationPickerField` به مختصاتِ بلوک سیم‌کشی شده · دکمهٔ «انتخاب روی
  نقشه» · هر دو لینکِ تستِ نشان · باز‌کردنِ تاشو → `MapPicker` همان
  نقطه را می‌گیرد و `onChange({lat,lng})` مستقیماً بلوک را آپدیت
  می‌کند (کلیکِ نقشه → سند؛ عنوان بلوک دست‌نخورده).
- کلیدِ i18n در هر دو فرهنگ (fa: «مسیریابی از موقعیت من» · ar:
  «المسار من موقعي») — `Dict` از fa تایپ می‌شود، پس هر دو اجباری‌اند.

### ۶) دروازه‌ها

- tsc×3 (api/web/shared) = ۰ · biome web = **591/10/7 (دقیقاً بیس‌این —
  هر فایلِ دست‌خورده صفرِ تازه)** · `bun run test:articles` = ۴/۴ سبز
  (client · api-client · admin · rendering) — نکته: `test-articles-admin`
  بدونِ ماکِ جدید می‌شکست (واقعی i18n → `useRouter` می‌کشید؛ یعنی
  گرافِ import واقعاً تازه است، رگرسیونش معنادار).

### ۷) دیپلوی

- فقط `web` تغییر کرده: `docker compose build web` → `up -d --no-deps
  web`. مایگریشن/بک: هیچ.
- برای «انتخابِ نقطه روی نقشه» در ادمین و «نقشهٔ تعاملی» در مقاله،
  `VITE_NESHAN_MAP_KEY` باید در محیطِ build وب تنظیم باشد (کلیدِ web از
  platform.neshan.org؛ همان کلیدِ صفحهٔ تسویه). بدونِ آن: فیلدهای دستیِ
  قبلی + هشدار — دکمه‌های «مشاهده/مسیریابی» مستقل از کلید کار می‌کنند
  (پیوندِ بیرونی‌اند).
- راستی‌آزمایی پس از استقرار: مقاله‌ای با بلوک موقعیت → دکمهٔ «مشاهده
  روی نقشه» نشان باید روی مکان باز شود · «مسیریابی از موقعیت من» =
  پین + مسیر از موقعیتِ شما · در ادمین → بلوک موقعیت → «انتخاب روی
  نقشه» → کلیک → پین و مختصات جابه‌جا شوند.

### فایل‌ها (۱۰)

- **جدید (۲)**: `apps/web/src/utils/neshanLinks.ts` ·
  `apps/web/src/components/admin/articles/builder/LocationPickerField.tsx`
- **جایگزینی (۸)**: `ArticleBlocksRenderer.tsx` · `ArticlePageBuilder.tsx`
  · `ScanRouteMap.tsx` · `i18n/fa.ts` · `i18n/ar.ts` ·
  `scripts/test-article-rendering.tsx` · `scripts/test-articles-admin.tsx`
  · `docs/REFERENCE.md`

## ۲-۱۰-۲۲ — stage-98: «پنجرهٔ پرداخت» — انقضای قطعیِ ۱۰ دقیقه‌ایِ سفارش‌های در انتظار + صدرِ صفحهٔ ۱ در محصولاتِ ادمین + مسیریابیِ واقعیِ نشان با مبدأِ GPS

> زمینه: سه خواستهٔ صاحبِ کسب‌وکار: (۱) «سفارشات در انتظار زیر ۱۰ دقیقه
> حذف بشن» — سفارشِ رهاشده در PENDING_PAYMENT با مرجعِ فقط-توکن (ملتِ
> `:t:` / سپِ بدونِ RefNum) هرگز «شکستِ قطعی» نمی‌گیرد و تا ابد
> کوپن/گرنت/هولدِ کیف‌پول را قفل می‌کند؛ (۲) محصولِ ویرایش/تغییرِ
> وضعیت‌یافته باید فوراً «اولِ صفحهٔ ۱»ی لیستِ ادمین بیاید و پیش‌فرضِ
> صفحه هم ۱۰تایی شود؛ (۳) «مسیریابی از موقعیت من» در بلوک موقعیتِ مقاله
> باید GPS واقعی بخواند — «وقتی gps رد شد، مبدا توسط کاربر روی نقشه نشان
> انتخاب شود» (فالبکِ تأییدشده).

### ۱) پنجرهٔ پرداخت — بک‌اند (`PENDING_ORDER_EXPIRY_MINUTES`، پیش‌فرض ۱۰)

- env: `num('PENDING_ORDER_EXPIRY_MINUTES', 10)` + فیلدِ readonly در
  `AppConfig` (env.ts)؛ توکنِ بانک ۱۰–۱۵ دقیقه عمر دارد — پنجرهٔ ۱۰
  دقیقه‌ای یعنی انقضا هیچ‌وقت دنبالِ توکنِ زنده نمی‌دود. هر دو
  `.env.example` (ریزه + api) مستند شدند.
- `PaymentService.expirePendingOrders()` + `expireOnePendingOrder()`
  (خصوصی): جاروی دسته‌های ۵۰تاییِ سفارش‌هایِ `PENDING_PAYMENT`ِ بالایِ
  TTL. سنِ «سفارش» ملاک است نه سنِ ردیفِ پرداخت — رِتریِ تازه ردیفِ
  پرداخت را جوان می‌کند اما پنجرهٔ سفارش همان است.
- **قاعدهٔ استعلامِ زندهٔ تک‌بار**: انقضا فقط آخرین تلاشِ PENDING را یک
  بار استعلامِ زنده می‌کند:
  - «پرداخت‌شده» ⇒ `finalize(true)` → settle — پول گرفته شده و callback
    گم بود؛ سفارش باید زنده بماند.
  - نامشخص/قطعی-ناموفق ⇒ مرگِ توکنِ بانک «پرداخت‌نشده بودن» را اثبات
    کرده (خودِ بانک تکمیل را ناممکن کرده) ⇒ همان مسیرِ اتمیکِ تست‌شدهٔ
    `finalize(false)` → `failPayment`: CANCELED + FAILED + بازگشتِ دقیقِ
    هولدِ کیف‌پول + آزادسازیِ کوپن/گرنت + نوتیفِ صادقانه («⌛ پنجرهٔ
    پرداخت به پایان رسید … می‌توانید دوباره سفارش ثبت کنید.»، سورسِ
    نوتیف = `payment-expired`؛ مسیرِ شکستِ عادیِ درگاه متنِ قبلیِ خودش را
    دارد).
  - **خطای شبکه در استعلام ⇒ این دور معلق** — دقیقهٔ بعد دوباره؛ «سن
    به‌تنهایی پول را جابه‌جا نمی‌کند»، تصمیمِ مالی همچنان فقط از مسیرِ
    verify/finalize می‌گذرد.
- **خواهرهای PENDINGِ مانده** با `supersedePending(tx, p,
  'expiry-sibling')` بسته می‌شوند (پارامترِ source به `supersedePending`
  اضافه شد؛ پیش‌فرضِ `retry-superseded` دست‌نخورده) — جاروهایِ بعدی
  برایشان نویزِ R12 نمی‌سازند.
- **جاب**: `payment-timeout` حالا هر **۶۰ ثانیه** (قبلاً هر ۵ دقیقه)
  می‌دود و تورِ انقضا را «قبل از» `reconcilePending(30)` اجرا می‌کند —
  تورِ ۳۰ دقیقه‌ای/R12 بدونِ تغییر؛ دقتِ ~۱ دقیقه‌ای همان چیزی است که
  شمارش‌معکوسِ صفحهٔ سفارش به کاربر قول می‌دهد.
- **گیتِ رِتری**: `retryInitiation` برای سفارشِ بالایِ TTL همان انقضا را
  درجا اجرا می‌کند و **۴۰۹** جواب می‌دهد: اگر استعلام «پرداخت‌شده» گفت
  سفارش settle می‌شود («این سفارش هم‌اکنون پرداخت شد — وضعیت صفحه به‌روز
  می‌شود.») وگرنه «پنجرهٔ پرداخت این سفارش به پایان رسید و سفارش لغو شد —
  لطفاً دوباره سفارش ثبت کنید.» — کاربر دیگر به صفحهٔ مردهٔ بانک فرستاده
  نمی‌شود؛ مستندِ روت (payment.routes.ts) هم به‌روز شد.
- **هم‌ترازیِ چک‌اوت**: `CHECKOUT_REPLAY_GRACE_MS` از ۱۵ → **۱۰ دقیقه**
  (هم‌عرضِ پنجره) — replayِ کهنه هیچ‌وقت توکنِ بانک برای سفارشِ خارج از
  پنجره نمی‌گیرد.
- **R12 دست‌نخورده**: تورِ late-success (موفقیتِ دیرهنگامِ PSP بعد از
  انقضا/FAILED) همچنان آخرین تورِ اطمینان است — موفقیتِ دیرهنگامِ PSP
  بعد از انقضا به R12 می‌رود، نه دور ریخته می‌شود.

### ۲) DTO و نگاهِ مشتری/گزارش‌ها

- قرارداد: `UserOrder.pendingExpiresAt?` (contracts.ts) — فقط برای
  `PENDING_PAYMENT`: createdAt + TTL (mapOne در order.service.ts)؛ مبنای
  سرور است، نه ساعتِ دستگاهِ کاربر.
- `PendingPaymentBox`: شمارش‌معکوسِ m:ss با ارقامِ بومیِ زبانِ فعال
  (fa/ع) از `pendingExpiresAt`؛ زیرِ ۶۰ ثانیه قرمز؛ صفر ⇒ حالتِ انقضا —
  دکمه می‌رود و «سبد خرید شما محفوظ است — دوباره سفارش ثبت کنید» می‌آید
  (کلیدهایِ `pendingCountdown`/`expiredTitle`/`expiredHint` در fa+ar)؛
  جابِ انقضا حداکثر ~۶۰ ثانیه بعد سفارش را CANCELED می‌کند و
  پولینگِ ۳ثانیه‌ایِ خودِ صفحه باکس را برمی‌چیند. نبودِ
  `pendingExpiresAt` (استقرارِ مخلوطِ قدیم/جدید) ⇒ رفتارِ stage-58 —
  بدونِ شکستگی.
- **«حذف» از دیدِ مشتری**: سفارشِ هرگز-پرداخت‌نشده (CANCELED+FAILED) از
  هر سه نمایِ مشتری بیرون می‌ماند — `myOrders` (۲۰۰ سفارشِ آخر +
  فعال‌ها) · `myOrdersPage` (لیست + total) · `myOrdersLight` (۱۰تای
  پروفایل سبک)؛ بازپرداختِ واقعیِ ادمین (CANCELED+SUCCESS) می‌ماند؛
  ردیفِ ممیزی سرِ جایش است و لینکِ مستقیمِ جزئیات همچنان باز می‌شود
  (صادقانه: «لغو شد»).
- **آمار/گزارش‌ها هم‌تراز شدند**: totalOrders + چارتِ داشبورد + چارتِ
  کاربر (admin.service.ts) با `notInArray(status,
  ['CANCELED','PENDING_PAYMENT'])` · ordersCountِ users-report
  (report-query.service.ts) · ردیف‌هایِ CSVِ روزانه (report.service.ts)
  PENDING_PAYMENT را نمی‌آورند — لغو‌شده‌ها می‌مانند (بازپرداختِ واقعی +
  ردیفِ بازگشتِ کیف‌پولِ انقضا).

### ۳) لیستِ محصولاتِ ادمین — «آخرین تغییر، اولِ صف»

- `adminProducts` (menu.service.ts): `orderBy(desc(updatedAt),
  desc(createdAt))` — ویرایش/تغییرِ وضعیت/دسترس‌پذیری updated_at را تازه
  می‌کند ⇒ محصول فوراً صدرِ صفحهٔ ۱؛ created_at تای‌بریکرِ ردیف‌هایِ
  هم‌تاریخِ seed.
- **گریدِ عمومیِ سایت عمداً دست‌نخورده ماند** (`productsByMain`:
  created_at DESC) — لیستِ فروشگاه نباید با هر ویرایشِ ادمین بالا-پایین
  شود.
- وب: پیش‌فرضِ limit از ۵ → **۱۰** (`limitField(10)` در
  useAdminProductsPage — هم‌راستا با سفارشات/پیک‌های ادمین) +
  `pageSizeOptions [10,20,50]` در Pagination صفحهٔ محصولات.

### ۴) نشان — مسیریابی با مبدأِ واقعی (دیپ‌لینکِ رسمیِ nshn.ir)

- `neshanRouteFromUrl(oLat,oLng,dLat,dLng)` در `utils/neshanLinks.ts` =
  `https://nshn.ir?origin=…&destination=…&vehicle=d` — لینکِ رسمیِ
  هوشمند: اپِ نصب‌شدهٔ نشان را باز می‌کند وگرنه 301 به وبِ کاملِ
  neshan.org (راستی‌آزماییِ زندهٔ استیج-۹۷)؛ منبع: پلتفرمِ رسمیِ نشان —
  «مبدأ خودکار» در داکیومنت وجود ندارد، پس خودِ سایت باید GPS بخواند و
  مبدأ را صریح بگذارد.
- **بلوک موقعیتِ مقاله**: دکمهٔ «مشاهده روی نقشه» حذف شد (کلیدِ
  `article.viewMap` از fa+ar رفت — نقشهٔ داخلیِ بلوک همان نقش را دارد)؛
  «مسیریابی از موقعیت من» حالا یک دکمهٔ واقعی است
  (`ArticleRouteButton.tsx` جدید): `getCurrentPosition` (تایم‌اوت ۱۰s) ⇒
  لینکِ origin-bearing؛ ردِّ پرمیشن/تایم‌اوت/بی‌پشتیبانی/مختصاتِ خراب ⇒
  توستِ فارسی («دسترسی به موقعیت دریافت نشد — مبدأ را روی نقشهٔ نشان
  خودتان انتخاب کنید») + فالبکِ فقط-مقصد تا کاربر خودش مبدأ را روی
  نقشهٔ نشان بزند (تأییدِ صاحبِ کسب‌وکار)؛ `ArticleBlocksRenderer` از
  useI18n داخلی خالی شد (دکمه خودش i18n/toast را می‌خواند).
- **پیکِ اسکن** (`ScanRouteMap`): prop جدیدِ `courierPosition` از
  trackingِ خودِ صفحه — مبدأِ لینکِ مسیر = موقعیتِ زندهٔ پیک، فالبک =
  رستوران، نبودِ هیچ‌کدام ⇒ لینکِ فقط-مقصد؛ بدونِ پرمیشنِ جدیدِ GPS.
- **صفحهٔ سفارشِ مشتری** (`CourierTrackingMap`): لینکِ «مسیر تا مقصد» تا
  نخستین موقعیتِ server-fedِ پیک پنهان است (مسیرِ «مشتری تا خانهٔ خودش»
  بی‌معناست)؛ بعد از آن origin-bearing: پیک → آدرسِ مشتری.

### ۵) تست‌ها

- `test-payment-safety.ts`: **۶ سناریوی انقضایِ جدید** (سوئیت حالا **۴۲**
  بندِ سبز): جاروی انقضا (CANCELED + بازگشتِ دقیقِ هولد) · رِتریِ خارج
  از پنجره (۴۰۹ + انقضای درجا) · استعلامِ «پرداخت‌شده» ⇒ settle (نه
  انقضا) · سفارشِ داخلِ پنجره دست‌نخورده · خواهرها `expiry-sibling` ·
  قطعیِ شبکه در استعلام ⇒ تعویق به دورِ بعد (نه شکستِ کور).
- `test-payment-money-path.ts`: myOrdersPage لغویِ هرگز-پرداخت‌نشده را
  نمی‌شمارد (total ۴→۳)؛ ادعاهای پولی (totalSpent) دست‌نخورده ·
  `test-financial-reconcile.ts`: ردیفِ CSVِ PENDING_PAYMENT حذف شد
  (orders ۶→۵).
- `test-admin-products-order.ts` (جدید — PG واقعی): toggle/ویرایش ⇒
  «آخرین تغییر، اولِ صف»، صدرِ صفحهٔ ۱.
- `test-article-route.tsx` (جدید — وب): GPS موفق ⇒ لینکِ nshn.ir با
  origin؛ رد/تایم‌اوت/مختصاتِ خراب ⇒ توست + فالبکِ فقط-مقصد ·
  `test-article-rendering.tsx`: «مشاهده روی نقشه» حذف شد، دکمهٔ مسیریابی
  رندر می‌شود · `test-maps-client.tsx`: ScanRouteMap (بدونِ GPS ⇒ مبدأِ
  رستوران؛ با GPS ⇒ مبدأِ خودِ پیک) + CourierTrackingMap (پنهان تا
  نخستین موقعیت، بعدش origin-bearing).
- سیم‌کشی: `db:test:products-order` (apps/api/package.json) ·
  `test-article-route` دُمِ `test:articles` (apps/web/package.json).

### ۶) دروازه‌ها

- tsc×3 (api/web/shared) = **۰**
- biome web = **592/10/6 — دقیقاً Δ0 نسبت به بیسِ stage-96** (فایل‌های
  دست‌خورده صفرِ تازه؛ خطاهای باقی‌مانده در touched files همگی
  pre-existing)
- سوئیت‌های PG ای‌پی‌آی: **۲۱/۲۱ سبز** — شامل payment-safety **۴۲** (با
  ۶ سناریوی انقضا)
- وب: **۲۴/۲۴ اسکریپتِ test:\*** سبز (شامل articles با test-article-routeِ
  جدید و maps)

### ۷) دیپلوی

- **مایگریشن: هیچ** — `docker compose build api web` سپس
  `docker compose up -d --no-deps api web`.
- **env (اختیاری)**: `PENDING_ORDER_EXPIRY_MINUTES` — پیش‌فرض ۱۰؛ فقط
  اگر پنجرهٔ دیگری می‌خواهید تنظیمش کنید (هر دو .env.example مستند شد).
- **اولین جارو پس از استقرار**: تورِ انقضا همهٔ سفارش‌هایِ قدیمیِ
  گیرکرده در PENDING_PAYMENT را می‌بندد (همان استعلامِ زنده؛ در صورتِ
  لزوم لغو + آزادسازیِ رزروها) — **پاک‌سازیِ مورد انتظارِ انبارِ قدیمی**،
  نه خطا.
- راستی‌آزمایی پس از استقرار: ثبتِ سفارش تا درگاه ⇒ شمارش‌معکوس روی
  صفحهٔ سفارش و سرِ انتهای پنجره پیامِ «سبد خرید محفوظ است» · ادمین ⇒
  ویرایش/تغییرِ وضعیت یک محصول ⇒ صدرِ صفحهٔ ۱ · مقاله با بلوک موقعیت ⇒
  تک‌دکمهٔ GPS «مسیریابی از موقعیت من» · اسکنِ پیک (استریمِ روشن) ⇒
  لینکِ مسیرِ origin-bearing از موقعیتِ خودِ پیک.

### فایل‌ها (۳۴)

- **جدید (۳)**:
  `apps/web/src/components/site/articles/ArticleRouteButton.tsx` ·
  `apps/api/scripts/test-admin-products-order.ts` ·
  `apps/web/scripts/test-article-route.tsx`
- **بک (۹)**: `payment.service.ts` · `payment-timeout.job.ts` ·
  `infra/config/env.ts` · `payment.routes.ts` · `order.service.ts` ·
  `menu.service.ts` · `admin.service.ts` · `report.service.ts` ·
  `report-query.service.ts`
- **وب (۱۰)**: `PendingPaymentBox.tsx` · `CourierTrackingMap.tsx` ·
  `ScanRouteMap.tsx` · `ArticleBlocksRenderer.tsx` · `neshanLinks.ts` ·
  `useAdminProductsPage.ts` · `routes/admin/products/index.tsx` ·
  `routes/courier/scan/$orderId.tsx` · `i18n/fa.ts` · `i18n/ar.ts`
- **اشتراکی (۱)**: `packages/shared/src/contracts.ts`
- **تست‌ها (۵)**: `test-payment-safety.ts` · `test-payment-money-path.ts`
  · `test-financial-reconcile.ts` · `test-article-rendering.tsx` ·
  `test-maps-client.tsx`
- **کانفیگ (۴)**: `.env.example` · `apps/api/.env.example` ·
  `apps/api/package.json` · `apps/web/package.json`
- **مستندات (۲)**: `docs/pending-payment-retries.md` · `docs/REFERENCE.md`
