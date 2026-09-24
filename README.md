# اجرا با Docker — راهنمای سین‌شین

> استک کامل با **docker compose** روی یک سرور لینوکسی شخصی — کالیبره برای
> ۴ هسته / ۸GB رم / ۴۰GB دیسک. مشکل واقعی داکر در ایران فقط **رجیستری Docker Hub**
> است — و با «میرور» حل می‌شود (بند ۲).

این سند: نصب ← تنظیم میرور ← دستورات روزمره ← مهاجرت از podman با حفظ داده‌ها ← رفع اشکال.

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

> **ویندوز (فقط برای dev):** Docker Desktop یا Docker CE داخل WSL2 — همان daemon.json
> بند ۲ را در WSL اعمال کن. حالت پیشنهادی dev روزمره: فقط زیرساخت داخل داکر،
> خود اپ‌ها با bun روی سیستم (بند ۳).

---

## ۲) میرور Docker Hub — قلب کار

ایمیج‌هایی که این پروژه می‌کشد (با نام کوتاه در compose/Dockerfile‌ها — پیش‌فرض docker.io):

| ایمیج | چرا |
|---|---|
| `oven/bun:1.3.14-slim` | بیس هر دو Dockerfile (api و web) |
| `postgres:18.6-alpine` | دیتابیس + سرویس بکاپ |
| `redis:8-alpine` | کش/صف |
| `caddy:2.10-alpine` | لبه/TLS |

فایل آماده در ریپو هست: `deploy/docker/daemon.json` — دو کار انجام می‌دهد:

1. **میرور**: همهٔ pull های docker.io (هم `docker pull`، هم `docker build` با درایور
   پیش‌فرض BuildKit) اول از `docker.mobinhost.com` می‌آیند؛ اگر میرور مرد، خود docker.io.
2. **چرخش لاگ**: هر کانتینر حداکثر ۳ فایل × ۱۰MB لاگ — لاگِ بی‌مرز، دیسک ۴۰GB را
   یک روز پر می‌کند و کل سرور را می‌خواباند. اینجا یک‌بار برای همیشه حل است.

```bash
sudo mkdir -p /etc/docker
sudo cp deploy/docker/daemon.json /etc/docker/daemon.json
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

## ۳) دستورات روزمره

### استک کامل (تولید)

```bash
docker compose up -d --build   # postgres، redis، migrate، api، web، caddy، backup
docker compose ps              # همه باید healthy/running باشند
```

### محیط توسعه (فقط زیرساخت؛ اپ‌ها با bun روی خود سیستم)

```bash
docker compose -f compose.dev.yml up -d postgres redis
# بعد apps/api/.env.local طبق انتهای apps/api/.env.example
```

### seed (یک‌بار، صریح)

```bash
docker compose --profile seed run --rm seed
```

### به‌روزرسانی بعد از تغییر کد

```bash
git pull
docker compose up -d --build   # فقط سرویس‌های تغییریافته recreate می‌شوند
docker compose ps              # منتظر healthy بمان
```

### بقیهٔ دستورها

| کار | دستور |
|---|---|
| لاگ زندهٔ یک سرویس | `docker compose logs -f api --tail 100` |
| ورود به کانتینر | `docker exec -it sinshin-api sh` |
| ری‌استارت یک سرویس | `docker compose restart api` |
| توقف کل استک (داده‌ها می‌مانند) | `docker compose down` |
| لیست حجم‌ها | `docker volume ls` |
| بازیابی بکاپ | `gunzip -c sinshin-....sql.gz \| docker exec -i sinshin-postgres psql -U sinshin -d sinshin` |
| وضعیت سلامت API | `curl -s localhost/api/health` |

> اسکریپت‌های تست فاز (`apps/api/scripts/test-phase*.ps1`) همگی به
> `docker compose -f compose.dev.yml ...` مهاجرت کرده‌اند — مثل قبل اجرا شوند.

---

## ۴) مهاجرت از podman با حفظ داده‌ها (یک‌بار — رولبوک دقیق)

> زمان تقریبی: ۱۵ تا ۳۰ دقیقه + چند دقیقه قطعی سایت.
> تا قدم ۹ هر چیزی خراب شد، مسیر بازگشت در قدم ۸ هست.

**۰) دامپ ایمنی — قبل از هر کاری:**

```bash
podman exec sinshin-postgres pg_dump -U sinshin -d sinshin | gzip > ~/sinshin-safety-$(date +%F).sql.gz
ls -lh ~/sinshin-safety-*.sql.gz   # باید چند MB باشد؛ اگر 0 بود، ادامه نده
```

**۱) توقف کامل استک podman** (volume ها حذف نمی‌شوند):

```bash
cd /path/to/sinshin-food-delivery
podman compose down
```

**۲) کد جدید (راند ۲۱):** `git pull` (یا اعمال فایل‌های پنل تحویل راند ۲۱)

**۳) انتقال volume ها به docker** — برای هر حجم: خروجی tar از podman، ورودی به docker.
کانتینر کمکی همان ایمیج postgres است که به‌هرحال لازم است (pull از میرور):

```bash
mkdir -p ~/sinshin-migration && cd ~/sinshin-migration

