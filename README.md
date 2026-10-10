# ═══════════════════════════════════════════════════════════════
# stage-57 — sinshin-food-delivery — فاز دیپلوی
# مسیر مقصد: README.md
# وضعیت: جایگزینی کامل فایل موجود
# کامیت پیشنهادی: stage fifty-seven
# ═══════════════════════════════════════════════════════════════

# سین‌شین — راهنمای صفر تا صد: اجرا، استقرار، CI/CD و عملیات سرور

> این سند سه بخش دارد:
>
> | بخش | برای چه کسی |
> |---|---|
> | **۱) توسعه** | روی سیستم خودت، بدون داکر برای اپ‌ها |
> | **۲) استقرار صفر تا صد** | روی سرور ابری — ۱۶ گام پیوسته، بدون پرش |
> | **۳) کتاب دستورات سرور** | نگهداشت، تعمیر و افزودن چیزهای جدید |
>
> جدول‌های کامل متغیرها، رفع اشکال‌های کمتر رایج و تیونینگ: **`docs/REFERENCE.md`**
>
> **کالیبره برای سرور شما:** ۸ هسته / ۱۶ گیگابایت رم / Ubuntu Server 24.04 LTS
> با دیسک اصلی ۴۰ گیگابایت HDD (سیستم‌عامل) + دیسک جدا ۶۰ گیگابایت SSD.
> **کل سایت روی SSD اجرا می‌شود؛ بکاپ و موارد آرشیوی روی HDD.**

---

## ۰) سایت از چه ساخته شده؟ (یک دقیقه)

    اینترنت ──▶ caddy (TLS خودکار) ──▶ web (فرانت SSR) + api (بک‌اند)
                        ├──▶ postgres ├──▶ redis └──▶ translator (مترجم آفلاین)

- **caddy** تنها سرویسی است که از بیرون دیده می‌شود (پورت 80 و 443) —
  گواهی HTTPS را خودکار می‌گیرد و تمدید می‌کند (بند گام ۱۱).
- **web** و **api** و بقیه فقط داخل شبکه‌ی داکرند؛ هیچ پورت دیگری باز نیست.
- **gitea** + **runner** (استک CI/CD) جدا از استک اصلی اجرا می‌شوند — مخزن کد
  و استقرار خودکار روی خودِ سرور، بدون هیچ سرویس بیرونی (گام ۴ و ۵).
- **backup** هر شب `pg_dump` می‌گیرد و روی HDD می‌نویسد (گام ۱۵).
- سایت PWA است (نصب روی موبایل) و به‌صورت خودکار build می‌شود.
- **روی سرور فقط دو فایل کانفیگ داری: `.env` ریشه (استک اصلی) و
  `deploy/gitea/.env` (استک گیتا).** فایل‌های env داخل `apps/` مالِ اجرای
  بدون داکر روی سیستم توسعه‌اند و در تولید به هیچ کاری نمی‌آیند.

### ۰-ب) نقشه‌ی دیسک‌های شما — چیزی که «SSD» است و چیزی که «HDD»

| کجا | چی | چرا |
|---|---|---|
| **SSD 60GB** → `/srv/ssd/docker` | data-root داکر: همه‌ی ایمیج‌ها، کانتینرها، کش بیلد و **همه‌ی volumeها** (دیتابیس، ردیس، آپلودها، گواهی‌های TLS، دیتای گیتا) | دیتابیس و آپلود و build = پرکارترین داده‌ها → روی سریع‌ترین دیسک |
| **SSD** → `/srv/ssd/sinshin/food-delivery` | کد پروژه (کلون گیت) | بیلد و git روی SSD؛ دسترسی همیشه با مسیر استاندارد `/opt/sinshin-food-delivery` (symlink) |
| **HDD 40GB** (دیسک سیستم) → `/srv/hdd/sinshin/backups` | بکاپ شبانه‌ی دیتابیس + آرشیو | آرشیو نوشتنِ کم و خواندنِ کمتر دارد — HDD کامل جواب می‌دهد و SSD خالی می‌ماند برای کار روزمره |
| **HDD** → بقیه | Ubuntu، باینری داکر، لاگ سیستم | رفتار پیش‌فرض سیستم‌عامل |

> حجم تقریبی پس از اولین استقرار کامل: ایمیج‌ها و volumeها حدود ۸ تا ۱۲
> گیگابایت روی SSD؛ هر بکاپ فشرده چند مگابایت روی HDD. با 60GB SSD و
> 40GB HDD برای سال‌ها فضا داری.

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

> اعتبارنامه‌ی دِو ثابت است: `sinshin / sinshin_local / db: sinshin` روی `127.0.0.1:5432`؛
> ردیس بدون پسورد روی `127.0.0.1:6379`. اگر volume قدیمی با پسورد دیگری
> داری: `docker compose -f docker-compose.dev.yml down -v` و دوباره بالا بیاور.

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
bun run db:seed            # داده‌ی نمونه‌ی توسعه (اختیاری — فقط بار اول)
```

### ۱-۶) اجرا

```bash
# پنجره‌ی اول:
cd apps/api && bun run dev      # API روی 3000

