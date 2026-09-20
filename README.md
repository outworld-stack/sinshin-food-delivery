# مهاجرت از Docker به Podman — راهنمای سین‌شین

> چرا؟ داکر در ایران تحریم است؛ دانلود از Docker Hub کند/ناممکن شده و روند توسعه را
> کند کرده است. Podman خودش (ابزار) از GitHub توزیع می‌شود و نیازی به لایسنس یا
> اکانت Docker ندارد. مشکل واقعی فقط **رجیستری Docker Hub** است — و با «میرور» حل می‌شود.

این سند: نصب (ویندوز/لینوکس) ← تنظیم میرور ← دستورات روزمره ← انتقال داده‌های قدیمی ← رفع اشکال.

---

## ۱) نصب

### ویندوز (WSL2 لازم دارد — مثل خود Docker Desktop)

```powershell
# podman از GitHub (برای ایران بدون مشکل):
winget install RedHat.Podman            # یا: choco install podman-cli
# رابط گرافیکی اختیاری:
winget install RedHat.Podman-Desktop

# ماشین مجازی podman (یک‌بار برای همیشه):
podman machine init
podman machine start                    # بعد از هر ری‌استارت ویندوز هم اگر لازم شد
```

### لینوکس

```bash
# Fedora/RHEL:  sudo dnf install podman
# Debian/Ubuntu: sudo apt install podman
```

### Compose — **قدمِ کلیدی، دو راه دارد:**

**راه الف (پیشنهادی): باینری مستقل docker-compose به‌عنوان provider.**
`podman compose` خودش هیچ compose engine‌ای ندارد؛ اگر باینری docker-compose را
نصب کرده باشد، همان را در برابر سوکت podman اجرا می‌کند — یعنی **صددرصد سازگار با
همه‌ی امکانات compose** (از جمله `depends_on: condition: service_healthy` و
`service_completed_successfully` که این پروژه به آن‌ها وابسته است):

```powershell
# ویندوز: از GitHub Releases دانلود کن (برای ایران در دسترس):
#   https://github.com/docker/compose/releases  → docker-compose-windows-x86_64.exe
#   به‌عنوان docker-compose.exe داخل PATH بگذار (مثلاً C:\Windows یا ~\bin)
docker-compose version   # تست
podman compose version   # podman خودش همین باینری را پیدا می‌کند و DOCKER_HOST را می‌سازد
```

**راه ب: podman-compose (پایتونی).** `pip install podman-compose` — برای فایل dev
کفایت می‌کند؛ فقط همیشه با `--in-pod=false` اجرا کن (در غیر این صورت همه‌ی
سرویس‌ها داخل یک pod مشترک می‌نشینند و DNS اسم سرویس‌ها کار نمی‌کند — Caddyfile
و DATABASE_URL خراب می‌شوند). در هر دو فایل compose مقدار `x-podman.in_pod: false`
گذاشته شده که نسخه‌های جدید podman-compose را به‌خوبی می‌خواند، ولی فلگ صریح
مطمئن‌تر است:

```bash
podman-compose --in-pod=false -f compose.dev.yml up -d
```

> از این‌جا به بعد همه‌ی مثال‌ها با `podman compose` (راه الف) هستند.

---

## ۲) میرور Docker Hub — قلب مهاجرت

ایمیج‌هایی که این پروژه از Docker Hub می‌کشد (با نام کامل در compose/Dockerfile‌ها):

| ایمیج | چرا |
|---|---|
| `docker.io/oven/bun:1.3.14-slim` | بیس هر دو Dockerfile (api و web) |
| `docker.io/library/postgres:18.6-alpine` | دیتابیس |
| `docker.io/library/redis:8-alpine` | کش/صف |
| `docker.io/library/caddy:2.10-alpine` | لبه/TLS |

> نکته: میرور رسمی bun روی GHCR (ghcr.io/oven-sh/bun) هنوز منتشر نشده —
> PR آن در oven-sh/bun باز است؛ وقتی منتشر شد می‌توان FROM را عوض کرد و برای bun
> اصلاً به میرور نیاز نباشد. تا آن زمان همه از میرور می‌آیند.

فایل تنظیم را بساز:

**ویندوز** (داخل ماشین podman — نه روی درایو ویندوز):

```powershell
podman machine ssh
sudo tee /etc/containers/registries.conf <<'EOF'
[[registry]]
prefix = "docker.io"
location = "docker.io"

  # آینه‌ی اول — DaoCloud (تست‌شده: oven/bun، postgres، redis، caddy با همین تگ‌ها)
  [[registry.mirror]]
  location = "docker.m.daocloud.io"

  # آینه‌ی پشتیبان — هر میرور دیگری که برای شما کار کند؛ چند نمونه‌ی رایج:
  # [[registry.mirror]]
  # location = "docker.1ms.run"
EOF
exit
podman machine stop && podman machine start
```