# ── دیتابیس ──
podman volume export sinshin_pg_data -o pg_data.tar
docker volume create sinshin_pg_data
docker run --rm -v sinshin_pg_data:/data -v ~/sinshin-migration:/backup \
  postgres:18.6-alpine tar -C /data -xf /backup/pg_data.tar

# ── آپلودها ──
podman volume export sinshin_uploads_data -o uploads.tar
docker volume create sinshin_uploads_data
docker run --rm -v sinshin_uploads_data:/data -v ~/sinshin-migration:/backup \
  postgres:18.6-alpine tar -C /data -xf /backup/uploads.tar

# ── گواهی‌های Caddy (مهم: بدون این، ACME از نو صادر می‌کند و
#    ممکن است به rate-limit بخورد) ──
podman volume export sinshin_caddy_data -o caddy_data.tar
docker volume create sinshin_caddy_data
docker run --rm -v sinshin_caddy_data:/data -v ~/sinshin-migration:/backup \
  postgres:18.6-alpine tar -C /data -xf /backup/caddy_data.tar

# ── کانفیگ Caddy (اختیاری، بی‌ضرر) ──
podman volume export sinshin_caddy_config -o caddy_config.tar
docker volume create sinshin_caddy_config
docker run --rm -v sinshin_caddy_config:/data -v ~/sinshin-migration:/backup \
  postgres:18.6-alpine tar -C /data -xf /backup/caddy_config.tar
