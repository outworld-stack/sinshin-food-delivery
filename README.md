# ═══════════════════════════════════════════════════════════════
# round-49 — sinshin-food-delivery — فایل 1 از 6
# مسیر مقصد: README.md
# وضعیت: جایگزینی کامل فایل موجود
# کامیت پیشنهادی: stage forty-three
# ═══════════════════════════════════════════════════════════════

# سین‌شین — راهنمای کامل اجرا (توسعه و تولید)

> سین‌شین فودپارک — اپلیکیشن سفارش غذا، تک‌سرور و غیرمیکروسرویس.
> این سند از صفر تا صد: **راه‌اندازی توسعه روی سیستم خودت (بخش ۲)** و
> **استقرار تولید روی سرور ابری با دامنه و IP (بخش ۳)** — گام به گام.
> مشکل واقعی داکر در ایران فقط **رجیستری Docker Hub** است — و با «میرور» حل
> می‌شود (بند ۳-۴).

---

## فهرست مطالب

- [۰) نگاه کلی — معماری و اجزا](#sec-0-overview)
- [۱) نقشهٔ فایل‌های `.env` — کدام فایل، کی خوانده می‌شود؟](#sec-1-env-files)
- [۲) راهنمای توسعه — گام به گام](#sec-2-dev)
- [۳) راهنمای تولید — صفر تا صد روی سرور ابری](#sec-3-prod)
- [۴) `.env` پیشنهادی — خط‌هایی که باید عوض کنی](#sec-4-env-suggested)
- [۵) نقشهٔ فایل‌های اجرا و کانفیگ](#sec-5-files-map)
- [۶) مقیاس و منابع](#sec-6-scale)

---

<a id="sec-0-overview"></a>

## ۰) نگاه کلی — معماری و اجزا

    اینترنت ──▶ caddy (TLS) ──▶ web ← فرانت TanStack Start (SSR)
                    └──▶ api ← بک‌اند Elysia + Bun (مسیر /api/*)
                          ├──▶ postgres 18.6
                          ├──▶ redis
                          └──▶ translator ← مترجم آفلاین NLLB (اختیاری)

| سرویس | نقش | پورت | از بیرون |
|---|---|---|---|
| **caddy** | لبه/TLS — گواهی خودکار Let's Encrypt، روتینگ `/api` و `/uploads` به api و بقیه به web | 80 و 443 | تنها پورت‌های باز سرور |
| **web** | فرانت SSR (TanStack Start + React + Vite) | 3000 | فقط داخل شبکهٔ داکر |
| **api** | بک‌اند (Elysia + Bun + Drizzle) | 3000 | فقط داخل شبکهٔ داکر |
| **postgres** | دیتابیس | 5432 | فقط داخل شبکه (در دِو: `127.0.0.1:5432`) |
| **redis** | کش OTP/نشست | 6379 | فقط داخل شبکه (در دِو: `127.0.0.1:6379`) |
| **translator** | ترجمهٔ ماشینی آفلاین فارسی↔عربی | 8300 | فقط داخل شبکه (در دِو: `127.0.0.1:8300`) |
| **backup** | بکاپ شبانهٔ دیتابیس | — | — |

ساختار ریپو:

```
apps/web          ← فرانت (TanStack Start)
apps/api          ← بک‌اند (Elysia)
packages/shared   ← قراردادهای مشترک وب و api
services/translator  ← سرویس پایتونی مترجم (NLLB)
deploy/           ← daemon.json (میرور) + backup.sh
docker-compose.yml       ← استک تولید (docker compose خودش پیدا می‌کند)
docker-compose.dev.yml   ← استک توسعه (همیشه با ‎-f)
Caddyfile         ← تنظیم لبه
.env.example      ← نمونهٔ تک‌فایل کانفیگ تولید
```

> سایت PWA است (نصب‌شدن روی موبایل، آفلاین‌پیج) — سرویس‌ورکر و مانیفست
> خودکار build می‌شوند؛ کاری لازم نداری.

---

<a id="sec-1-env-files"></a>

## ۱) نقشهٔ فایل‌های `.env` — کدام فایل، کی خوانده می‌شود؟

**پاسخ کوتاه:** روی سرور تولید فقط **`.env` ریشه** لازم است — فایل‌های
`apps/api/.env` و `apps/web/.env.local` به‌کلی به کار نمی‌آیند و کانتینرها
اصلاً نمی‌بینندشان. آن دو فایل فقط برای اجرای اپ‌ها با `bun` روی سیستم
خودت (بدون داکر) به کار می‌آیند.

| فایل | کی می‌خواندش | کجا لازم است |
|---|---|---|
| **`.env` (ریشه)** | خود docker compose — هم برای جایگزینی `${...}` داخل فایل‌های compose، هم `env_file` سرویس‌های api / migrate / seed / postgres / backup | **سرور تولید — تنها فایل مهم** + ماشین توسعه فقط در حالت «همه‌چیز داخل داکر» (بند ۲-۹) |
| `apps/api/.env` | Bun، موقع `cd apps/api && bun run dev` (بدون داکر) | ماشین توسعه |
| `apps/api/.env.local` | override همان حالت بدون داکر (فقط اولویت بالاتر؛ معمولاً فقط آدرس‌ها) | ماشین توسعه |
| `apps/web/.env.local` | Vite، موقع dev/build وب بدون داکر (`VITE_API_URL` و `VITE_NESHAN_API_KEY`) | ماشین توسعه |

سه نکتهٔ مهم:

1. **در کانتینر هیچ `.env`ای داخل ایمیج bake نمی‌شود** — `.dockerignore`
   همهٔ `**/.env` و `**/.env.*` را از بیلدcontext حذف می‌کند. همه‌چیز از
   `.env` ریشه از طریق compose می‌رسد.
2. **وب‌اپ در تولید هیچ فایل env جدا نمی‌خواهد**: `API_URL` را compose داخل
   کانتینر ست می‌کند (`http://api:3000` — سمت سرورِ SSR خوانده می‌شود) و
   مرورگر کاربر درخواست‌های `/api/*` را به همان دامنه می‌فرستد.
3. **تنها استثنا کلید نقشهٔ نشان است** (`VITE_NESHAN_API_KEY`) — چون Vite
   آن را *موقع build* داخل باندل جا می‌دهد، compose مقدارش را از `.env`
   ریده به‌صورت build arg به بیلد وب می‌رساند (رارد ۴۹). پس حتی نقشه هم از
   همان `.env` ریشه تامین می‌شود.

جمع‌بندی عملی: **روی سرور فقط `cp .env.example .env` و تکمیلش کن** — به
فایل‌های داخل `apps/` دست نزن (نمونه‌های `*.env.example` آن‌ها فقط مستندات
توسعه‌اند).

---

<a id="sec-2-dev"></a>

## ۲) راهنمای توسعه — گام به گام

حالت پیشنهادی روزمره: **زیرساخت (پستگرس + ردیس) داخل داکر، اپ‌ها با `bun`
روی سیستم خودت** — HMR سریع، لاگ تمیز، دیباگ راحت.

### ۲-۱) پیش‌نیازها

| ابزار | نسخه | نصب |
|---|---|---|
| **Bun** | ≥ 1.3 | لینوکس/مک: `curl -fsSL https://bun.sh/install \| bash` — ویندوز: `powershell -c "irm bun.sh/install.ps1\|iex"` |
| **Docker** (Engine + compose plugin v2) | هر نسخهٔ جدید | ویندوز/مک: Docker Desktop — لینوکس: بند ۳-۳ |
| **Git** | — | — |

> ویندوز: بعد از نصب Docker Desktop مطمئن شو WSL2 backend فعال است و
> درایوری که پروژه رویش است (مثلاً `C:\`) در File Sharing داکر است.

### ۲-۲) گرفتن کد و نصب وابستگی‌ها

```bash
git clone https://github.com/outworld-stack/sinshin-food-delivery.git
cd sinshin-food-delivery

# وابستگی‌های کل مونوریپو (یک‌بار؛ بعد از هر تغییر bun.lock تکرار کن):
bun install
```

### ۲-۳) زیرساخت (پستگرس + ردیس) با داکر

یک `.env` در ریشه بساز — فقط برای این که سرویس‌های دِو شمارهٔ
ادمین‌ها/سوییچ‌ها را از آن بخوانند (آدرس دیتابیس و ردیس را compose خودش
override می‌کند؛ پسورد پستگرسِ دِو هم ثابت است و به این فایل ربط ندارد):

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres redis
```

> **اگر قبلاً با نسخه‌های قدیمی دِو بالا آورده بودی** (پیش از رارد ۴۹ که
> اعتبارنامهٔ پستگرس دِو ثابت شد): یک‌بار `docker compose -f
> docker-compose.dev.yml down -v` بزن تا volume قدیمی با پسورد دیگر حذف
> شود، بعد دوباره بالا بیاور.

راستی‌آزمایی:

```bash
docker compose -f docker-compose.dev.yml ps     # هر دو باید healthy باشند
```

اعتبارنامهٔ ثابت دِو (لازم نیست جایی بگذاری؛ فقط بدان):

```
پستگرس:  sinshin / sinshin_local / db: sinshin  ← 127.0.0.1:5432
ردیس:    بدون پسورد                             ← 127.0.0.1:6379
```

### ۲-۴) کانفیگ API (بدون داکر)

```bash
cp apps/api/.env.example apps/api/.env
```

پیش‌فرض‌های همین فایل برای دِو آماده است (`APP_ENV=development`، پیامک
console، درگاه mock). تنها چیزی که ارزش عوض‌دادن دارد:

- `JWT_SECRET` — در دِو یک مقدار توسعه‌ای خودکار دارد؛ برای شبیه‌سازی
  واقعی‌تر `openssl rand -base64 48` بگذار.
- `SUPER_ADMIN_PHONES` — شمارهٔ خودت را بگذار تا با اولین ورود ابرمدیر شوی.

### ۲-۵) مهاجرت دیتابیس و دادهٔ نمونه

```bash
cd apps/api
bun run db:migrate     # ساخت/به‌روزرسانی جدول‌ها (drizzle)
bun run db:seed        # اختیاری — محصولات/دسته‌های نمونه (فقط بار اول)
```

### ۲-۶) اجرای API

```bash
cd apps/api
bun run dev            # ‎--hot روی http://localhost:3000
```

راستی‌آزمایی:

```bash
curl -s localhost:3000/api/health     # ‎{"status":"ok"}
```

### ۲-۷) اجرای وب

پنجرهٔ ترمینال دوم:

```bash
cd apps/web
bun run dev            # vite روی http://localhost:3001
```

- وب روی **3001** بالا می‌آید و `/api` و `/uploads` را خودش به
  `localhost:3000` (همان API بالا) پروکسی می‌کند — درست مثل لبه در تولید.
- اختیاری — `apps/web/.env.local`:
  - `VITE_API_URL=http://localhost:3000` (وقتی API جای دیگری است)
  - `VITE_NESHAN_API_KEY=...` (کلید نقشهٔ نشان برای تست MapPicker)

باز کن: **http://localhost:3001** — سایت، ورود با OTP (کد در لاگ API چاپ
می‌شود چون `SMS_PROVIDER=console`)، سبد، تسویه با درگاه mock.

### ۲-۸) مترجم آفلاین (اختیاری)

ترجمهٔ ماشینی فارسی↔عربی (NLLB) — فقط اگر روی ترجمهٔ خودکار کار می‌کنی:

```bash
docker compose -f docker-compose.dev.yml up -d translator
```

و در `apps/api/.env` خط `TRANSLATOR_URL=http://127.0.0.1:8300` را فعال کن،
بعد API را ری‌استارت کن. اولین build این سرویس مدل را دانلود می‌کند و چند
دقیقه طول می‌کشد؛ ~۲.۵GB رم می‌خواهد. پایین بودن مترجم فقط صف ترجمه را
pending نگه می‌دارد — چیز دیگری از کار نمی‌افتد.

### ۲-۹) حالت جایگزین: همه‌چیز داخل داکر

اگر نخواستی bun روی سیستمت نصب باشد:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

همه‌چیز داخل کانتینر با volume کد و HMR: وب روی `127.0.0.1:3001` و api
روی `127.0.0.1:3000`. مهاجرت جداگانه لازم نیست — سرویس migrate همان
ایمیج را می‌گیرد؛ برای اجرای دستی: `docker compose -f docker-compose.dev.yml
run --rm migrate`.

> اسکریپت‌های تست فاز (`apps/api/scripts/test-phase*.ps1`) همین فایل را
> صدا می‌زنند — مثل قبل اجرا شوند.

### ۲-۱۰) دستورات روزمرهٔ توسعه

| کار | دستور |
|---|---|
| بالا/پایین زیرساخت | `docker compose -f docker-compose.dev.yml up -d postgres redis` / `... down` |
| وضعیت | `docker compose -f docker-compose.dev.yml ps` |
| لاگ پستگرس دِو | `docker logs sinshin-dev-postgres --tail 50` |
| ریست دیتابیس دِو (پاک‌سازی کامل) | `docker compose -f docker-compose.dev.yml down -v` بعد migrate/seed دوباره |
| اجرای دوبارهٔ seed | `cd apps/api && bun run db:seed` |
| بازکردن استودیوی drizzle | `cd apps/api && bun run db:studio` |
| typecheck | `cd apps/api && bun run typecheck` و `cd ../web && bun run typecheck` |
| lint/format وب | `cd apps/web && bun run check` |

### ۲-۱۱) رفع اشکال توسعه

| نشانه | علت/راه‌حل |
|---|---|
| api نمی‌تواند به پستگرس وصل شود | سرویس دِو healthy است؟ (`ps`) — `DATABASE_URL` در `apps/api/.env` همان `sinshin:sinshin_local@127.0.0.1:5432` است؟ — volume قدیمی با پسورد دیگر؟ بند ۲-۳ (down -v) |
| `ECONNREFUSED 127.0.0.1:5432` | پورت فقط روی 127.0.0.1 باز است — اگر از WSL/کانتینر دیگری وصل می‌شوی همان‌جا اجرا کن |
| کد OTP را نمی‌بینم | `SMS_PROVIDER=console` است؟ کد در لاگ API چاپ می‌شود (`bun run dev` همان پنجره) |
| وب 3001 باز نمی‌شود | api روی 3000 روشن است؟ (وب هنگام SSR از API می‌خواند) — لاگ vite را ببین |
| صفحهٔ «سد جغرافیایی» در دِو | در localhost رخ نمی‌دهد (IPهای خصوصی همیشه عبور می‌کنند)؛ اگر با IP واقعی تست می‌کنی، سوییچ سد را از پنل ادمین خاموش کن |
| تغییر `apps/api/.env` اعمال نشد | ری‌استارت API — متغیرها فقط موقع بوت خوانده می‌شوند |

---

<a id="sec-3-prod"></a>

## ۳) راهنمای تولید — صفر تا صد روی سرور ابری

هدف این بخش: از یک سرور خالی تا سایتی با دامنه، HTTPS و پرداخت واقعی.
کالیبره برای **۴ هسته / ۸GB رم / ۴۰GB دیسک** (بند ۶).

### ۳-۱) سرور: چه بخرم؟

- هر ابر ایرانی/خارجی که یک **IP عمومی** و دسترسی کامل root بدهد
  (آراز، پارس‌پک، لیارا، ابر زس، هتزنر، …).
- **Ubuntu Server 24.04 LTS** (یا 22.04) — 64bit.
- حداقل قابل‌قبول: 2 هسته/4GB (بدون مترجم)؛ توصیه: **4c/8GB/40GB** —
  همه‌چیز شامل مترجم (۲.۵GB) جا می‌شود.
- پورت‌های 22 و 80 و 443 باید از بیرون باز باشند.

### ۳-۲) اتصال SSH و آماده‌سازی اولیه

```bash
ssh root@<IP سرور>

# به‌روزرسانی سیستم:
apt update && apt upgrade -y

# ساعت سرور (کرون‌های داخل کانتینر خودشان Asia/Tehran اند؛ این برای لاگ خود سرور):
timedatectl set-timezone Asia/Tehran

# فایروال — فقط سه پورت لازم است:
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

> **دامنه‌ات را همین‌جا آماده کن** — قبل از بند ۳-۸ باید رکورد DNS ست شده
> باشد (بند ۳-۶). اگر فعلاً دامنه نداری، استک با پیش‌فرض
> `www.sinshin.localhost` و گواهی self-signed بالا می‌آید (فقط داخل خود
> سرور قابل بازدید است، نه مرورگر بیرونی).

### ۳-۳) نصب Docker

```bash
# نصب رسمی (Docker Engine + compose plugin):
curl -fsSL https://get.docker.com | sh

# اجرای خودکار بعد از ری‌استارت سرور:
sudo systemctl enable --now docker

# راستی‌آزمایی:
docker version
docker compose version    # باید v2.x باشد (پلاگین، همراه نصب رسمی می‌آید)
```

### ۳-۴) میرور Docker Hub — قلب کار

ایمیج‌هایی که این پروژه می‌کشد (با نام کوتاه در compose/Dockerfile‌ها —
پیش‌فرض docker.io):

| ایمیج | چرا |
|---|---|
| `oven/bun:1.3.14-slim` | بیس هر دو Dockerfile (api و web) |
| `postgres:18.6-alpine` | دیتابیس + سرویس بکاپ |
| `redis:8-alpine` | کش/صف |
| `caddy:2.10-alpine` | لبه/TLS |

فایل آماده در ریپو هست: `deploy/daemon.json` — دو کار انجام می‌دهد:

1. **میرور**: همهٔ pull های docker.io (هم `docker pull`، هم `docker build` با
   درایور پیش‌فرض BuildKit) اول از `docker.mobinhost.com` می‌آیند؛ اگر میرور
   مرد، خود docker.io.
2. **چرخش لاگ**: هر کانتینر حداکثر ۳ فایل × 10MB لاگ — لاگِ بی‌مرز، دیسک
   40GB را یک روز پر می‌کند و کل سرور را می‌خواباند. اینجا یک‌بار برای
   همیشه حل است.

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
> - در `registry-mirrors` آدرس با `https://` می‌آید، اما در
>   `insecure-registries` طبق استاندارد داکر **بدون scheme** نوشته می‌شود
>   (`"docker.mobinhost.com"`) — با scheme آن‌جا بی‌اثر می‌شود. اگر گواهی
>   TLS میرور برایتان معتبر است و خطا نمی‌گیرید، می‌توانید خط
>   `insecure-registries` را کلاً حذف کنید.
> - میرورهای عمومی می‌آیند و می‌روند؛ اگر یک روز مرد، فقط همین یک فایل را
>   عوض کن — نه هیچ فایل دیگری از پروژه.

### ۳-۵) گرفتن کد روی سرور

```bash
cd /opt
git clone https://github.com/outworld-stack/sinshin-food-delivery.git
cd sinshin-food-delivery
```

> بیلد روی سرور انجام می‌شود (نه روی لپ‌تاپ) — هیچ pre-build ای لازم نیست.

### ۳-۶) دامنه و DNS

1. در پنل ثبت‌کنندهٔ دامنه، برای **هر دو** شکل دامنه رکورد بساز:

```
نوع: A       نام: @     مقدار: <IP سرور>
نوع: CNAME   نام: www   مقدار: @
```

   (Caddy برای هر دو نام گواهی می‌گیرد: دامنهٔ اصلی `www` را سرو می‌کند و
   دامنهٔ بدون پیشوند را خودش با ریدایرکت دائمی به آن می‌فرستد — نیازی به
   ریدایرکت ثبت‌کننده نیست.)

2. منتظر بمان رکورد propagate شود — تست:

```bash
# روی سیستم خودت (نه سرور):
nslookup www.sinshin-foodpark.ir     # باید IP سرور را بدهد
```

3. پورت‌های 80 و 443 روی سرور باز باشند (بند ۳-۲).

> Caddy بعد از بالا آمدن استک خودش برای دامنه گواهی Let's Encrypt می‌گیرد
> و تمدیدش خودکار است. گواهی‌ها در volume `sinshin_caddy_data` می‌مانند.

### ۳-۷) فایل `.env` — والک‌ترو کامل

```bash
cp .env.example .env
nano .env
```

چیزهایی که **خودت باید جور کنی** سه گروه است — پیامک، بانک، نقشه — به‌علاوهٔ
دامنه/ایمیل/رمزها. همه در بند ۴ همین سند به‌صورت یک بلوک آماده جمع شده‌اند؛
خلاصه‌اش:

| متغیر | چیست | چطور مقدار بدهم |
|---|---|---|
| `DOMAIN` | دامنهٔ اصلی **با پیشوند `www`** — Caddy با همین نام گواهی TLS می‌گیرد و `SITE_URL` (آدرس برگشت پرداخت‌ها) از آن ساخته می‌شود | دقیقاً `www.sinshin-foodpark.ir` (بدون `https://`) |
| `APEX_DOMAIN` | دامنهٔ بدون پیشوند — ریدایرکت دائمی به دامنهٔ اصلی | `sinshin-foodpark.ir` |
| `ACME_EMAIL` | ⚠ **ایمیل واقعی تو** — Let's Encrypt هشدارهای گواهی (انقضا/خطای تمدید) را می‌فرستد | یک ایمیل که واقعاً می‌خوانی |
| `POSTGRES_PASSWORD` | پسورد کاربر دیتابیس | `openssl rand -base64 24` |
| `DATABASE_URL` | رشتهٔ اتصال — **باید همان پسورد بالا داخلش باشد** | `postgres://sinshin:<همان پسورد>@postgres:5432/sinshin` |
| `JWT_SECRET` | کلید امضای توکن‌های ورود — لو برود یعنی جعل نشست | `openssl rand -base64 48` (حداقل 32 کاراکتر) |
| `SUPER_ADMIN_PHONES` | شماره‌هایی که با اولین ورود، نقش ابرمدیر می‌گیرند (با کاما) | شمارهٔ واقعی خودت |
| `SMS_PROVIDER` | حالت ارسال پیامک — در تولید فقط `real` قبول است | دقیقاً `real` |
| `SMS_BASE_URL` | آدرس درگاه پیامک (قرارداد: `POST {آدرس}/send` با هدر `Authorization: Bearer` و بدنهٔ JSON `{from, to, text}`) | مثال: `https://api.yoursms.ir` — مطابق پنل پیامکت |
| `SMS_API_KEY` | کلید همان درگاه پیامک | از پنل پیامک |
| `SMS_SENDER` | شماره/خط ارسال‌کننده | از پنل پیامک |
| `GATEWAY_MODE` | فقط «درگاه واقعی فعال/غیرفعال» را تعیین می‌کند — انتخابِ درگاه در صفحهٔ تسویه است | `direct` یا `indirect` (هر دو = فعال؛ `mock` = ممنوع در تولید) |
| `ZARINPAL_MERCHANT_ID` | کد پذیرندگی زرین‌پال (36 کاراکتر UUID) — فقط اگر زرین‌پال ارائه می‌کنی | از پنل زرین‌پال |
| `PAYIR_API_KEY` | کلید پی‌ایر — فقط اگر پی‌ایر ارائه می‌کنی | از پنل پی‌ایر |
| `SEP_TERMINAL_ID` | کد ترمینال بانک سامان (سامان‌کیش) — فقط اگر سامان ارائه می‌کنی | از پنل sep.ir (بخش مدیریت ترمینال‌ها) |
| `MELLAT_TERMINAL_ID` | کد ترمینال بانک ملت (به‌پرداخت) — فقط اگر ملت ارائه می‌کنی | از پنل به‌پرداخت (پس از فعال‌سازی ترمینال) |
| `MELLAT_USERNAME` | نام کاربری درگاه ملت | همراه ترمینال، از به‌پرداخت |
| `MELLAT_PASSWORD` | رمز درگاه ملت | همراه ترمینال، از به‌پرداخت |
| `VITE_NESHAN_API_KEY` | کلید نقشهٔ نشان برای انتخاب آدرس (اختیاری — خالی = فرم مختصات دستی) | کلید رایگان: https://platform.neshan.org |

نکته‌ها:

- **این لیست fail-fast است**: اگر در `.env` ریشه، یکی از این‌ها غلط/خالی
  باشد، سرویس api بالا نمی‌آید و دقیقاً می‌گوید چه چیزی ناقص است (عمدی —
  جلوگیری از «سایتِ ظاهراً روشن ولی ناامن»). لاگ: `docker compose logs api`.
- **آدرس برگشت پرداخت خودکار از `SITE_URL`** (همان `DOMAIN`) ساخته می‌شود —
  متغیر جدا لازم نیست.
- چهار درگاه آماده است: زرین‌پال، پی‌ایر، بانک سامان و **بانک ملت
  (به‌پرداخت)** — کلید هر کدام را که ارائه می‌کنی بده؛ انتخاب درگاه در
  صفحهٔ تسویه توسط مشتری است.
- نکتهٔ زرین‌پال: آدرس سایتت را در پنل زرین‌پال ثبت کن تا callback رد نشود.
- نکتهٔ ملت: برگشت مشتری از بانک با فرم POST می‌رسد — مسیر callback هر دو
  روش GET و POST را می‌پذیرد؛ توکار است و نیازی به تنظیم اضافه نداری.
- بعد از گذاشتن/عوض‌کردن `VITE_NESHAN_API_KEY` باید وب rebuild شود:
  `docker compose up -d --build web`.

**تست درگاه بدون پول:**

| درگاه | روش تست |
|---|---|
| زرین‌پال | `ZARINPAL_SANDBOX=true` — سندباکس رسمی (`sandbox.zarinpal.com`)؛ فقط هاست عوض می‌شود، مسیرها و جریان verify یکسان‌اند؛ مرچنت هر UUID دلخواهی؛ در production بوت را می‌کُشد |
| پی‌ایر | `PAYIR_API_KEY=test` — همان آدرس‌ها، درگاه شبیه‌سازی‌شده |
| سامان / ملت | سندباکس عمومی ندارند (شاپرک) — ترمینال تستیِ بانک روی همان آدرس تولید |
| همه | `GATEWAY_MODE=mock` — درگاه داخلی کامل برای توسعه/E2E (در تولید ممنوع) |

**متغیرهای اختیاری** (پیش‌فرض معقول دارند — فقط اگر خواستی عوض کن):

| متغیر | پیش‌فرض | چیست |
|---|---|---|
| `HEALTH_ALERT_PHONES` | = SUPER_ADMIN_PHONES | گیرندگان پیامک قطعی/برگشت db/redis/uploads |
| `RESTAURANT_LAT` / `RESTAURANT_LNG` | مختصات رستوران در بندرانزلی (نمونهٔ فایل env) | مختصات رستوران — مبدأ محاسبهٔ هزینهٔ ارسال (env روی DB اولویت دارد) |
| `GEO_BYPASS_IPS` | خالی | IPهایی که سد «فقط ایران» را رد می‌کنند (با کاما) |
| `BACKUP_HOUR` | `5` | ساعت بکاپ روزانهٔ دیتابیس (به وقت تهران) |
| `BACKUP_KEEP` | `7` | تعداد نسخهٔ بکاپ نگه‌داشته‌شده |
| `SWAGGER_ENABLED` | `false` | در دسترس گذاشتن `/swagger` (فقط برای دیباگ موقت) |
| `RECONCILE_AUTO_R1` | `off` | تسویهٔ خودکار مغایرت‌ها — روشن نکن مگر با تأیید |
| `SESSION_TTL_DAYS` | `30` | عمر نشست ورود |
| `MAX_DEVICES_PER_USER` | `5` | سقف دستگاه فعال هر کاربر |
| `COUPON_SCAN_TIME` / `COUPON_NUDGE_TIME` | `02:00` / `11:00` | ساعت job های شبانه/یادآور (تهران) |
| `API_UPSTREAMS` | `api:3000` | بالانسر Caddy — فقط برای ریپلاهای api |
| `ZARINPAL_SANDBOX` | `false` | سرویس تست رسمی زرین‌پال — در production بوت را می‌کُشد |
| `PAYMENT_TIMEOUT_MS` | `15000` | مهلت هر فراخوانی HTTP به درگاه‌های پرداخت (میلی‌ثانیه) |
| `SMS_TIMEOUT_MS` | `10000` | مهلت فراخوانی درگاه پیامک (میلی‌ثانیه) |
| `GEO_FETCH_TIMEOUT_MS` / `GEO_RETRY_MINUTES` | `10000` / `15` | مهلت هر منبع IP و فاصلهٔ تلاش مجدد دروازهٔ جغرافیایی |
| `REFERRAL_PERCENT` | `10` | درصد سود معرف از پرداخت آنلاینِ غذاها (0 تا 100؛ فقط سفارش‌های جدید) |
| `DB_POOL_MAX` | `10` | سقف اتصال‌های هم‌زمان هر نمونهٔ API به پستگرس (از `PG_MAX_CONNECTIONS` پایین‌تر) |
| `RECONCILE_AUTO_R2` … `RECONCILE_AUTO_R10` | `off` | پرچم بقیهٔ چک‌های مغایرت‌گیری (R11 همیشه فقط-گزارش است) |
| `RECONCILE_R3_WINDOW_DAYS` | `120` | پنجرهٔ چک برداشت کیف پول در برابر سفارش‌ها (روز) |
| `HSTS_ENABLED` | `false` | هدر HSTS در Caddy — بعد از اطمینان از پایداری HTTPS روشنش کن |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | عمر access token کوتاه‌عمر (refresh جدا است) |
| `PG_MAX_CONNECTIONS` | `200` | سقف کل اتصال‌های پستگرس — با ریپلاهای api هماهنگ نگه دار |
| `PG_SHARED_BUFFERS` | `256MB` | تیونینگ پستگرس — فقط برای اندازهٔ سرور متفاوت عوض کن |
| `PG_EFFECTIVE_CACHE_SIZE` | `768MB` | تیونینگ پستگرس (تخمین حافظهٔ قابل استفاده برای ایندکس‌ها) |
| `PG_WORK_MEM` | `8MB` | تیونینگ پستگرس (حافظهٔ مرتب‌سازی هر عملیات) |
| `REDIS_MAXMEMORY` | `512mb` | سقف حافظهٔ ردیس (سیاست noeviction — دادهٔ OTP/نشست بیرون نمی‌رود) |

> بقیهٔ متغیرهای فایل مثال (OTP، ضدتقلب دستگاه و…) پیش‌فرض امن دارند و
> `docker-compose.yml` مقادیر حساس بوت (APP_ENV ، PORT ، DEVICE_ENFORCEMENT
> و…) را صریحاً ست می‌کند — لازم نیست دست بزنی.

### ۳-۸) بالا آوردن استک

```bash
docker compose up -d --build
```

- نام فایل تولیدی **`docker-compose.yml`** است — همان که docker compose
  «خودکار» پیدا می‌کند؛ پس هیچ `-f`ای لازم نیست. (فایل توسعه
  `docker-compose.dev.yml` همیشه `-f` می‌خواهد.)
- ترتیب خودکار است: postgres ← migrate (یک‌بار) ← api ← web ← caddy.
- اولین بیلد با اینترنت کند است (ایمیج‌ها + وابستگی‌ها)؛ دفعات بعد با کش
  سریع است.

```bash
# همه باید healthy/running باشند:
docker compose ps

# سلامت API (باید ‎{"status":"ok"} بدهد):
curl -s localhost/api/health
```

### ۳-۹) دادهٔ اولیه (اختیاری)

```bash
# محصولات/دسته‌های نمونه — فقط بار اول و فقط اگر خواستی:
docker compose --profile seed run --rm seed
```

> `migrate` قبل از api اجرا و تمام می‌شود (one-shot) — ساخت جدول‌ها خودکار
> است و دستی لازم نیست.

### ۳-۱۰) چک‌لیست راستی‌آزمایی

| # | چه چیزی | چطور |
|---|---|---|
| 1 | همهٔ سرویس‌ها سالم | `docker compose ps` — بدون restarting/exit |
| 2 | سلامت API | `curl -s localhost/api/health` → `{"status":"ok"}` |
| 3 | گواهی TLS صادر شده | `docker compose logs caddy --tail 50` (بدون خطای ACME) |
| 4 | HTTPS از بیرون | روی سیستم خودت: `curl -sI https://www.sinshin-foodpark.ir` → `HTTP/2 200` |
| 5 | ریدایرکت دامنهٔ بدون پیشوند | `curl -sI https://sinshin-foodpark.ir` → `301` به `www` |
| 6 | سایت در مرورگر | `https://www.sinshin-foodpark.ir` — صفحهٔ اول، منو، محصولات |
| 7 | آپلودها | تصویر محصولی از پنل ادمین آپلود کن → در سایت دیده شود |

اگر 3 یا 4 خطا داد: رکورد A هنوز propagate نشده / پورت 80 بسته — بند ۳-۶.

### ۳-۱۱) اولین ورود

- **مشتری/ادمین**: `https://www.sinshin-foodpark.ir/login` → شمارهٔ
  `SUPER_ADMIN_PHONES` را بزن → کد پیامکی می‌آید (درگاه real) → ورود.
  همان شماره‌ها به‌صورت خودکار **ابرمدیر** می‌شوند و `/admin` برایشان باز
  است (پنل مدیریت کامل).
- **پنل مشتری**: `/dashboard` (سفارش‌ها، کیف پول، آدرس‌ها).
- **پیک**: `/courier/login` با شمارهٔ پیک (فعال‌سازی از پنل ادمین).

### ۳-۱۲) به‌روزرسانی سایت بعد از تغییر کد

```bash
cd /opt/sinshin-food-delivery
git pull
docker compose up -d --build      # فقط چیزهایی که عوض شده rebuild می‌شود
```

- مهاجرت دیتابیس اگر تغییر داشته باشد، خودکار قبل از api اجرا می‌شود.
- تغییر `.env`: `docker compose up -d` (سرویس‌های وابسته recreate می‌شوند؛
  برای `VITE_NESHAN_API_KEY`: `docker compose up -d --build web`).

### ۳-۱۳) بکاپ و بازیابی

بکاپ هر شب خودکار (سرویس backup، ساعت `BACKUP_HOUR` تهران، نگهداری
`BACKUP_KEEP` نسخه):

```bash
# مسیر فایل‌های بکاپ روی هاست:
docker volume inspect sinshin_backups_data

# بازیابی یک نسخه:
gunzip -c sinshin-....sql.gz | docker exec -i sinshin-postgres psql -U sinshin -d sinshin
```

> برای نگهداری بکاپ روی خود هاست (به‌جای volume داکری)، در
> `docker-compose.yml` سرویس backup مسیر `backups_data:/backups` را با
> `./backups:/backups` عوض کن.

### ۳-۱۴) دستورات روزمرهٔ تولید

| کار | دستور |
|---|---|
| به‌روزرسانی بعد از `git pull` | `docker compose up -d --build` |
| وضعیت سرویس‌ها | `docker compose ps` |
| لاگ زندهٔ یک سرویس | `docker compose logs -f api --tail 100` |
| ورود به کانتینر | `docker exec -it sinshin-api sh` |
| ری‌استارت یک سرویس | `docker compose restart api` |
| اعمال تغییر `.env` | `docker compose up -d` (recreate می‌شود) |
| توقف کل استک (داده‌ها می‌مانند) | `docker compose down` |
| فاصلهٔ دیسک/لاگ‌ها | `docker system df` |

### ۳-۱۵) رفع اشکال تولید

| نشانه | علت/راه‌حل |
|---|---|
| `no configuration file provided: not found` | در پوشهٔ درست نیستی — نام فایل باید `docker-compose.yml` باشد (با خط تیره؛ راند 23 از `docker.compose.yml` تغییر کرد) |
| `unauthorized` یا timeout هنگام pull | daemon.json داخل `/etc/docker/` نیست یا داکر ری‌استارت نشده — `docker info` را چک کن |
| میرور در `docker info` نیست | فایل را با sudo کپی کردی؟ `systemctl restart docker`؟ |
| `docker compose` نمی‌شناسد | پلاگین نصب نیست — `docker compose version` باید v2.x بدهد |
| permission denied روی docker.sock | کاربر در گروه docker نیست — بند ۳-۳ |
| پورت 80/443 اشغال | `sudo ss -ltnp \| grep -E ':80\|:443'` — سرویس بیرونی را آزاد کن |
| بیلد روی `bun install` می‌ماند | شبکه/رجیستری npm — `bunfig.toml` را ببین؛ برای سرورِ مشکل‌دار، registry را مطابق کامنت همان فایل به `https://registry.npmmirror.com` عوض کن |
| `api:3000` در Caddy resolve نمی‌شود | سرویس api بالا نیست — `ps` و لاگ migrate |
| api بالا نمی‌آید و می‌کشد | لاگ بخوان: fail-fast کانفیگ — یکی از متغیرهای بند ۳-۷ ناقص است (`docker compose logs api`) |
| گواهی TLS صادر نشد | رکورد A هنوز propagate نشده / پورت 80 بسته — بند ۳-۶ و لاگ caddy |
| ورود با OTP کار نمی‌کند | `SMS_PROVIDER=real` و سه متغیر درگاه درست‌اند؟ (`docker compose logs api`) |
| صفحهٔ «سد جغرافیایی» برای کاربر ایرانی | IP کاربر در بازه‌های ایران شناسایی نشده — `GEO_BYPASS_IPS` موقت، یا صبر بر تازه‌سازی منابع (هر ۱۵ دقیقه) |

---

<a id="sec-4-env-suggested"></a>

## ۴) `.env` پیشنهادی — خط‌هایی که باید عوض کنی

بعد از `cp .env.example .env`، **فقط این خط‌ها** را کامل کن — بقیهٔ فایل
مثال همان مقادیر پیشنهادی من است (پیش‌فرض‌های امن/کالیبره). جای‌نگهدارهای
`⟨…⟩` سه گروهی‌اند که خودت باید بدهی: **پیامک، بانک، نقشه**.

```bash
# ─── دامنه و گواهی ───
DOMAIN=www.sinshin-foodpark.ir          # ← دامنهٔ خودت (با www، بدون https://)
APEX_DOMAIN=sinshin-foodpark.ir         # ← بدون www
ACME_EMAIL=you@example.com              # ← ⚠ ایمیل واقعی تو (هشدارهای گواهی)

# ─── دیتابیس (پسورد تولید کن و همان را دو جا بگذار) ───
POSTGRES_PASSWORD=⟨خروجی: openssl rand -base64 24⟩
DATABASE_URL=postgres://sinshin:⟨همان پسورد⟩@postgres:5432/sinshin

# ─── امنیت نشست ───
JWT_SECRET=⟨خروجی: openssl rand -base64 48⟩

# ─── ادمین‌ها ───
SUPER_ADMIN_PHONES=09118067283,09039526091   # ← شماره‌های خودت

# ─── پیامک OTP (گروه 1 — خودت می‌دهی) ───
SMS_PROVIDER=real
SMS_BASE_URL=⟨آدرس درگاه پیامک — مثال: https://api.yoursms.ir⟩
SMS_API_KEY=⟨کلید پنل پیامک⟩
SMS_SENDER=⟨خط/شمارهٔ ارسال‌کننده⟩

# ─── درگاه پرداخت (گروه 2 — خودت می‌دهی؛ هر درگاهی که داری) ───
GATEWAY_MODE=direct
ZARINPAL_MERCHANT_ID=⟨UUID زرین‌پال یا خالی⟩
PAYIR_API_KEY=⟨کلید پی‌ایر یا خالی⟩
SEP_TERMINAL_ID=⟨ترمینال سامان یا خالی⟩
MELLAT_TERMINAL_ID=⟨ترمینال ملت یا خالی⟩
MELLAT_USERNAME=⟨نام کاربری ملت یا خالی⟩
MELLAT_PASSWORD=⟨رمز ملت یا خالی⟩

# ─── نقشهٔ نشان (گروه 3 — خودت می‌دهی؛ اختیاری) ───
VITE_NESHAN_API_KEY=⟨کلید platform.neshan.org یا خالی⟩

# ─── این‌ها را از فایل مثال دست‌نخورده نگه دار (پیش‌فرض درست) ───
# POSTGRES_USER=sinshin · POSTGRES_DB=sinshin · REDIS_URL=redis://redis:6379
# APP_ENV=production · SESSION_TTL_DAYS=30 · DEVICE_ENFORCEMENT=on
# BACKUP_HOUR=5 · BACKUP_KEEP=7 · COUPON_SCAN_TIME=02:00 · COUPON_NUDGE_TIME=11:00
# RESTAURANT_LAT/LNG (انزلی) · SWAGGER_ENABLED=false · RECONCILE_AUTO_R1=off
# API_UPSTREAMS=api:3000 · UploadDir و ردیس و تیونینگ PG (بند ۳-۷)
```

> **ترتیب مهم است**: قبل از اولین `up`، پیامک را کامل کن — در تولید
> `SMS_PROVIDER=console` بوت را می‌کشد و بدون پیامک real نمی‌توانی وارد
> پنل شوی (ورود با OTP است).

---

<a id="sec-5-files-map"></a>

## ۵) نقشهٔ فایل‌های اجرا و کانفیگ

| فایل | نقش |
|---|---|
| `docker-compose.yml` | استک تولید: caddy ، api (+ریپلا) ، web ، migrate ، seed ، postgres ، backup ، redis ، translator — با سقف منابع هر سرویس |
| `docker-compose.dev.yml` | توسعه: همان سرویس‌ها با volume کد و HMR (بدون سقف منابع؛ اعتبارنامهٔ ثابت دِو) |
| `deploy/daemon.json` | میرور docker.io + چرخش لاگ — کپی به `/etc/docker/` |
| `deploy/backup/backup.sh` | منطق بکاپ شبانه (pg_dump + retention) |
| `.env.example` | نمونهٔ تک‌فایلِ کانفیگ تولید (بند ۳-۷ و ۴) |
| `apps/api/.env.example` | توضیح متغیرهای API برای اجرای بدون داکر (توسعه) |
| `apps/web/.env.example` | متغیرهای اختیاری build وب (نقشهٔ نشان، آدرس API) |
| `Caddyfile` | لبه: TLS خودکار، روتینگ `/api` و `/uploads` به api، بقیه به web |
| `apps/api/Dockerfile` · `apps/web/Dockerfile` | بیلد چندمرحله‌ای (deps/dev/build/runtime) — هر دو کلید نقشه را به‌صورت build arg می‌پذیرند |
| `services/translator/` | مترجم آفلاین NLLB — جزئیات: `services/translator/README.md` |

---

<a id="sec-6-scale"></a>

## ۶) مقیاس و منابع

- کالیبره‌ی پیش‌فرض: **4 هسته / 8GB / 40GB** — سقف منابع هر سرویس در
  `docker-compose.yml` (مجموع ~7.3GB در بدترین حالت؛ مصرف عادی خیلی
  پایین‌تر). سقف‌ها نه رزروند و نه ضامن عملکرد — فقط جلوی کشتنِ کل سرور
  توسط یک کانتینرِ نشت‌کرده را می‌گیرند.
- **سرور کوچک‌تر (2c/4GB)**: سرویس `translator` را حذف کن (یا موقتاً
  `docker compose stop translator`) — بقیهٔ استک جا می‌شود؛ ترجمهٔ خودکار
  صف می‌شود ولی سایت سالم است. تیونینگ PG را هم پایین بیاور (بند ۳-۷).
- **ریپلای api**: اگر لازم شد — `API_UPSTREAMS="api:3000 api2:3000
  api3:3000"` در `.env` و بعد `docker compose --profile scaled up -d`.
  Caddy به‌صورت round_robin بین آن‌ها پخش می‌کند و `DB_POOL_MAX` را طوری
  تنظیم کن که مجموع ریپلاها از `PG_MAX_CONNECTIONS` رد نشود.
- **مترجم** جدا بلند/پایین می‌شود و وابستگی boot ندارد.