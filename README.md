# اجرا با Docker — راهنمای سین‌شین

> استک کامل با **docker compose** روی یک سرور لینوکسی شخصی — کالیبره برای
> ۴ هسته / ۸GB رم / ۴۰GB دیسک. مشکل واقعی داکر در ایران فقط **رجیستری Docker Hub**
> است — و با «میرور» حل می‌شود (بند ۲).

این سند: نصب ← میرور ← نام فایل‌ها ← متغیرهای محیطی (چک‌لیست) ← دامنه ←
اولین راه‌اندازی ← دستورات روزمره ← بکاپ ← رفع اشکال.

---

## ۱) نصب Docker (لینوکس — سرور تولید)

```bash
# نصب رسمی (Docker Engine + compose plugin):
curl -fsSL https://get.docker.com | sh

# اجرای خودکار بعد از ری‌استارت سرور:
sudo systemctl enable --now docker

# کاربر جاری به گروه docker (دیگر نیاز به sudo نداری):
sudo usermod -aG docker $USER
# خروج و ورود دوباره (یا: newgrp docker)

# راستی‌آزمایی:
docker version
docker compose version    # باید v2.x باشد (پلاگین، همراه نصب رسمی می‌آید)
```

---

## ۲) میرور Docker Hub — قلب کار

ایمیج‌هایی که این پروژه می‌کشد (با نام کوتاه در compose/Dockerfile‌ها — پیش‌فرض docker.io):

| ایمیج | چرا |
|---|---|
| `oven/bun:1.3.14-slim` | بیس هر دو Dockerfile (api و web) |
| `postgres:18.6-alpine` | دیتابیس + سرویس بکاپ |
| `redis:8-alpine` | کش/صف |
| `caddy:2.10-alpine` | لبه/TLS |

فایل آماده در ریپو هست: `deploy/daemon.json` — دو کار انجام می‌دهد:

1. **میرور**: همهٔ pull های docker.io (هم `docker pull`، هم `docker build` با درایور
   پیش‌فرض BuildKit) اول از `docker.mobinhost.com` می‌آیند؛ اگر میرور مرد، خود docker.io.
2. **چرخش لاگ**: هر کانتینر حداکثر ۳ فایل × ۱۰MB لاگ — لاگِ بی‌مرز، دیسک ۴۰GB را
   یک روز پر می‌کند و کل سرور را می‌خواباند. اینجا یک‌بار برای همیشه حل است.

```bash
sudo mkdir -p /etc/docker
sudo cp deploy/daemon.json /etc/docker/daemon.json
sudo systemctl restart docker

# راستی‌آزمایی میرور:
docker info 2>/dev/null | grep -A3 'Registry Mirrors'
#   Registry Mirrors:
#    https://docker.mobinhost.com

# تست pull واقعی از میرور:
docker pull redis:8-alpine
```

> **دو نکته دربارهٔ فرم فایل:**
> - در `registry-mirrors` آدرس با `https://` می‌آید، اما در `insecure-registries`
>   طبق استاندارد داکر **بدون scheme** نوشته می‌شود (`"docker.mobinhost.com"`) —
>   با scheme آن‌جا بی‌اثر می‌شود. اگر گواهی TLS میرور برایتان معتبر است و خطا
>   نمی‌گیرید، می‌توانید خط `insecure-registries` را کلاً حذف کنید.
> - میرورهای عمومی می‌آیند و می‌روند؛ اگر یک روز مرد، فقط همین یک فایل را عوض کن —
>   نه هیچ فایل دیگری از پروژه.

---

## ۳) نام فایل‌های compose

فایل تولیدی **`docker-compose.yml`** است — همان نامی که docker compose
«خودکار» پیدا می‌کند؛ پس برای تولید هیچ `-f`‌ای لازم نیست:

```bash
docker compose up -d --build        # تولید
```

