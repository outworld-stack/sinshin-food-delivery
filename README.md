# ═══════════════════════════════════════════════════════════════
# round-50 — sinshin-food-delivery — فایل 1 از 10
# مسیر مقصد: README.md
# وضعیت: جایگزینی کامل فایل موجود
# کامیت پیشنهادی: stage forty-four
# ═══════════════════════════════════════════════════════════════
# سین‌شین — راهنمای اجرا و استقرار

> دو مسیر داری: **توسعه** (بخش ۱) و **استقرار روی سرور ابری** (بخش ۲).
> بخش استقرار دقیقاً همان **پانزده گامِ پنل** است — شماره‌ها یکی‌اند،
> گام به گام از بالا به پایین، بدون پرش.
> جدول‌های کامل متغیرها، رفع اشکال‌های کمتر رایج و تیونینگ: `docs/REFERENCE.md`

---

## ۰) سایت از چه ساخته شده؟ (یک دقیقه)

    اینترنت ──▶ caddy (TLS خودکار) ──▶ web (فرانت SSR) + api (بک‌اند)
                        ├──▶ postgres ├──▶ redis └──▶ translator (اختیاری)

- **caddy** تنها سرویسی است که از بیرون دیده می‌شود (پورت 80 و 443) —
  گواهی HTTPS را خودکار می‌گیرد و تمدید می‌کند.
- **web** و **api** و بقیه فقط داخل شبکه‌ی داکرند.
- سایت PWA است (نصب روی موبایل) — به‌صورت خودکار build می‌شود.
- **روی سرور فقط یک فایل کانفیگ داری: `.env` ریشه.** فایل‌های env داخل
  `apps/` مالِ اجرای بدون داکر روی سیستم توسعه‌اند و در تولید به هیچ
  کاری نمی‌آیند (شرح کامل: REFERENCE بخش ۱).

---

## ۱) توسعه — روی سیستم خودت

حالت پیشنهادی: زیرساخت (پستگرس + ردیس) داخل داکر، اپ‌ها با `bun`.

### ۱-۱) پیش‌نیازها

| ابزار | نصب |
|---|---|
| Bun ≥ 1.3 | لینوکس/مک: `curl -fsSL https://bun.sh/install \| bash` |
| Docker (با compose v2) | ویندوز/مک: Docker Desktop — لینوکس: همان دستور نصب گام ۳ بخش ۲ |
| Git | — |

### ۱-۲) کد و وابستگی‌ها

```bash
git clone <آدرس ریپوی شما>
cd sinshin-food-delivery
bun install
```

### ۱-۳) دیتابیس و ردیس

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres redis
docker compose -f docker-compose.dev.yml ps     # هر دو باید healthy باشند
```

> اگر قبلاً با نسخه‌های قدیمی بالا آورده بودی: یک‌بار
> `docker compose -f docker-compose.dev.yml down -v` و دوباره بالا بیاور.
> اعتبارنامه‌ی دِو ثابت است: `sinshin / sinshin_local / db: sinshin` روی `127.0.0.1:5432`؛
> ردیس بدون پسورد روی `127.0.0.1:6379`.

### ۱-۴) کانفیگ API

```bash
cp apps/api/.env.example apps/api/.env
```

پیش‌فرض‌ها برای دِو آماده‌اند (پیامک console، درگاه mock). فقط دو خط ارزش
عوض‌دادن دارند: `JWT_SECRET` (با `openssl rand -base64 48`) و
`SUPER_ADMIN_PHONES` (شماره‌ی خودت).

### ۱-۵) جدول‌ها و داده‌ی نمونه

```bash
cd apps/api
bun run db:migrate
bun run db:seed        # اختیاری — فقط بار اول
```

### ۱-۶) اجرا

```bash
# پنجره‌ی اول:
cd apps/api && bun run dev      # API روی 3000