# پنجره‌ی دوم:
cd apps/web && bun run dev      # سایت روی 3001
```

باز کن **http://localhost:3001** — کد OTP در لاگ API چاپ می‌شود
(`SMS_PROVIDER=console`). اگر گیر کردی: REFERENCE بخش ۴ (جدول رفع اشکال دِو).

> **سید دیپلوی را روی دِو هم می‌توانی امتحان کنی** (همان دیتایی که در تولید
> استفاده می‌شود — گام ۱۰):
> `cd apps/api && bun run db:seed:deploy`

---

## ۲) استقرار روی سرور — شانزده گام صفر تا صد

> از یک سرور خالی شروع می‌کنیم و به سایتی با دامنه، HTTPS، پرداخت واقعی،
> بکاپ شبانه روی HDD و **استقرار خودکار (CI/CD با گیتا)** می‌رسیم.
> کد هیچ‌وقت از گیت‌هاب کلون نمی‌شود — از سیستم خودت مستقیم به گیتای
> روی سرورت push می‌شود.
>
> **خلاصه‌ی نقشه‌ی راه (قبل از شروع، یک‌بار بخوان):**

| گام | کار | خروجی |
|---|---|---|
| ۱ | اتصال، آپدیت، فایروال | سرور سخت‌افزاری امن |
| ۲ | سوار کردن SSD + پوشه‌ی بکاپ روی HDD | `/srv/ssd` و `/srv/hdd` آماده |
| ۳ | داکر با data-root روی SSD | داکر که همه‌چیزش روی SSD است |
| ۴ | گیتا بالا | مخزن کد خصوصی روی سرور خودت |
| ۵ | رانر CI/CD ثبت | موتور استقرار خودکار |
| ۶ | push کد + کلون روی SSD | کد در `/opt/sinshin-food-delivery` |
| ۷ | DNS | دامنه + زیردامنه‌ی git به IP سرور |
| ۸ | `.env` تولید | همه‌ی رمزها و کلیدها |
| ۹ | اولین استقرار | استک کامل بالا |
| ۱۰ | سید دیپلوی | قوانین + منو + محتوای اولیه |
| ۱۱ | HTTPS/SSL | گواهی caddy + تست |
| ۱۲ | راستی‌آزمایی + اولین ورود | سایت واقعاً کار می‌کند |
| ۱۳ | درگاه پرداخت | پول واقعی جابه‌جا می‌شود |
| ۱۴ | CI/CD روشن | هر push = استقرار خودکار |
| ۱۵ | بکاپ و بازیابی | آرشیو شبانه روی HDD |
| ۱۶ | امنیت تکمیلی | قفل‌های نهایی |

### گام ۱ — وصل شو و ببند (فایروال)

```bash
ssh root@<IP>

apt update && apt upgrade -y
timedatectl set-timezone Asia/Tehran

apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp        # سایت + صدور گواهی (ACME)
ufw allow 443/tcp       # سایت (HTTPS)
ufw allow 2222/tcp      # git push با SSH به گیتا
ufw --force enable
ufw status              # ← باید همین چهار قانون را ببینی
```

> **پورت 3000 را باز نکن.** رابط وب گیتا فقط روی `127.0.0.1:3000` گوش
> می‌دهد و از پشت caddy با HTTPS سرو می‌شود (گام ۱۱). باز بودن پورتش
> هم بی‌فایده است هم حفره.

### گام ۲ — SSD را سوار کن و خانه‌ی بکاپ را روی HDD بساز

SSD شما دیسک جدا است (سیستم‌عامل روی HDD است و سوار شده). اول پیداکن:

```bash
lsblk -o NAME,SIZE,TYPE,FROTAB,MOUNTPOINTS
```

دیسک ۶۰ گیگابایتیِ بدون mount (معمولاً `/dev/sdb` یا `/dev/vdb`) همان SSD
است. **حتماً مطمئن شو دیسکِ سیستم‌عامل (که `/` روی آن است) را انتخاب
نمی‌کنی.**

```bash
# ⚠ فقط و فقط دیسک SSD — جای /dev/sdb نام دیسکِ خودت را بگذار:
wipefs -a /dev/sdb                       # پاک‌کردن امضاهای فایل‌سیستم قدیمی (اگر بود)
mkfs.ext4 -L sinshin-ssd /dev/sdb        # فرمت ext4

# سوار کردن دائمی با UUID (مقاوم به تغییر نام دیسک):
SSD_UUID=$(blkid -s UUID -o value /dev/sdb)
mkdir -p /srv/ssd
echo "UUID=$SSD_UUID /srv/ssd ext4 defaults,noatime 0 2" >> /etc/fstab
mount /srv/ssd

# خانه‌ی بکاپ روی HDD (دیسک سیستم — سوار است، فقط پوشه می‌سازیم):
mkdir -p /srv/hdd/sinshin/backups

# ساختار SSD:
mkdir -p /srv/ssd/sinshin /srv/ssd/docker

# راستی‌آزمایی:
df -h /srv/ssd                     # ← باید ~55G available بدهد
echo test > /srv/ssd/.ok && cat /srv/ssd/.ok && rm /srv/ssd/.ok

# TRIM هفتگی برای عمر SSD (در ۲۴.۰۴ از قبل فعال است — این فقط مطمئن می‌شود):
systemctl enable --now fstrim.timer && systemctl status fstrim.timer --no-pager
```

> `noatime` = سیستم‌عامل زمان آخرین خواندن فایل‌ها را نمی‌نویسد → عمر SSD
> و سرعت بیشتر.
>
> **آزمون بوت (مهم):** یک‌بار `reboot` بزن و بعد از بالا آمدن `df -h /srv/ssd`
> را چک کن — اگر سوار نشده بود، خط fstab را با `mount -a` و لاگ
> `journalctl -u local-fs` بررسی کن. (فقط بعد از رفع، ادامه بده.)

### گام ۳ — Docker با data-root روی SSD

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# همه‌ی داده‌ی داکر → SSD + میرور (برای ایران) + مهار لاگ:
cat > /etc/docker/daemon.json <<'EOF'
{
  "data-root": "/srv/ssd/docker",
  "registry-mirrors": ["https://docker.mobinhost.com"],
  "insecure-registries": ["docker.mobinhost.com"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

# راستی‌آزمایی — این سه خط باید درست جواب بدهند:
docker info | grep -i "docker root dir"     # ← Docker Root Dir: /srv/ssd/docker
docker compose version                      # ← v2
docker pull redis:8-alpine                  # ← دانلود از میرور بدون خطا
```

> اگر یک روز میرور مرد فقط URL داخل `daemon.json` را عوض کن و
> `systemctl restart docker` بزن (نکته‌ها: REFERENCE بخش ۶).
> سقف لاگ هر کانتینر ۳۰ مگابایت (۳×۱۰) است — دیسک هیچ‌وقت از لاگ پر نمی‌شود.

### گام ۴ — گیتا را بالا بیاور (مخزن کد روی سرور خودت)