فایل توسعه **`docker-compose.dev.yml`** است که همیشه `-f` می‌خواهد:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
```

> راند ۲۳: نام‌ها از `docker.compose.yml` (با نقطه) به `docker-compose.yml`
> (خط تیره) تغییر کرد — نام استاندارد. اگر هنوز نسخه‌ی قدیمی را داری،
> با `git mv` تغییر نام بده تا تاریخچه حفظ شود.

---

## ۴) متغیرهای محیطی — چک‌لیست کامل

### کدام فایل، کجا خوانده می‌شود؟

| فایل | کی می‌خواندش | کجا لازم است |
|---|---|---|
| **`.env` (ریشه)** | خود docker compose (سرویس‌های api ، migrate ، seed ، postgres ، backup) | **سرور تولید — تنها فایل مهم** |
| `apps/api/.env` | فقط وقتی API را با `bun` روی سیستم خودت اجرا کنی (بدون داکر) | ماشین توسعه |
| `apps/api/.env.local` | override همان حالت بدون داکر (فقط آدرس‌ها را عوض می‌کند) | ماشین توسعه |
| `apps/web/.env.local` | فقط برای کلید نقشه/آدرس API در حالت بدون داکر | ماشین توسعه |

> در کانتینر هیچ `.env` ای داخل ایمیج bake نمی‌شود (`.dockerignore` می‌بنددش) —
> همه‌چیز از `.env` ریشه از طریق compose می‌رسد.

### ۴-۱) متغیرهایی که خودت باید جور کنی (اجباری برای تولید)

| متغیر | چیست | چطور مقدار بدهم |
|---|---|---|
| `DOMAIN` | دامنهٔ سایت؛ Caddy با همین نام گواهی TLS می‌گیرد و `SITE_URL` از آن ساخته می‌شود | دامنهٔ ثبت‌شده‌ات، مثل `sinshin.ir` (بدون `https://`) |
| `ACME_EMAIL` | ایمیلی که Let's Encrypt هشدارهای گواهی را می‌فرستد | یک ایمیل واقعی |
| `POSTGRES_PASSWORD` | پسورد کاربر دیتابیس | `openssl rand -base64 24` |
| `DATABASE_URL` | رشتهٔ اتصال به دیتابیس — **باید همان پسورد بالا داخلش باشد** | `postgres://sinshin:<همان پسورد>@postgres:5432/sinshin` |
| `JWT_SECRET` | کلید امضای توکن‌های ورود — لو برود یعنی جعل نشست | `openssl rand -base64 48` (حداقل ۳۲ کاراکتر) |
| `SUPER_ADMIN_PHONES` | شماره‌هایی که با اولین ورود، نقش ابرمدیر می‌گیرند (با کاما جدا) | شمارهٔ واقعی خودت |
| `SMS_PROVIDER` | حالت ارسال پیامک — در تولید فقط `real` قبول است | دقیقاً `real` |
| `SMS_BASE_URL` | آدرس درگاه پیامک (قرارداد: `POST {آدرس}/send` با هدر `Authorization: Bearer` و بدنهٔ JSON `{from, to, text}`) | مثال: `https://api.yoursms.ir` — مطابق پنل پیامکت |
| `SMS_API_KEY` | کلید همان درگاه پیامک | از پنل پیامک |
| `SMS_SENDER` | شماره/خط ارسال‌کننده | از پنل پیامک |
| `GATEWAY_MODE` | فقط «درگاه واقعی فعال/غیرفعال» را تعیین می‌کند — انتخابِ درگاه در صفحه‌ی تسویه است | `direct` یا `indirect` (هر دو = فعال؛ `mock` = ممنوع در تولید) |
| `ZARINPAL_MERCHANT_ID` | کد پذیرندگی زرین‌پال (۳۶ کاراکتر UUID) — فقط اگر زرین‌پال ارائه می‌کنی | از پنل زرین‌پال |
| `PAYIR_API_KEY` | کلید پی‌ایر — فقط اگر پی‌ایر ارائه می‌کنی | از پنل پی‌ایر |
| `SEP_TERMINAL_ID` | کد ترمینال بانک سامان (سامان‌کیش) — فقط اگر سامان ارائه می‌کنی | از پنل sep.ir (بخش مدیریت ترمینال‌ها) |

نکته‌ها:
- **این لیست fail-fast است**: اگر در `.env` ریشه، یکی از این‌ها غلط/خالی باشد،
  سرویس api بالا نمی‌آید و دقیقاً می‌گوید چه چیزی ناقص است (عمدی — جلوگیری از
  «سایتِ ظاهراً روشن ولی ناامن»). لاگ: `docker compose logs api`.
- **`ZARINPAL_CALLBACK` لازم نیست** — آدرس برگشت پرداخت خودکار از `SITE_URL`
  ساخته می‌شود (همان `DOMAIN`). اگر در فایل مثال دیدی، متغیر بلااستفاده است.
- سه درگاه آماده است: زرین‌پال، پی‌ایر و **بانک سامان (سامان‌کیش)** — کلید هر
  کدام را که ارائه می‌کنی بده؛ انتخاب درگاه در صفحهٔ تسویه توسط مشتری است.
- نکتهٔ زرین‌پال: آدرس سایتت را در پنل زرین‌پال ثبت کن تا callback رد نشود.

### ۴-۲) متغیرهای اختیاری (پیش‌فرض معقول دارند — فقط اگر خواستی عوض کن)