**لینوکس** (rootless):

```bash
mkdir -p ~/.config/containers
# همین محتوا را در ~/.config/containers/registries.conf بگذار
```

چطور کار می‌کند؟ برای هر pull از `docker.io/...` اول آینه‌ها به‌ترتیب امتحان
می‌شوند؛ اگر همه شکست خوردند، خود docker.io. یعنی **رفتار پیش‌فرض دست نخورده** و
فقط یک مسیر سریع‌تر جلو افتاده است. اسم ایمیج‌ها هیچ تغییری نمی‌خواهند.

تست سلامت میرور (قبل از اعتماد، از شبکه‌ی خودت):

```bash
curl -sI --max-time 10 https://docker.m.daocloud.io/v2/ | head -1
# هر چیزی غیر از timeout (مثلاً 401) یعنی زنده است
```

میرورهای عمومی می‌آیند و می‌روند؛ اگر یک روز همه مردند، فقط همین فایل را عوض کن —
نه هیچ فایل دیگری از پروژه.

---

## ۳) دستورات روزمره (نگاشت docker → podman)

| قبلاً (Docker) | حالا (Podman) |
|---|---|
| `docker compose up -d` | `podman compose up -d` |
| `docker compose -f docker-compose.dev.yml up -d` | `podman compose -f compose.dev.yml up -d` |
| `docker compose logs -f api` | `podman compose logs -f api` |
| `docker compose ps` | `podman compose ps` |
| `docker compose down` | `podman compose down` |
| `docker compose up -d --build` | `podman compose up -d --build` |
| `docker ps` / `docker images` | `podman ps` / `podman images` |
| `docker exec -it sinshin-api sh` | `podman exec -it sinshin-api sh` |
| `docker volume ls` | `podman volume ls` |
| `docker system prune -a` | `podman system prune -a` |

> عادت دست‌ها؟ در PowerShell پروفایل‌ت (`$PROFILE`) بگذار:
> `Set-Alias docker podman` — ولی `docker compose` باید همان `podman compose` بماند.

### اجرای استک کامل (تولید)

```bash
podman compose up -d            # postgres و redis و migrate و api و web و caddy
podman compose ps
```

### فقط زیرساخت + اپ روی سیستم (پیشنهادی برای dev روزمره روی ویندوز)

```bash
podman compose -f compose.dev.yml up -d postgres redis
# بعد apps/api/.env.local و apps/web طبق README — اپ‌ها را خودت با bun اجرا کن
```

### seed (یک‌بار، صریح)

```bash
podman compose --profile seed run --rm seed
```

### اسکریپت‌های تست فاز (PowerShell)

`apps/api/scripts/test-phase*.ps1` همه به `podman compose -f compose.dev.yml ...`
مهاجرت کرده‌اند — مثل قبل اجرا شوند.

---

## ۴) تفاوت‌ها و گوتچاها

1. **in_pod** — فقط برای کاربران podman-compose: به‌صورت پیش‌فرض همه‌ی سرویس‌ها
   در یک pod مشترک (شبکه‌ی اشتراکی) می‌نشینند و DNS اسم سرویس‌ها (`api`، `postgres`، …)
   کار نمی‌کند. هر دو فایل compose مقدار `x-podman.in_pod: false` دارند و فلگ
   `--in-pod=false` هم مستند است. با provider راه الف اصلاً موضوعیت ندارد.

2. **پورت‌های ۸۰/۴۴۳** — روی ویندوز (podman machine) بدون مشکل باز می‌شوند.
   روی **لینوکس rootless** اگر خطای bind داد:
   `sudo sysctl net.ipv4.ip_unprivileged_port_start=80` (و برای ماندگاری در
   `/etc/sysctl.d/` بگذار) — یا کانتینر caddy را rootful بالا بیاور.

3. **healthcheck** — podman به‌تنهایی HEALTHCHECK داخل Dockerfile را اجرا نمی‌کند
   (ما هم نداریم)؛ healthcheckهای داخل فایل‌های compose توسط compose provider
   اجرا می‌شوند و `depends_on` با شرط‌ها درست کار می‌کند (دلیل پیشنهاد راه الف).

4. **volumeهای Docker Desktop منتقل نمی‌شوند** — حجم‌های podman جداست. برای داده‌ها
   بند ۵ را ببین.

5. **`RUN --mount=type=cache`** — Buildah (موتور بیلد podman) آن را پشتیبانی
   می‌کند؛ بدترین حالت، عدم اشتراک کش بین بیلدهاست = فقط بیلد کندتر، نه شکسته.

6. **`.dockerignore`** — همان‌طور می‌ماند؛ podman build آن را می‌خواند
   (نام جدید `.containerignore` هم می‌پذیرد ولی لازم نیست).