فایل‌های استک گیتا داخل ریپویند؛ از سیستم خودت بفرست:

```bash
# روی سیستم خودت (در ریشه‌ی ریپو):
scp -r deploy/gitea root@<IP>:/root/gitea-setup

# روی سرور:
cd /root/gitea-setup
cp .env.example .env
nano .env               # GIT_DOMAIN را بگذار (مثلاً git.sinshin-foodpark.ir)

docker compose -f docker-compose.yml up -d gitea
docker compose -f docker-compose.yml ps       # gitea باید running باشد
```

رابط وب گیتا از بیرون بسته است (فقط `127.0.0.1:3000`). برای اولین
راه‌اندازی از سیستم خودت یک **تونل SSH** باز کن:

```bash
# روی سیستم خودت — پنجره‌ی تونل (باز نگه دار):
ssh -N -L 3000:127.0.0.1:3000 root@<IP>
```

حالا در مرورگر خودت: **http://localhost:3000**

1. فرم اولیه → نام کاربری انتخاب کن (مثلاً `sinshin`) و ابرمدیر بساز.
2. علامت **+** (بالا-راست) → ریپوی جدید:
   نام `sinshin-food-delivery` — **خصوصی** — «Initialize» را نزن (خالی بساز).

> بعد از راه‌اندازی کامل (گام ۱۱)، پنل گیتا با HTTPS روی
> `https://git.sinshin-foodpark.ir` باز می‌شود و تونل دیگر لازم نیست.

### گام ۵ — رانر CI/CD را ثبت کن

در پنل گیتا: **مدیریت سایت (Site Administration) ← Actions ← Runners ←
Create new registration token** — توکن را کپی کن و روی سرور:

```bash
cd /root/gitea-setup
nano .env               # توکن را در GITEA_RUNNER_REGISTRATION_TOKEN بگذار
docker compose -f docker-compose.yml up -d    # رانر هم بالا می‌آید
docker compose -f docker-compose.yml logs runner --tail 20
```

باید در لاگ `Runner registered successfully` ببینی و در پنل گیتا (از طریق
تونل) رانرِ `sinshin-deploy` با وضعیت **Idle**.

> رانر با برچسب `deploy` و `capacity: 1` تنظیم شده — هر بار فقط یک استقرار
> اجرا می‌شود تا دو deploy هم‌زمان استک را نترکانند. ابزارهای لازم (docker
> و compose و curl و git) داخل ایمیجش نصب است.

### گام ۶ — کد را برسان (push از سیستم خودت + کلون روی SSD)

اول یک‌بار کلید SSH سیستم خودت را به گیتا بشناسان (پنل از طریق تونل):
**Settings ← SSH / GPG Keys ← Add Key**:

```bash
# روی سیستم خودت:
ssh-keygen -t ed25519            # اگر کلید نداری (Enter ×3)
cat ~/.ssh/id_ed25519.pub        # ← این را کپی کن و در پنل گیتا Add کن
```

بعد push:

```bash
# روی سیستم خودت (در ریشه‌ی ریپو):
git remote add gitea ssh://git@<IP>:2222/<نام‌کاربری>/sinshin-food-delivery.git
git push gitea main               # بار اول fingerprint را yes کن
```

حالا یک توکن فقط-خواندن برای کلون روی سرور: در پنل گیتا
**Settings ← Applications ← Generate new token** (دسترسی repository — read).
بعد روی سرور، کلون **مستقیم روی SSD** + مسیر استاندارد `/opt`:

```bash
# روی سرور — کلون روی SSD:
git clone http://<نام‌کاربری>:<توکن>@localhost:3000/<نام‌کاربری>/sinshin-food-delivery.git /srv/ssd/sinshin/food-delivery

# مسیر استاندارد که همه‌ی اسکریپت‌ها/رانر با آن کار می‌کنند (symlink به SSD):
ln -sfn /srv/ssd/sinshin/food-delivery /opt/sinshin-food-delivery
ls /opt/sinshin-food-delivery/docker-compose.yml    # ← باید فایل را ببینی

# کانفیگ استک گیتا را به جای دائمی‌اش ببر:
mkdir -p /opt/sinshin-food-delivery/deploy/gitea
cp /root/gitea-setup/.env /opt/sinshin-food-delivery/deploy/gitea/.env

# از این به بعد استک گیتا را از ریپو بالا/پایین کن؛ /root/gitea-setup لازم نیست:
cd /opt/sinshin-food-delivery/deploy/gitea
docker compose -f docker-compose.yml ps     # ← gitea و runner باید سالم باشند
```

> دیتای گیتا (ریپوها/کاربران) در volume نام‌دار `sinshin_gitea_data` روی SSD
> است — جابه‌جایی پوشه‌ی compose آن را نمی‌ریزد.
>
> نکته: آن push اول در Actions یک اجرای ناموفق می‌سازد با پیام «کد هنوز
> در /opt کلون نشده» — طبیعی است؛ استقرار واقعی از گام ۹/۱۴.

### گام ۷ — دامنه و DNS

در پنل ثبت‌کننده‌ی دامنه **سه رکورد**:

```
نوع: A       نام: @     مقدار: <IP سرور>          ← دامنه‌ی بدون www
نوع: CNAME   نام: www   مقدار: @                   ← دامنه‌ی اصلی سایت
نوع: A       نام: git   مقدار: <IP سرور>          ← پنل گیتا (HTTPS)
```

تست (روی سیستم خودت، چند دقیقه بعد):

```bash
nslookup www.sinshin-foodpark.ir     # ← باید IP سرور را بدهد
nslookup git.sinshin-foodpark.ir     # ← باید IP سرور را بدهد
```

> گواهی HTTPS هر سه را caddy بعد از گام ۹ خودش می‌گیرد و تمدید می‌کند.

### گام ۸ — فایل `.env` تولید

```bash
cd /opt/sinshin-food-delivery
cp .env.example .env
nano .env
```

سه رمز و یک جفت‌کلید بساز:

```bash
# روی سرور:
openssl rand -base64 24     # ← POSTGRES_PASSWORD (و همان داخل DATABASE_URL)
openssl rand -base64 48     # ← JWT_SECRET

# روی سیستم خودت (bun داری) — یا روی سرور با دستور داکری زیر آن:
cd apps/api && bun scripts/generate-vapid-keys.ts
# ↳ دو خط VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY چاپ می‌شود

# اگر روی سرور می‌خواهی (بدون bun):
docker compose --profile seed run --rm --no-deps seed-deploy bun scripts/generate-vapid-keys.ts

# روی سرور — gid گروه داکر (برای گزارش لاگ داکر):
stat -c '%g' /var/run/docker.sock     # ← عددش را در DOCKER_GID بگذار
```

**چیزهایی که حتماً خودت باید بگذاری:**

| خط | چی بگذارم |
|---|---|
| `DOMAIN` / `APEX_DOMAIN` | دامنه‌ی خودت با `www` / بدون `www` (بدون `https://`) |
| `ACME_EMAIL` | **ایمیل واقعی تو** — هشدارهای گواهی Let's Encrypt به همین می‌آید |
| `GIT_DOMAIN` | همان زیردامنه‌ی گیتا (مثل `git.sinshin-foodpark.ir`) — **باید عین مقدار `deploy/gitea/.env` باشد** |
| `POSTGRES_PASSWORD` + `DATABASE_URL` | همان رمز openssl، هر دو جا (یوزر/db همان `sinshin` بماند) |
| `JWT_SECRET` | خروجی openssl بالا |
| `SUPER_ADMIN_PHONES` | شماره‌های خودت (با کاما) — این‌ها با اولین ورود ابرمدیر می‌شوند |
| `SMS_PROVIDER=real` + `SMS_IR_API_KEY` + شناسه‌ی قالب‌ها | از پنل SMS.ir (بخش کلیدهای API + قالب‌ها) — IP سرور را در پنل whitelist کن |
| `GATEWAY_MODE=direct` + کلید درگاه | زرین‌پال/پی‌ایر/سامان/ملت — هر کدام داری (جزئیات: REFERENCE بخش ۷) |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | خروجی اسکریپت بالا — پوش نوتیفیکیشن |
| `VITE_NESHAN_MAP_KEY` | کلید web نقشه‌ی نشان (اختیاری — خالی = فرم مختصات دستی) |
| `NESHAN_SERVICE_API_KEY` | کلید service نشان (اختیاری — مسیریابی واقعی) |
| `DOCKER_GID` | عدد `stat` بالا |
| `BACKUP_DIR_HOST` | همان `/srv/hdd/sinshin/backups` (پیش‌فرض درست است — فقط مطمئن شو پوشه هست) |

> ⚠ **پیامک را قبل از اولین بالا آوردن کامل کن** — ورود با OTP است؛
> در تولید `SMS_PROVIDER=console` و `GATEWAY_MODE=mock` بوت را می‌کُشند
> (عمدی — fail-fast تا سایت آزمایشی با درگاه غلط بالا نیاید).
> بقیه‌ی متغیرها پیش‌فرض درست دارند برای ۸ هسته/۱۶ گیگ (جدول کامل و شرح
> تک‌تک: REFERENCE بخش ۲).

### گام ۹ — اولین استقرار

```bash
cd /opt/sinshin-food-delivery
docker compose up -d --build
```

- نام فایل `docker-compose.yml` است — بدون `-f` کار می‌کند.
- ترتیب خودکار است: postgres ← migrate (یک‌بار، قبل از api) ← api ← web ← caddy.
- اولین بیلد کند است (ایمیج‌ها + وابستگی‌ها + دانلود مدل مترجم)؛ دفعات
  بعد با کش BuildKit سریع.

نظارت حین بوت:

```bash
docker compose ps                                  # وضعیت زنده
docker compose logs -f api --tail 50               # لاگ api (Ctrl+C برای خروج)
docker compose logs migrate --tail 30              # نتیجه‌ی مایگریشن‌ها
```

> همه‌ی سرویس‌ها `restart: unless-stopped` دارند — ری‌استارت سرور یعنی
> خودکار بالا آمدن کل استک (بعد از fstab گام ۲).

### گام ۱۰ — داده‌ی اولیه‌ی دیپلوی (seed مخصوص تولید)

استک بالا آمد؛ حالا داده‌ی اولیه را بگذار — یک‌بار، دستی:

```bash
cd /opt/sinshin-food-delivery
docker compose --profile seed run --rm seed-deploy
```

**این سید مخصوص تولید طراحی شده و روی دیتای موجود کاملاً امن است:**

| چی seed می‌شود | جزئیات |
|---|---|
| **قوانین و مقررات نسخه ۲** | همان قوانین نسخه ۱ + بند جدید: «به‌محض ناموجودشدن هر محصول، همان لحظه در سبد خرید و چک‌اوت هم ناموجود می‌شود و پرداخت برای اقلام ناموجود انجام نمی‌شود» — دوزبانه (فارسی + عربی) |
| ساختار منو | ۲ دسته‌ی اصلی (رستوران/فست‌فود) + ۸ دسته |
| منوی پایه | ۱۲ محصول واقعیِ قابل‌ویرایش با **slug انگلیسی سئوپسند** (URLهای تمیز از روز اول)، دوزبانه، بدون آمار جعلی |
| تنظیمات | باز بودن رستوران، مختصات انزلی، دروازه‌ی جغرافیایی ایران |
| نواحی ارسال | ۵/۱۰/۱۵ کیلومتر (۳۵/۵۵/۷۵ هزار تومان) |
| مقالات | ۲ مقاله‌ی کامل دوزبانه (خمیر ایتالیایی + راهنمای برگر) |
| کوپن افتتاحیه | `SINSHIN20` — **غیرفعال** seed می‌شود؛ وقتی خواستی کمپین افتتاحیه بزنی از پنل ادمین فعالش کن |

چیزهایی که **عمداً** seed نمی‌شود: تصاویر (گالری/محصولات — از پنل ادمین
آپلود واقعی کن)، کاربران، سفارش‌ها، پیک‌ها.