| متغیر | پیش‌فرض | چیست |
|---|---|---|
| `HEALTH_ALERT_PHONES` | = SUPER_ADMIN_PHONES | گیرندگان پیامک قطعی/برگشت db/redis/uploads |
| `RESTAURANT_LAT` / `RESTAURANT_LNG` | از تنظیمات پنل ادمین | مختصات رستوران — مبدأ محاسبهٔ هزینهٔ ارسال (env روی DB اولویت دارد) |
| `GEO_BYPASS_IPS` | خالی | IPهایی که سد «فقط ایران» را رد می‌کنند (با کاما) |
| `BACKUP_HOUR` | `5` | ساعت بکاپ روزانهٔ دیتابیس (به وقت تهران) |
| `BACKUP_KEEP` | `7` | تعداد نسخهٔ بکاپ نگه‌داشته‌شده |
| `SWAGGER_ENABLED` | `false` | در دسترس گذاشتن `/swagger` (فقط برای دیباگ موقت) |
| `RECONCILE_AUTO_R1` | `off` | تسویهٔ خودکار مغایرت‌ها — روشن نکن مگر با تأیید |
| `SESSION_TTL_DAYS` | `30` | عمر نشست ورود |
| `MAX_DEVICES_PER_USER` | `5` | سقف دستگاه فعال هر کاربر |
| `COUPON_SCAN_TIME` / `COUPON_NUDGE_TIME` | `02:00` / `11:00` | ساعت job های شبانه/یادآور (تهران) |
| `API_UPSTREAMS` | `api:3000` | بالانسر Caddy — فقط برای ریپلا‌های api |
| `LOG_LEVEL` | `info` | سطح لاگ API |

> بقیهٔ متغیرهای فایل مثال (OTP، ضدتقلب دستگاه و…) پیش‌فرض امن دارند و
> `docker-compose.yml` مقادیر حساس بوت (APP_ENV ، PORT ، DEVICE_ENFORCEMENT و…)
> را صریحاً ست می‌کند — لازم نیست دست بزنی.

### ۴-۳) وب‌اپ در تولید هیچ فایل env نمی‌خواهد

- `API_URL` را compose داخل کانتینر ست می‌کند (`http://api:3000`).
- مرورگر کاربر درخواست‌های `/api/*` را به همان دامنه می‌فرستد و Caddy به api می‌رساند.
- تنها متغیر اختیاری: `VITE_NESHAN_API_KEY` (نقشهٔ نشان برای انتخاب آدرس) —
  باید **موقع build** وجود داشته باشد؛ شرح در `apps/web/.env.example`.

---

## ۵) دامنه — ست کردن DNS و TLS

1. در پنل ثبت‌کنندهٔ دامنه، یک رکورد **A** بساز:

```
نوع: A    نام: @    مقدار: <IP سرور>
```

   (برای `www` می‌توانی یک CNAME از `www` به `@` بزنی؛ اما Caddyfile فعلی فقط
   دامنهٔ اصلی را سرو می‌کند — کاربر `www` را با یک ریدایرکت ثبت‌کننده بده.)

2. در `.env` ریشه:

```
DOMAIN=sinshin.ir
ACME_EMAIL=you@example.com
```

3. پورت‌های ۸۰ و ۴۴۳ روی سرور باز باشند (فایروال/cloud).

4. استک را بالا بیاور — Caddy خودش برای دامنه گواهی Let's Encrypt می‌گیرد و
   تمدیدش خودکار است. گواهی‌ها در volume `sinshin_caddy_data` می‌مانند.

> اگر فعلاً دامنه نداری، همان پیش‌فرض `sinshin.localhost` با گواهی self-signedِ
> داخلی کار می‌کند (فقط داخل سرور، نه مرورگر بیرونی).

---

## ۶) اولین راه‌اندازی

```bash
cd /path/to/sinshin-food-delivery

# ۱) فایل env — از نمونه بساز و بند ۴ را کامل کن:
cp .env.example .env
nano .env            # یا هر ادیتوری

# ۲) استک کامل (postgres، redis، migrate، api، web، caddy، backup):
docker compose up -d --build

# ۳) همه باید healthy/running باشند:
docker compose ps

# ۴) سلامت API (باید {"status":"ok"} بدهد):
curl -s localhost/api/health

# ۵) دادهٔ اولیه (فقط بار اول — محصولات/دسته‌های نمونه):
docker compose --profile seed run --rm seed
```

> `migrate` قبل از api اجرا و تمام می‌شود (one-shot) — ساخت جدول‌ها خودکار است.

---

## ۷) دستورات روزمره