7. **DNS داخلی** — با provider یا `--in-pod=false`، اسم سرویس‌ها مثل docker
   resolve می‌شود (netavark/aardvark). Caddyfile (`api:3000`، `web:3000`) بدون
   تغییر کار می‌کند.

---

## ۵) انتقال داده از Docker Desktop (یک‌بار)

```bash
# ── دیتابیس ──
# ۱) dump از داکر قدیمی (تا وقتی هنوز نصب است):
docker compose -f docker-compose.dev.yml exec -T postgres pg_dump -U sinshin -d sinshin > backup.sql
# ۲) استک podman را بالا بیاور (حجم تازه ساخته می‌شود)، بعد restore:
podman compose -f compose.dev.yml exec -T postgres psql -U sinshin -d sinshin < backup.sql

# ── آپلودها (تولید) ──
docker cp sinshin-api:/data/uploads ./uploads-backup
podman volume create sinshin_uploads_data
# راه ساده‌تر: بعد از up استک، یک‌بار کپی داخل کانتینر:
podman cp ./uploads-backup/. sinshin-api:/data/uploads/
```

اگر داده‌ی مهم نداری، کل این بند را رد کن — استک تازه با migrate/seed خودش بالا می‌آید.

---

## ۶) رفع اشکال سریع

| نشانه | علت/راه‌حل |
|---|---|
| `unauthorized: authentication required` هنگام pull | میرور پاسخ 401 می‌دهد ولی token نمی‌دهد → میرور را عوض کن (بند ۲) |
| pull اصلاً شروع نمی‌شود / timeout | registries.conf داخل **ماشین** نوشته نشده یا machine ری‌استارت نشده |
| `api:3000` در Caddy resolve نمی‌شود | podman-compose بدون `--in-pod=false` اجرا شده → راه الف یا فلگ |
| bind mount روی ویندوز کند است / HMR نمی‌آید | فایل‌ها روی درایو ویندوزند؛ حالت «فقط زیرساخت + اپ روی سیستم» (بند ۳) یا کلون داخل WSL |
| خطای پورت ۸۰ اشغال | چیزی روی ۸۰ ویندوز/لینوکس است (IIS؟) → آزادش کن یا `ports` را موقتاً عوض کن |
| `podman compose` می‌گوید provider پیدا نمی‌شود | باینری docker-compose در PATH نیست (بند ۱ راه الف) |

---

## ۷) خلاصه‌ی تغییرات این مهاجرت در مخزن

| فایل | تغییر |
|---|---|
| `apps/api/Dockerfile` ، `apps/web/Dockerfile` | `FROM docker.io/oven/bun:...` (نام کامل) + حذف `# syntax=docker/dockerfile:1` |
| `docker-compose.yml` → `compose.yml` | تغییر نام + ایمیج‌های docker.io کامل + `x-podman.in_pod: false` + کامنت‌ها |
| `docker-compose.dev.yml` → `compose.dev.yml` | همان درمان |
| `apps/api/scripts/test-phase*.ps1` | `docker compose` → `podman compose` |
| `apps/api/.env.example` | به‌روزرسانی دستورها در کامنت‌ها |
| `README.md` | بخش اجرای Podman |
| `PODMAN.md` | همین سند |

`.dockerignore`، `Caddyfile`، و هر دو Dockerfile از نظر **منطق** دست‌نخورده‌اند —
فقط رجیستری/نام‌گذاری. یعنی اگر فردا خواستی به docker برگردی، فقط نام فایل‌ها و
اسم رجیستری‌ها را برمی‌گردانی.



------------------------------



سین‌شین فودپارک (Sinshin Foodpark)
اپلیکیشن سفارش غذا — تک‌سرور، غیرمیکروسرویس، تیم کوچک.

یک فایل کامپوز برای کل استک؛ نه فایل جدا برای هر اپ، نه شبکه‌ی دستی، نه پیش‌نیاز پنهان.

معماری
اینترنت ──▶ caddy (TLS) ──▶ web ← فرانت TanStack Start (SSR)
└──▶ api ← بک‌اند Elysia + Bun (مسیر /api/*)
├──▶ postgres 18.6
└──▶ redis

اجرا با Podman
کامل این مهاجرت در PODMAN.md است (نصب ویندوز/لینوکس، میرور Docker Hub،
رفع گوتچاها). خلاصه‌ی دستورات:

استک کامل (تولید):

    podman compose up -d

محیط توسعه (فقط زیرساخت؛ اپ‌ها با bun روی خود سیستم):

    podman compose -f compose.dev.yml up -d postgres redis

seed (صریح، یک‌بار):

    podman compose --profile seed run --rm seed

نکته: docker-compose روی این پروژه با podman هم قابل اجراست
(podman compose) — فایل‌های compose.yml و compose.dev.yml
برای هر دو سازگارند.