دوباره اجرایش هم بی‌ضرر است (idempotent): ردیف‌های موجود دست نمی‌خورند.

> سید «نمونه‌ی توسعه» (`docker compose --profile seed run --rm seed`) همچنان
> موجود است — همان دیتای قدیمی با آمار نمایشی؛ برای تولید از `seed-deploy` استفاده کن.

### گام ۱۱ — HTTPS و SSL با Caddy (دستورات دقیق)

**چطور کار می‌کند؟** caddy در اولین بارگذاری، برای هر دامنه‌ی تعریف‌شده
(`www`، `git`) گواهی Let's Encrypt می‌گیرد (پروتکل ACME از پورت 80/443)،
آن را در volume `sinshin_caddy_data` نگه می‌دارد و **خودکار** قبل از انقضا
تمدید می‌کند. هیچ کرانی برای گواهی نمی‌خواهی.

**صدور گواهی را ببین (چند دقیقه پس از گام ۹):**

```bash
cd /opt/sinshin-food-delivery
docker compose logs caddy --tail 80 | grep -iE "certificate|acme|challenge"
# ← دنبال این باش: certificate obtained successfully ... identifier=www.sinshin-foodpark.ir
# و برای گیتا: identifier=git.sinshin-foodpark.ir
```

**دستورات روزمره‌ی caddy:**

```bash
# اعتبارسنجی کانفیگ (بدون ری‌استارت — بعد از هر تغییر Caddyfile):
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile

# بارگذاری مجدد کانفیگ بدون قطعی سرویس (کمتر از یک ثانیه):
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile

# ری‌استارت کامل (فقط وقت عیب‌یابی):
docker compose restart caddy

# دیدن گواهی‌های صادرشده (داخل volume):
docker compose exec caddy find /data/caddy/certificates -type f -name "*.crt" -exec ls -la {} \;
```

**راستی‌آزمایی از بیرون (روی سیستم خودت):**

```bash
curl -sI https://www.sinshin-foodpark.ir      # ← HTTP/2 200
curl -sI https://sinshin-foodpark.ir          # ← 301 به www
curl -sI https://git.sinshin-foodpark.ir      # ← HTTP/2 200 (پنل گیتا — HTTPS شد)

# سن و انقضای گواهی:
openssl s_client -connect www.sinshin-foodpark.ir:443 -servername www.sinshin-foodpark.ir 2>/dev/null \
  | openssl x509 -noout -dates
```

**اگر گواهی صادر نشد (به این ترتیب چک کن):**

1. DNS: `nslookup www.sinshin-foodpark.ir` از سیستم خودت — باید IP سرور را بدهد (propagate چند دقیقه تا چند ساعت).
2. پورت 80 از بیرون باز است؟ `curl -I http://<IP>` از سیستم خودت باید جواب بگیرد.
3. لاگ: `docker compose logs caddy --tail 100` — خطای ACME با دلیل دقیق (DNS / timeout / rate-limit).
4. **Rate-limit:** اگر چند بار پشت‌سرهم گواهی نگیرد، Let's Encrypt یک ساعت
   کارت را می‌بندد — صبر کن و دستی چیزی نزن؛ caddy خودش دوباره تلاش می‌کند.

**تیزتر شدن امنیت بعد از پایداری (گام ۱۶):** هدر HSTS فقط با
`HSTS_ENABLED=true` در `.env` و `docker compose up -d caddy`.

### گام ۱۲ — راستی‌آزمایی کامل + اولین ورود

```bash
cd /opt/sinshin-food-delivery
docker compose ps                      # همه باید running/healthy باشند
curl -s localhost/api/health           # ← {"status":"ok",...}
```

روی سیستم خودت: سایت را باز کن — منو و ۱۲ محصول سیدشده باید دیده شوند،
صفحه‌ی محصول با آدرس slug تمیز (`/products/pepperoni-pizza`) باز شود.

**اولین ورود:** `https://www.sinshin-foodpark.ir/login` → شماره‌ی
`SUPER_ADMIN_PHONES` → کد پیامکی می‌آد → ورود. همان شماره‌ها خودکار
**ابرمدیر** می‌شوند و `/admin` برایشان باز است.
پنل مشتری: `/dashboard` — پنل پیک: `/courier/login` (فعال‌سازی از ادمین).

از پنل ادمین همین الان: تصویر برای محصولات آپلود کن، قیمت‌ها را با منوی
واقعی خودت هم‌راستا کن، آدرس و درباره‌ما را کامل کن.

### گام ۱۳ — درگاه پرداخت (تست روی دِو، بعد کلید واقعی)

**تست بدون پول روی سیستم توسعه‌ات** (این سوییچ‌ها در production بوت را
می‌کُشند — عمدی، تا پرداخت آزمایشی به کاربر واقعی نرسد):

| درگاه | روش تست (فقط دِو) |
|---|---|
| زرین‌پال | `ZARINPAL_SANDBOX=true` — سندباکس رسمی، مرچنت هر UUID |
| پی‌ایر | `PAYIR_API_KEY=test` — درگاه شبیه‌سازی‌شده |
| سامان / ملت | سندباکس عمومی ندارند — ترمینال تستی بانک |
| همه | `GATEWAY_MODE=mock` — درگاه داخلی کامل |

جریان را در دِو تا آخر برو: سفارش ← پرداخت ← برگشت به سایت ← وضعیت PAID
← بازگشت وجه از پنل ادمین.

**بعد روی سرور:** کلیدهای واقعی را در `.env` بگذار (همان‌هایی که در گام ۸
گذاشتی یا حالا تکمیل کن) و:

```bash
docker compose up -d          # اعمال .env (بدون rebuild)
```

یک سفارش واقعی کوچک بزن، وضعیت PAID را ببین و وجهش را از پنل برگردان —
این تستِ نهاییِ زنده است. (آدرس سایتت را در پنل زرین‌پال ثبت کن تا callback
رد نشود — شرح: REFERENCE بخش ۷.)