| کار | دستور |
|---|---|
| به‌روزرسانی بعد از `git pull` | `docker compose up -d --build` |
| وضعیت سرویس‌ها | `docker compose ps` |
| لاگ زندهٔ یک سرویس | `docker compose logs -f api --tail 100` |
| ورود به کانتینر | `docker exec -it sinshin-api sh` |
| ری‌استارت یک سرویس | `docker compose restart api` |
| اعمال تغییر `.env` | `docker compose up -d` (recreate می‌شود) |
| توقف کل استک (داده‌ها می‌مانند) | `docker compose down` |
| فقط زیرساخت (توسعه روی سیستم خودت) | `docker compose -f docker-compose.dev.yml up -d postgres redis` |

> اسکریپت‌های تست فاز (`apps/api/scripts/test-phase*.ps1`) همان `docker-compose.dev.yml`
> را صدا می‌زنند — مثل قبل اجرا شوند.

---

## ۸) بکاپ و بازیابی

بکاپ هر شب خودکار (سرویس backup، ساعت `BACKUP_HOUR` تهران، نگهداری `BACKUP_KEEP` نسخه):

```bash
# مسیر فایل‌های بکاپ روی هاست:
docker volume inspect sinshin_backups_data

# بازیابی یک نسخه:
gunzip -c sinshin-....sql.gz | docker exec -i sinshin-postgres psql -U sinshin -d sinshin
```

---

## ۹) رفع اشکال سریع

| نشانه | علت/راه‌حل |
|---|---|
| `no configuration file provided: not found` | در پوشهٔ درست نیستی، یا هنوز فایل با نام قدیمی `docker.compose.yml` (نقطه) روی دیسک است — راند ۲۳ نام‌ها تغییر کرد |
| `unauthorized` یا timeout هنگام pull | daemon.json داخل `/etc/docker/` نیست یا داکر ری‌استارت نشده — `docker info` را چک کن |
| میرور در `docker info` نیست | فایل را با sudo کپی کردی؟ `systemctl restart docker`؟ |
| `docker compose` نمی‌شناسد | پلاگین نصب نیست — `docker compose version` باید v2.x بدهد |
| permission denied روی docker.sock | کاربر در گروه docker نیست — بند ۱ |
| پورت ۸۰/۴۴۳ اشغال | `sudo ss -ltnp \| grep -E ':80\|:443'` — سرویس بیرونی را آزاد کن |
| بیلد روی `bun install` می‌ماند | شبکه/رجیستری npm — bunfig.toml را ببین (نکتهٔ registry آنجا) |
| `api:3000` در Caddy resolve نمی‌شود | سرویس api بالا نیست — `ps` و لاگ migrate |
| api بالا نمی‌آید و می‌کشد | لاگ بخوان: fail-fast کانفیگ — یکی از متغیرهای بند ۴-۱ ناقص است |
| گواهی TLS صادر نشد | رکورد A هنوز propagate نشده / پورت ۸۰ بسته — بند ۵ |

---

## ۱۰) نقشهٔ فایل‌های اجرا

| فایل | نقش |
|---|---|
| `docker-compose.yml` | استک تولید: caddy ، api (+ریپلا) ، web ، migrate ، seed ، postgres ، backup ، redis — با سقف منابع هر سرویس |
| `docker-compose.dev.yml` | توسعه: همان سرویس‌ها با volume کد و HMR (بدون سقف منابع) |
| `deploy/daemon.json` | میرور docker.io + چرخش لاگ — کپی به `/etc/docker/` |
| `deploy/backup/backup.sh` | منطق بکاپ شبانه (pg_dump + retention) |
| `.env.example` | نمونهٔ تک‌فایلِ کانفیگ تولید (بند ۴) |
| `apps/api/.env.example` | توضیح متغیرهای API برای اجرای بدون داکر (توسعه) |
| `apps/web/.env.example` | متغیرهای اختیاری build وب (نقشهٔ نشان، آدرس API) |
| `Caddyfile` | لبه: TLS خودکار، روتینگ `/api` و `/uploads` به api، بقیه به web |

---


------------------------------

سین‌شین فودپارک (Sinshin Foodpark)
اپلیکیشن سفارش غذا — تک‌سرور، غیرمیکروسرویس، تیم کوچک.

یک فایل کامپوز برای کل استک؛ نه فایل جدا برای هر اپ، نه شبکه‌ی دستی، نه پیش‌نیاز پنهان.

معماری

    اینترنت ──▶ caddy (TLS) ──▶ web ← فرانت TanStack Start (SSR)
                    └──▶ api ← بک‌اند Elysia + Bun (مسیر /api/*)
                          ├──▶ postgres 18.6
                          └──▶ redis

اجرای کامل با Docker — خلاصه‌ی دستورات (شرح کامل همین سند):

    docker compose up -d --build     # استک کامل (تولید)
    docker compose -f docker-compose.dev.yml up -d postgres redis   # فقط زیرساخت (dev)
    docker compose --profile seed run --rm seed   # seed (صریح)