# پنجره‌ی دوم:
cd apps/web && bun run dev      # سایت روی 3001
```

باز کن **http://localhost:3001** — کد OTP در لاگ API چاپ می‌شود
(`SMS_PROVIDER=console`). اگر گیر کردی: REFERENCE بخش ۲ (جدول رفع اشکال دِو).

---

## ۲) استقرار روی سرور — پانزده گام صفر تا صد

> از یک سرور خالی شروع می‌کنیم و به سایتی با دامنه، HTTPS، پرداخت واقعی
> و **استقرار خودکار (CI/CD با گیتا)** می‌رسیم. کد هیچ‌وقت از گیت‌هاب
> کلون نمی‌شود — از سیستم خودت مستقیم به گیتای روی سرورت push می‌شود.
>
> کالیبره برای سرور **۴ هسته / 8GB رم / 40GB دیسک** (Ubuntu 24.04).

### گام ۱ — سرور بخر

- هر ابری که IP عمومی و دسترسی کامل root بدهد (آراز، پارس‌پک، لیارا،
  ابر زس، هتزنر، …) — **Ubuntu Server 24.04 LTS**.
- حداقل قابل‌قبول 2c/4GB (بدون مترجم)؛ توصیه 4c/8GB/40GB.
- خروجی این گام: یک **IP عمومی** که با `ssh root@<IP>` وصل می‌شوی.

### گام ۲ — وصل شو و ببند (فایروال)

```bash
ssh root@<IP>

apt update && apt upgrade -y
timedatectl set-timezone Asia/Tehran

apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp        # سایت
ufw allow 443/tcp       # سایت (HTTPS)
ufw allow 3000/tcp      # رابط وب گیتا
ufw allow 2222/tcp      # push با SSH به گیتا
ufw --force enable
ufw status              # ← باید همین پنج قانون را ببینی
```

### گام ۳ — Docker و میرور

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version   # ← باید v2 بدهد

# میرور (برای ایران) + مهار لاگ — همیشه لازم:
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.mobinhost.com"],
  "insecure-registries": ["docker.mobinhost.com"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

docker pull redis:8-alpine   # ← باید بدون خطا از میرور بیاید
```

> اگر یک روز میرور مرد فقط همین فایل را عوض کن (نکته‌ها: REFERENCE بخش ۳).

### گام ۴ — گیتا را بالا بیاور (مخزن کد روی سرور خودت)

فایل‌های استک گیتا داخل ریپویند؛ فقط همان پوشه را از سیستم خودت بفرست:

```bash
# روی سیستم خودت (در ریشه‌ی ریپو):
scp -r deploy/gitea root@<IP>:/root/gitea-setup

# روی سرور:
cd /root/gitea-setup
cp .env.example .env
nano .env               # فقط SERVER_IP را بگذار

docker compose up -d gitea
```

حالا در مرورگر خودت: **http://<IP>:3000**

1. فرم اولیه → نام کاربری انتخاب کن (مثلاً `sinshin`) و ابرمدیر بساز.
2. علامت **+** (بالا-راست) → ریپوی جدید:
   نام `sinshin-food-delivery` — **خصوصی** — «Initialize» را نزن (خالی بساز).

باید ببینی: ریپوی خالی با راهنمای push.

### گام ۵ — رانر CI/CD را ثبت کن

در پنل گیتا: **مدیریت سایت (Site Administration) ← Actions ← Runners ←
Create new registration token** — توکن را کپی کن و روی سرور:

```bash
cd /root/gitea-setup
nano .env               # توکن را در GITEA_RUNNER_REGISTRATION_TOKEN بگذار
docker compose up -d    # رانر هم بالا می‌آید
docker compose logs runner --tail 20
```

باید ببینی در لاگ `Runner registered successfully` و در پنل گیتا رانرِ
`sinshin-deploy` با وضعیت **Idle**.

### گام ۶ — کد را برسان (push از سیستم خودت + کلون روی سرور)

اول یک‌بار کلید SSH سیستم خودت را به گیتا بشناسان:

```bash
# روی سیستم خودت:
ssh-keygen -t ed25519            # اگر کلید نداری (Enter ×3)
cat ~/.ssh/id_ed25519.pub        # ← این را کپی کن
```

در پنل گیتا: **Settings ← SSH / GPG Keys ← Add Key**. بعد:

```bash
# روی سیستم خودت (در ریشه‌ی ریپو):
git remote add gitea ssh://git@<IP>:2222/<نام‌کاربری>/sinshin-food-delivery.git
git push gitea main               # بار اول fingerprint را yes کن
```

حالا یک توکن فقط-خواندن برای کلون روی سرور: در پنل گیتا
**Settings ← Applications ← Generate new token** (دسترسی repository — read).

```bash
# روی سرور:
git clone http://<نام‌کاربری>:<توکن>@localhost:3000/<نام‌کاربری>/sinshin-food-delivery.git /opt/sinshin-food-delivery

# کانفیگ استک گیتا را به جای دائمی‌اش ببر:
mkdir -p /opt/sinshin-food-delivery/deploy/gitea
cp /root/gitea-setup/.env /opt/sinshin-food-delivery/deploy/gitea/.env
```