### گام ۱۴ — CI/CD را روشن کن (از این به بعد استقرار = push)

هر `git push gitea main` این کارها را **خودکار و پشت‌سرهم** انجام می‌دهد
(فایل `.gitea/workflows/deploy.yml` — رانر روی خود سرورت اجرایش می‌کند):

| قدم workflow | چه می‌کند | دستور کلیدی |
|---|---|---|
| ۱. همگام‌سازی کد | `/opt/sinshin-food-delivery` به آخرین کامیت می‌رسد | `git fetch origin main && git reset --hard origin/main` |
| ۲. دروازه‌ی کیفیت | جلوی رسیدن کد خراب به production | `docker run --rm -v /opt/... oven/bun:1.3.14-slim sh -c "bun install --frozen-lockfile && typecheckها + lint biome"` |
| ۳. بیلد و بالا آوردن | ایمیج‌های تازه build می‌شوند، تگ SHA می‌خورند، استک بالا می‌آید | `docker compose build` → `docker tag sinshin/api:<sha7>` → `docker compose up -d` |
| ۴. سلامت‌سنجی | تا `/api/health` جواب ندهد job سبز نمی‌شود | `curl -fsS http://localhost/api/health` (۱۲ تلاش × ۱۰ ثانیه) |

> نکته‌ی فنی: دروازه‌ی کیفیت داخل ایمیج پین‌شده‌ی `oven/bun:1.3.14-slim`
> اجرا می‌شود (همان ایمیجی که buildهای api/web بر پایه‌ی آن است و از قبل در
> کش داکر هست) — رانر خودش bun ندارد و لازم هم ندارد.

**تستش کن (همین الان):**

```bash
# روی سیستم خودت:
git commit --allow-empty -m "ci: test"
git push gitea main
```

در پنل گیتا (`https://git.sinshin-foodpark.ir`): ریپو ← **Actions** — job
باید سبز شود. اگر قرمز شد، همان‌جا لاگ هر قدم با دلیل دقیق هست
(REFERENCE بخش ۹ — آناتومی کامل).

**از این به بعد روزمره‌ات فقط این است:**

```bash
git add ... && git commit -m "..." && git push gitea main
```

**اگر خواستی دستی (رانر خراب/قطع):**

```bash
cd /opt/sinshin-food-delivery && git pull && docker compose up -d --build
```

**اگر استقرار خراب شد — بازگشت به قبل (rollback):**

هر استقرار موفق روی ایمیج‌ها تگِ ۷کاراکتری SHA کامیت می‌زند:

```bash
cd /opt/sinshin-food-delivery
docker images --format '{{.Repository}}:{{.Tag}}' | grep sinshin/ | sort   # فهرست تگ‌ها
./deploy/rollback.sh            # → آخرین تگِ قبل از «الان»
./deploy/rollback.sh a1b2c3d    # → SHA مشخص
```

rollback ایمیج‌های تگ‌شده را فعال می‌کند (بدون build)، سلامت را چک می‌کند
و اگر جواب نداد صریح می‌گوید. مایگریشن‌های اجراشده خودکار برنمی‌گردند —
برای تغییرات اسکیمای برگشت‌ناپذیر، سازنده‌ی stage مسئول فایل SQL برگشت است.

### گام ۱۵ — بکاپ (شبانه روی HDD) و بازیابی

**بکاپ خودکار است** — سرویس `backup` هر شب ساعت `BACKUP_HOUR` (پیش‌فرض
۵ بامداد تهران) `pg_dump` می‌گیرد، gzip می‌کند و در
`/srv/hdd/sinshin/backups` می‌نویسد؛ `BACKUP_KEEP=30` نسخه (یک ماه) نگه
می‌دارد. شکست، فردا دوباره تلاش می‌شود؛ بوت بعد از ساعت مقرر اگر بکاپِ
امروز نباشد جبرانی می‌گیرد.

```bash
# راستی‌آزمایی (هر چند روز یک‌بار):
ls -lh /srv/hdd/sinshin/backups          # ← فایل sinshin-YYYY-MM-DD_HHMM.sql.gz
docker compose logs backup --tail 15     # ← «انجام شد: ... (۱.۲M)»

# حجم مصرفی HDD:
du -sh /srv/hdd/sinshin/backups
```

**بازیابی کامل (فاجعه یا آزمایش — داده‌ی فعلی را می‌پوشاند):**

```bash
cd /opt/sinshin-food-delivery

# ۱) استک را نگه دار، فقط api را بی‌انداز تا کسی سفارش نزند:
docker compose stop api web

# ۲) بکاپ را برگردان (از .env خودت: POSTGRES_USER/DB = sinshin):
gunzip -c /srv/hdd/sinshin/backups/sinshin-YYYY-MM-DD_HHMM.sql.gz \
  | docker exec -i sinshin-postgres psql -U sinshin -d sinshin

# ۳) برگردان:
docker compose start api web
curl -s localhost/api/health
```

**تمرین ماهانه‌ی بازیابی (خرابیِ خاموش را قبل از حادثه پیدا کن):**

```bash
# restore-drill آخرین بکاپ را در یک Postgres موقت بازیابی و جداول را می‌شمارد:
chmod +x deploy/backup/restore-drill.sh
./deploy/backup/restore-drill.sh

# خودکار ماهانه (اول هر ماه، ۴:۴۵):
crontab -e
# ↳ این خط را اضافه کن:
45 4 1 * * /opt/sinshin-food-delivery/deploy/backup/restore-drill.sh
```

نتیجه در `/var/log/sinshin-restore-drill.log` — باید `PASS` ببینی.

**بکاپ خارج از سرور (اختیاری ولی توصیه‌شده — رارد H7):** اگر
`BACKUP_RCLONE_REMOTE` را در `.env` بگذاری (مثل `b2:sinshin-backup`)، هر
بکاپ با rclone به مقصد ابری هم کپی می‌شود؛ با `BACKUP_AGE_PUBKEY` حتی
رمزنگاری سرتاسری (age) هم انجام می‌شود. راهنمای راه‌اندازی: REFERENCE بخش ۵.

