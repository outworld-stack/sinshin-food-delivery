# ═══════════════════════════════════════════════════════════════
# round-35 — sinshin-food-delivery — فایل 2 از 31
# مسیر مقصد: services/translator/Dockerfile
# وضعیت: فایل جدید (قبلاً وجود نداشت)
# کامیت پیشنهادی: stage thirty one
# ═══════════════════════════════════════════════════════════════

# services/translator/Dockerfile — برای Docker (BuildKit) نوشته شده.
#
# ══════════════════════════════════════════════════════════════
# سرویس مترجم آفلاین راند ۳۵ — NLLB-200-distilled-600M کوانتیزه‌شده
# به int8 با CTranslate2. جهت ترجمه ثابت: فارسی (pes) → عربی (arb).
# API اصلی (Elysia/Bun) این سرویس را روی شبکه‌ی داخلی compose در
# http://translator:8300 صدا می‌زند.
#
# ایمیج دومرحله‌ای است و دو جهان کاملاً جدا دارد:
#
#  • مرحله‌ی ۱ «converter» — فقط زمان بیلد، یک‌بار و با اینترنت:
#    torch واریانت CPU (~۱۹۰MB) + ابزار تبدیل CTranslate2 را نصب
#    می‌کند، مدل fp32 (~۲.۴GB) را از HuggingFace می‌کشد، به int8
#    (~۶۰۰MB) تبدیل می‌کند و توکنایزر را هم کنارش ذخیره می‌کند.
#    خروجی در /model می‌نشیند و به مرحله‌ی بعد کپی می‌شود؛ خودِ
#    این مرحله (~۳GB+) هرگز وارد ایمیج نهایی نمی‌شود.
#
#  • مرحله‌ی ۲ «runtime» — ایمیج نهایی (~۱.۲GB): فقط python:3.11-slim
#    + requirements.txt (بدون torch!) + مدل پخته‌شده در /model + app.py.
#    در زمان اجرا صفر اینترنت: نه دانلود مدل، نه هیچ فراخوانی بیرونی.
#    مدل به‌جای volume، داخل ایمیج است تا سرویس stateless بماند و
#    «آفلاین بودن» تضمین شود — دلیلی برای volume خارجی وجود ندارد.
#
# نکته: بیلد این ایمیج علاوه بر میرور docker.io (برای python:3.11-slim)
# به دسترسی مستقیم به pypi.org ،download.pytorch.org و huggingface.co
# نیاز دارد — فقط در همین مرحله‌ی converter و فقط یک‌بار.
# ══════════════════════════════════════════════════════════════

# ─── مرحله‌ی ۱: تبدیل مدل (فقط بیلد — اینترنت لازم است) ─────────

FROM python:3.11-slim AS converter

# torch فقط برای ابزار تبدیل لازم است؛ واریانت CPU از ایندکس رسمی
# pytorch نصب می‌شود (~۱۹۰MB به‌جای ~۸۰۰MB نسخه‌ی CUDA). ایندکس CPU
# وابستگی‌های torch را هم خودش میزبانی می‌کند، پس --index-url کافی است.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.2.2

# ابزار تبدیل + توکنایزر — نسخه‌ها با requirements.txt runtime هم‌خانواده‌اند
RUN pip install --no-cache-dir \
        ctranslate2==4.5.0 \
        transformers==4.44.2 \
        sentencepiece==0.2.0

# تبدیل مدل به فرمت CT2 با کوانتیزه‌سازی int8 (خروجی ~۶۰۰MB در /model)
RUN ct2-transformers-converter \
        --model facebook/nllb-200-distilled-600M \
        --output_dir /model \
        --quantization int8 \
        --force

# ذخیره‌ی توکنایزر کنار مدل — در زمان اجرا فقط همین فایل‌ها لازم‌اند؛
# بدون torch بارگذاری می‌شوند (استفاده‌ی صرفاً توکنایزری از transformers)
RUN python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('facebook/nllb-200-distilled-600M').save_pretrained('/model')"


# ─── مرحله‌ی ۲: اجرا (بدون torch، بدون اینترنت) ────────────────

FROM python:3.11-slim AS runtime

# لاگ‌ها بلافاصله flush شوند (print سبک app.py) و فایل .pyc نوشته نشود
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# اول وابستگی‌ها (لایه‌ی کش‌پذیر) — torch عمداً غایب است؛ ببینید requirements.txt
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# مدل پخته‌شده از مرحله‌ی converter + کد سرویس
COPY --from=converter /model /model
COPY app.py ./

EXPOSE 8300

# بیس slim نه curl دارد نه wget — چک سلامت با urllib خود پایتون
# (خطای اتصال/غیر ۲۰۰ → کد خروج غیرصفر → unhealthy). مدل در lifespan
# بارگذاری می‌شود و تا آماده نشود uvicorn پورت نمی‌دهد؛ start_period
# بلند برای دیسک‌های کند انتخاب شده است.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8300/health', timeout=4)"

# یک worker: مدل گلوگاه است و قفل تک‌دسته‌ای داخل app.py هم‌زمانی را
# مهار می‌کند؛ workers بیشتر فقط RAM را چند برابر می‌کرد. keep-alive
# بلندتر از ادوار poll صف ترجمه API (هر ۳۰ ثانیه) گرفته شده است.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8300", "--workers", "1", "--timeout-keep-alive", "65"]