> از این به بعد استک گیتا را از `/opt/sinshin-food-delivery/deploy/gitea`
> بالا/پایین کن؛ پوشه‌ی `/root/gitea-setup` دیگر لازم نیست.
>
> نکته: آن push اول در Actions یک اجرای ناموفق می‌سازد با پیام «کد هنوز
> در /opt کلون نشده» — طبیعی است؛ استقرار واقعی از گام ۹.

### گام ۷ — دامنه و DNS

در پنل ثبت‌کننده‌ی دامنه فقط دو رکورد:

```
نوع: A       نام: @     مقدار: <IP سرور>
نوع: CNAME   نام: www   مقدار: @
```

تست (روی سیستم خودت، چند دقیقه بعد):

```bash
nslookup www.sinshin-foodpark.ir     # ← باید IP سرور را بدهد
```

> گواهی HTTPS را caddy بعد از گام ۹ خودش می‌گیرد و تمدید می‌کند.

### گام ۸ — فایل `.env` تولید

```bash
cd /opt/sinshin-food-delivery
cp .env.example .env
nano .env
```

دو رمز بساز و بگذار:

```bash
openssl rand -base64 24     # ← POSTGRES_PASSWORD (و همان داخل DATABASE_URL)
openssl rand -base64 48     # ← JWT_SECRET
```

| خط | چی بگذارم |
|---|---|
| `DOMAIN` / `APEX_DOMAIN` | دامنه‌ی خودت با `www` / بدون `www` (بدون `https://`) |
| `ACME_EMAIL` | **ایمیل واقعی تو** — هشدارهای گواهی به همین می‌آید |
| `POSTGRES_PASSWORD` + `DATABASE_URL` | همان رمز بالا، هر دو جا |
| `JWT_SECRET` | خروجی openssl بالا |
| `SUPER_ADMIN_PHONES` | شماره‌های خودت (با کاما) |
| `SMS_PROVIDER=real` + `SMS_BASE_URL` + `SMS_API_KEY` + `SMS_SENDER` | درگاه پیامکت |
| `GATEWAY_MODE=direct` + کلید درگاه‌ها (زرین‌پال / پی‌ایر / سامان / ملت — هر کدام داری) | از پنل بانک |
| `VITE_NESHAN_API_KEY` | کلید نقشه (اختیاری — خالی = فرم مختصات دستی) |

> ⚠ **پیامک را قبل از اولین بالا آوردن کامل کن** — ورود با OTP است؛
> در تولید `SMS_PROVIDER=console` بوت را می‌کشد و بدون پیامکِ real
> نمی‌توانی وارد شوی. بقیه‌ی متغیرها پیش‌فرض درست دارند (جدول کامل:
> REFERENCE بخش ۴).

### گام ۹ — اولین استقرار

```bash
cd /opt/sinshin-food-delivery
docker compose up -d --build
```

- نام فایل `docker-compose.yml` است — بدون `-f` کار می‌کند.
- ترتیب خودکار است: postgres ← migrate (یک‌بار) ← api ← web ← caddy.
- اولین بیلد کند است (ایمیج‌ها + وابستگی‌ها)؛ دفعات بعد با کش سریع.

بعد از بالا آمدن، داده‌ی نمونه (اختیاری):

```bash
docker compose --profile seed run --rm seed
```

### گام ۱۰ — راستی‌آزمایی

```bash
docker compose ps                       # همه healthy/running
curl -s localhost/api/health            # {"status":"ok"}
docker compose logs caddy --tail 50     # بدون خطای ACME
```

روی سیستم خودت:

```bash
curl -sI https://www.sinshin-foodpark.ir      # HTTP/2 200
curl -sI https://sinshin-foodpark.ir          # 301 به www
```

و مرورگر: سایت باز شود، منو و محصولات دیده شوند. اگر گواهی نیامد:
رکورد A هنوز propagate نشده یا پورت 80 بسته — گام ۷ و لاگ caddy.

### گام ۱۱ — اولین ورود

- **https://www.sinshin-foodpark.ir/login** → شماره‌ی `SUPER_ADMIN_PHONES` →
  کد پیامکی می‌آید → ورود. همان شماره‌ها خودکار **ابرمدیر** می‌شوند و
  `/admin` برایشان باز است.
- پنل مشتری: `/dashboard` — پنل پیک: `/courier/login` (فعال‌سازی از ادمین).

### گام ۱۲ — درگاه پرداخت (تست روی دِو، بعد کلید واقعی)