```

**۴) ردیس: انتقال لازم نیست.** نشست‌های کاربران از راند ۲۰ مقیم دیتابیس‌اند؛
ردیس فقط کش منو، قفل‌های job، محدودیت نرخ OTP و پل SSE است — تازه بالا می‌آید.

**۵) راه‌اندازی با docker:**

```bash
docker compose up -d --build
```

**۶) راستی‌آزمایی:**

```bash
docker compose ps                          # همه healthy
curl -s localhost/api/health               # status: "ok" (یا degraded اگر ردیس هنوز بالا نیامده)
docker compose logs -f api --tail 50       # بدون خطای تکرارشونده
# در مرورگر: سایت، ورود، سفارش، پنل ادمین
```

**۷) پاک‌سازی فایل‌های موقت:** `rm -rf ~/sinshin-migration` (دامپ ایمنی را نگه دار)

**۸) مسیر بازگشت (تا وقتی مطمئن نشده‌ای، podman را پاک نکن):**

```bash
docker compose down
# فایل‌های compose/Dockerfile را به نسخهٔ قبل از راند ۲۱ برگردان:
git log --oneline -5        # هش کامیت «stage twenty» را از اینجا بردار
git checkout <هش> -- compose.yml compose.dev.yml apps/api/Dockerfile apps/web/Dockerfile
podman compose up -d        # volume های podman هنوز سر جایشاناند
# (اگر راند ۲۱ هنوز کامیت نشده و فقط فایل‌ها را کپی کرده‌ای:
#  git checkout -- compose.yml compose.dev.yml apps/api/Dockerfile apps/web/Dockerfile)
```

**۹) بعد از چند روز عملکرد سالم:** `podman system prune -a` (volume های podman را
هم می‌توانی حذف کنی — ولی دامپ ایمنی را همیشه نگه دار).

---

## ۵) تفاوت‌ها و نکته‌ها

1. **سقف منابع** — هر سرویس در compose.yml سقف cpus/memory دارد (سقف، نه رزرو).
   نشت حافظهٔ یک کانتینر دیگر نمی‌تواند بقیهٔ استک و میزبان ۸GB را بکُشد.
   مجموع سقف‌ها ~۴.۹GB است؛ مصرف عادی خیلی پایین‌تر.
2. **healthcheck** — رویخلاف podman، docker اجرا و enforce می‌کند؛ `depends_on`
   با شرط‌ها و `restart: unless-stopped` دقیقاً همان‌طور که compose-spec می‌گوید.
3. **`RUN --mount=type=cache`** — BuildKit داکر بومی پشتیبانی می‌کند؛ کش بین
   بیلدها حفظ می‌شود.
4. **DNS داخلی** — اسم سرویس‌ها (`api:3000`، `web:3000`، `postgres:5432`) با
   DNS خود docker resolve می‌شود؛ Caddyfile بدون هیچ تغییری کار می‌کند.
5. **پورت‌های ۸۰/۴۴۳** — روی سرور لینوکسی با docker (rootful) بدون مشکل.
6. **`.dockerignore`** — دست‌نخورده؛ docker build همان‌طور می‌خواندش.

---

## ۶) رفع اشکال سریع

| نشانه | علت/راه‌حل |
|---|---|
| `unauthorized` یا timeout هنگام pull | daemon.json داخل `/etc/docker/` نیست یا داکر ری‌استارت نشده — `docker info` را چک کن |
| میرور در `docker info` نیست | فایل را با sudo کپی کردی؟ `systemctl restart docker`؟ |
| `docker compose` نمی‌شناسد | پلاگین نصب نیست — `docker compose version` باید v2.x بدهد |
| permission denied روی docker.sock | کاربر در گروه docker نیست — بند ۱ |
| پورت ۸۰/۴۴۳ اشغال | `sudo ss -ltnp \| grep -E ':80\|:443'` — سرویس بیرونی را آزاد کن |
| بیلد روی `bun install` می‌ماند | شبکه/رجیستری npm — bunfig.toml را ببین (نکتهٔ registry آنجا) |
| `api:3000` در Caddy resolve نمی‌شود | سرویس api بالا نیست — `docker compose ps` و لاگ migrate |

---

## ۷) خلاصهٔ تغییرات این مهاجرت در مخزن

| فایل | تغییر |
|---|---|
| `compose.yml` | docker خالص: حذف `x-podman`، نام کوتاه ایمیج‌ها، سقف منابع هر سرویس |
| `compose.dev.yml` | همان درمان (بدون سقف منابع — ماشین‌های dev متنوع‌اند) |
| `apps/api/Dockerfile` ، `apps/web/Dockerfile` | `FROM` با نام کوتاه + سربرگ BuildKit |
| `deploy/docker/daemon.json` | جدید — میرور mobinhost + چرخش لاگ |
| `apps/api/scripts/test-phase*.ps1` | `podman compose` → `docker compose` |
| `.env.example` ، `apps/api/.env.example` ، `deploy/backup/backup.sh` ، `health-alert.job.ts` | دستورها/کامنت‌ها → docker |
| `README.md` | همین سند |

`Caddyfile`، `bunfig.toml`، `deploy/backup/backup.sh` (منطق) و همهٔ کد اپلیکیشن
دست‌نخورده — این مهاجرت فقط زیرساخت اجراست.

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

    docker compose up -d --build        # استک کامل (تولید)
    docker compose -f compose.dev.yml up -d postgres redis   # فقط زیرساخت (dev)
    docker compose --profile seed run --rm seed              # seed (صریح)
