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
| `DEVICE_ENFORCEMENT` | 💡 | `on` | قید «یک دستگاه، یک ثبت‌نام» |
| `MAX_DEVICES_PER_USER` | 💡 | `5` | سقف دستگاه فعال هر کاربر |
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
| `PAYIR_API_KEY` | 💡 | خالی | کلید پنل پی‌ایر (`test` = درگاه آزمایشی) |
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
| پی‌ایر | `PAYIR_API_KEY` | کلید `test` | آدرس سایت را در پنل ثبت کن |
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