> **گواهی‌های TLS و دیتای گیتا هم بکاپ‌پذیرند:** گواهی‌ها در
> `sinshin_caddy_data` و دیتای گیتا در `sinshin_gitea_data` (هر دو روی SSD)
> — از دست رفتنشان فقط صادرکردن مجدد/راه‌اندازی مجدد یعنی، نه از دست
> رفتن داده‌ی مشتری. بکاپ شبانه، دیتای «مشتری» را پوشش می‌دهد.

### گام ۱۶ — امنیت تکمیلی (وقتی سایت پایدار شد)

- `HSTS_ENABLED=true` در `.env` و `docker compose up -d caddy` — قفل HTTPS برای همیشه.
- `SWAGGER_ENABLED` را `false` نگه دار (پیش‌فرض است).
- آپدیت ماهانه‌ی سرور: `apt update && apt upgrade -y` (+ reboot فقط اگر کرنل آپدیت شد — استک خودکار بالا می‌آید).
- آپدیت ایمیج‌های پایه (postgres/redis/caddy/gitea): REFERENCE بخش ۹ (رویه‌ی امن).

---

## ۳) کتاب دستورات سرور (نگهداشت · تعمیر · افزودن)

> همه از `/opt/sinshin-food-delivery` (که همان SSD است). برای استک گیتا:
> `cd /opt/sinshin-food-delivery/deploy/gitea`.

### ۳-۱) وضعیت و مشاهده

| کار | دستور |
|---|---|
| وضعیت همه‌ی سرویس‌ها | `docker compose ps` |
| سلامت API | `curl -s localhost/api/health` |
| لاگ زنده‌ی یک سرویس | `docker compose logs -f api --tail 100` |
| لاگ‌های گیتا/رانر | `docker compose -f deploy/gitea/docker-compose.yml logs -f gitea --tail 50` |
| مصرف زنده‌ی کانتینرها | `docker stats --no-stream` |
| فهرست volumeها (همه روی SSD) | `docker volume ls` |
| مصرف دیسک داکر | `docker system df` |
| فضای SSD / HDD | `df -h /srv/ssd /srv/hdd` |
| ورود به کانتینر | `docker exec -it sinshin-api sh` |
| شل پستگرس | `docker exec -it sinshin-postgres psql -U sinshin -d sinshin` |

### ۳-۲) چرخه‌ی به‌روزرسانی

```bash
# روش اصلی (CI/CD) — روی سیستم خودت:
git add . && git commit -m "..." && git push gitea main

# روش دستی (پشتیبان):
cd /opt/sinshin-food-delivery && git pull && docker compose up -d --build
```

| کار | دستور |
|---|---|
| ری‌استارت یک سرویس | `docker compose restart api` |
| اعمال تغییر `.env` | `docker compose up -d` (کانتینرهای متأثر بازسازی می‌شوند) |
| اعمال `VITE_*` (باندل وب) | `docker compose up -d --build web` |
| توقف کل استک (داده‌ها می‌مانند) | `docker compose down` |
| بالا آوردن کل استک | `docker compose up -d` |
| بازگشت به استقرار قبل | `./deploy/rollback.sh` (گام ۱۴) |

### ۳-۳) داکر — دستورهای پرکاربرد (راه‌اندازی و CI/CD)

```bash
# ── وضعیت ──
docker ps                                    # کانتینرهای در حال اجرا
docker ps -a                                 # همه (حتی exit شده — مثل migrate)
docker compose ps                            # وضعیت استک جاری
docker stats --no-stream                     # CPU/RAM هر کانتینر

# ── بیلد و اجرا (همان‌هایی که CI/CD اجرا می‌کند) ──
docker compose build                         # بیلد همه (با کش BuildKit)
docker compose build api web                 # بیلد انتخابی
docker compose build --no-cache api          # بیلد تمیز (وقتی کش گمراه‌کننده شد)
docker compose up -d                         # بالا آوردن (بدون بیلد)
docker compose up -d --build                 # بیلد + بالا آوردن

# ── تگ‌گذاری rollback (آناتومی CI/CD — گام ۱۴) ──
docker compose images -q api                 # شناسه‌ی ایمیج فعلی سرویس
docker tag $(docker compose images -q api) sinshin/api:<sha7>

# ── لاگ و داخل ──
docker logs sinshin-api --tail 100           # لاگ مستقیم کانتینر
docker compose exec api sh                   # شل داخل کانتینرِ در حال اجرا
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile

# ── پاک‌سازی (فقط وقتی docker system df رشد کرد) ──
docker system df                             # قبل و بعد را ببین
docker image prune -f                        # ایمیج‌های dangling
docker builder prune -f                      # کش بیلد قدیمی
# ⚠️ هرگز docker system prune --volumes را نزن — volumeها یعنی دیتابیسِ زنده!
```

### ۳-۴) بکاپ و دیسک

| کار | دستور |
|---|---|
| فهرست بکاپ‌ها | `ls -lh /srv/hdd/sinshin/backups` |
| بکاپ دستی همین الان | `docker compose restart backup` (اگر امروز بکاپِ موفق ندارد، جبرانی می‌گیرد) یا ساعت `BACKUP_HOUR` را موقتاً ۲ دقیقه بعدِ الان کن و `docker compose up -d backup` |
| تمرین بازیابی | `./deploy/backup/restore-drill.sh` (گام ۱۵) |
| حجم بکاپ‌ها | `du -sh /srv/hdd/sinshin/backups` |
| وضعیت TRIM SSD | `systemctl status fstrim.timer --no-pager` |

### ۳-۵) تعمیر — سناریوهای فوری