**تست بدون پول روی سیستم توسعه‌ات** (این سوییچ‌ها در production بوت را
می‌کُشند — عمدی، تا پرداخت آزمایشی به کاربر واقعی نرسد):

| درگاه | روش تست (فقط دِو) |
|---|---|
| زرین‌پال | `ZARINPAL_SANDBOX=true` — سندباکس رسمی، مرچنت هر UUID |
| پی‌ایر | `PAYIR_API_KEY=test` — درگاه شبیه‌سازی‌شده |
| سامان / ملت | سندباکس عمومی ندارند — ترمینال تستی بانک |
| همه | `GATEWAY_MODE=mock` — درگاه داخلی کامل |

جریان را در دِو تا آخر برو: سفارش ← پرداخت ← برگشت به سایت ← وضعیت
PAID ← بازگشت وجه از پنل ادمین.

**بعد روی سرور**: کلیدهای واقعی را در `.env` بگذار و
`docker compose up -d`. یک سفارش واقعی کوچک بزن، وضعیت PAID را ببین و
وجهش را از پنل برگردان — این تستِ نهاییِ زنده است. (آدرس سایتت را هم
در پنل زرین‌پال ثبت کن تا callback رد نشود — شرح: REFERENCE بخش ۵).

### گام ۱۳ — استقرار خودکار را روشن کن (CI/CD)

از این به بعد هر push به main یعنی استقرار. تستش کن:

```bash
# روی سیستم خودت:
git commit --allow-empty -m "ci: test"
git push gitea main
```

در پنل گیتا: ریپو ← **Actions** — باید job سبز شود. آن کارها را می‌کند:
کد `/opt` به آخرین کامیت می‌رسد ← `docker compose up -d --build` ←
سلامت‌سنجی (تا `/api/health` جواب ندهد سبز نمی‌شود).

> به‌روزرسانی روزمره از این پس فقط `git push gitea main` است.
> اگر خواستی دستی: `cd /opt/sinshin-food-delivery && git pull && docker compose up -d --build`

### گام ۱۴ — بکاپ و بازیابی

بکاپ هر شب خودکار است (ساعت `BACKUP_HOUR` پیش‌فرض ۵ بامداد تهران،
نگهداری `BACKUP_KEEP=7` نسخه):

```bash
# فهرست بکاپ‌ها:
docker exec sinshin-backup ls /backups

# بازیابی یک نسخه (داده‌های فعلی را می‌پوشاند — فقط برای فاجعه/آزمایش):
gunzip -c sinshin-....sql.gz | docker exec -i sinshin-postgres psql -U sinshin -d sinshin
```

### گام ۱۵ — نگهداری، امنیت و به‌روزرسانی

| کار | دستور |
|---|---|
| وضعیت سرویس‌ها | `docker compose ps` |
| لاگ زنده | `docker compose logs -f api --tail 100` |
| ورود به کانتینر | `docker exec -it sinshin-api sh` |
| ری‌استارت یک سرویس | `docker compose restart api` |
| اعمال تغییر `.env` | `docker compose up -d` (با `VITE_NESHAN_API_KEY`: `--build web`) |
| توقف کل استک (داده‌ها می‌مانند) | `docker compose down` |
| دیسک | `docker system df` |

امنیت‌های تکمیلی (وقتی سایت پایدار شد):

- `HSTS_ENABLED=true` در ‎.env و `docker compose up -d caddy`.
- HTTPS برای **پنل گیتا**: رکورد `git` بساز و بلوک کامنت‌شده‌ی انتهای
  Caddyfile را فعال کن (چهار قدم، همان‌جا نوشته).
- `SWAGGER_ENABLED` را `false` نگه دار (پیش‌فرض است).

---

## اگر گیر کردی

| نشانه | راه‌حل سریع |
|---|---|
| api بالا نمی‌آید و می‌کشد | `docker compose logs api` — یکی از متغیرهای گام ۸ ناقص است (fail-fast عمدی) |
| رانر در Actions دیده نمی‌شود | گام ۵: توکن در `.env` گیتا + `docker compose logs runner` |
| push به گیتا `Permission denied` | کلید SSH اضافه شده؟ (گام ۶) — آدرس پورت 2222 است؟ |
| گواهی TLS صادر نشد | DNS گام ۷ propagate شده؟ پورت 80 باز است؟ |
| بیلد روی `bun install` می‌ماند | شبکه — `bunfig.toml` و راه‌حل میرور npm: REFERENCE بخش ۶ |
| بقیه‌ی موارد | REFERENCE بخش ۶ — جدول کامل نشانه/راه‌حل دِو و تولید |