| نشانه | قدم‌ها (به ترتیب) |
|---|---|
| **api بالا نمی‌آید / restart-loop** | `docker compose logs api --tail 50` → fail-fast عمدی است؛ متغیر ناقص `.env` را می‌گوید → اصلاح → `docker compose up -d` |
| **سایت برای همه پایین است** | `docker compose ps` → `docker compose logs caddy --tail 50` → `curl -s localhost/api/health` → مشکل یا caddy است یا api؛ هرکدام، لاگش جواب دارد |
| **دیپلوی جدید خراب شد** | `./deploy/rollback.sh` → بعد در پنل گیتا Actions لاگ job قرمز را ببین → روی سیستم خودت اصلاح کن → دوباره push |
| **گواهی TLS نیامد/تمدید نشد** | گام ۱۱ «اگر گواهی صادر نشد» — DNS → پورت 80 → لاگ ACME → rate-limit |
| **SSD دارد پر می‌شود** | `docker system df` → `docker image prune -f` + `docker builder prune -f` → اگر نشد، `du -sh /srv/ssd/docker/* \| sort -h` تا مقصر را ببینی |
| **پستگرس بالا نمی‌آید** | `docker compose logs postgres --tail 50` → معمولاً پر بودن دیسک یا volume — `df -h /srv/ssd` |
| **رانر در Actions غایب/قرمز** | `docker compose -f deploy/gitea/docker-compose.yml logs runner --tail 50` → توکن منقضی؟ دوباره Create Token و در `deploy/gitea/.env` بگذار و `up -d runner` |
| **push به گیتا رد می‌شود** | کلید SSH در پنل هست؟ آدرس با پورت 2222 است؟ `ssh -T git@<IP> -p 2222` باید خوش‌آمد بدهد |
| **همه‌چیز قاطی است — ری‌استارت کل** | `docker compose down && docker compose up -d` (volumeها می‌مانند) — آخرین راه: `reboot` (استک خودکار برمی‌گردد) |
| **رمز پستگرس یادم رفته** | در `.env` سِت شده — `grep POSTGRES /opt/sinshin-food-delivery/.env` |
| **فایل بکاپ خراب (restore-drill FAIL)** | بکاپ قبلی را restore کن (گام ۱۵) + `docker compose logs backup --tail 30` |

### ۳-۶) وقتی می‌خواهی چیزی اضافه/تغییر بدهی

| چه می‌خواهی | مسیر |
|---|---|
| **متغیر env سروری جدید** (مثل کلید پیامک) | `nano .env` → `docker compose up -d` — فقط کانتینرهای متأثر بازسازی می‌شوند |
| **متغیر `VITE_*`** (چیزی که وارد باندل وب می‌شود) | `nano .env` → `docker compose up -d --build web` |
| **دامنه/زیردامنه‌ی جدید** | DNS رکورد A → بلوک جدید در `Caddyfile` → `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` → `caddy reload` |
| **سرویس جدید در compose** | `docker-compose.yml` را ویرایش کن (الگوی سرویس‌های موجود) → commit + push — CI/CD خودش بالا می‌آورد |
| **سقف منابع سرویس** | `docker-compose.yml` → `deploy.resources.limits` → push (کالیبره‌ی فعلی: REFERENCE بخش ۸) |
| **چند نمونه‌ی api (پشت caddy)** | در `.env`: `API_UPSTREAMS="api:3000 api2:3000 api3:3000"` → `docker compose --profile scaled up -d` (هِلث‌چک و round-robin از قبل آماده است) |
| **job زمان‌بندی‌شده‌ی جدید** (کرون) | داخل اپ است: `apps/api/src/workers/` (scheduler + jobs) — کد + push؛ زمان‌بندی‌ها از `.env` (مثل `COUPON_SCAN_TIME`) |
| **تغییر ساعت/تعداد بکاپ** | `BACKUP_HOUR` / `BACKUP_KEEP` در `.env` → `docker compose up -d backup` |
| **مقصد بکاپ ابری** | `BACKUP_RCLONE_REMOTE` (+ `BACKUP_AGE_PUBKEY` برای رمزنگاری) در `.env` → `docker compose up -d backup` |

---

## اگر گیر کردی

| نشانه | راه‌حل سریع |
|---|---|
| api بالا نمی‌آید و می‌کشد | `docker compose logs api` — یکی از متغیرهای گام ۸ ناقص است (fail-fast عمدی) |
| رانر در Actions دیده نمی‌شود | گام ۵: توکن در `deploy/gitea/.env` + لاگ رانر |
| push به گیتا `Permission denied` | کلید SSH اضافه شده؟ (گام ۶) — آدرس پورت 2222 است؟ |
| گواهی TLS صادر نشد | DNS گام ۷ propagate شده؟ پورت 80 باز است؟ (گام ۱۱) |
| بیلد روی `bun install` می‌ماند | شبکه — `bunfig.toml` و راه‌حل میرور npm: REFERENCE بخش ۶ |
| بقیه‌ی موارد | REFERENCE بخش ۴ و ۵ — جدول کامل نشانه/راه‌حل دِو و تولید |

---

## پیوست — نقشه‌ی مسیرها (برای روز بد)

| مسیر | چی هست |
|---|---|
| `/opt/sinshin-food-delivery` | کد پروژه — **symlink** به `/srv/ssd/sinshin/food-delivery` |
| `/srv/ssd/docker` | data-root داکر: ایمیج‌ها، کانتینرها، کش بیلد، همه‌ی volumeها |
| `/srv/hdd/sinshin/backups` | بکاپ شبانه‌ی دیتابیس (bind-mount در سرویس backup) |
| `/var/log/sinshin-restore-drill.log` | نتیجه‌ی تمرین‌های ماهانه‌ی بازیابی |
| `/etc/docker/daemon.json` | data-root + میرور + سقف لاگ (گام ۳) |
| `/etc/fstab` | سوار شدن خودکار SSD در بوت |
| volumeها | `docker volume ls` — `sinshin_pg_data` (دیتابیس) · `sinshin_uploads_data` (آپلودها) · `sinshin_redis_data` · `sinshin_caddy_data` (گواهی‌ها) · `sinshin_gitea_data` (مخزن‌ها) |
| کانتینرها | `sinshin-caddy` · `sinshin-api` · `sinshin-web` · `sinshin-postgres` · `sinshin-redis` · `sinshin-backup` · `sinshin-translator` · `sinshin-gitea` · `sinshin-runner` |