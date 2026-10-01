# ═══════════════════════════════════════════════════════════════
# round-35 — sinshin-food-delivery — فایل 3 از 31
# مسیر مقصد: services/translator/app.py
# وضعیت: فایل جدید (قبلاً وجود نداشت)
# کامیت پیشنهادی: stage thirty one
# ═══════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════
# سرویس مترجم آفلاین سین‌شین — راند ۳۵
#
# FastAPI + CTranslate2 (int8) روی مدل NLLB-200-distilled-600M؛
# جهت ترجمه ثابت: فارسی (pes) → عربی (arb). این سرویس آفلاین است —
# مدل و توکنایزر در زمان بیلد داخل ایمیج پخته می‌شوند و در زمان اجرا
# هیچ ارتباط اینترنتی لازم نیست. خودش هم چیزی در دیتابیس نمی‌نویسد؛
# API اصلی (Elysia/Bun) از طریق صف ترجمه، خروجی این سرویس را در
# ستون‌های ar جداول محتوا ذخیره می‌کند.
#
# نکته‌ی حیاتی (دام کلاسیک NLLB+CT2 — راستی‌آزمایی‌شده با مدل واقعی):
# کدهای «کوتاه» pes و arb به‌عنوان توکن‌های معمولی در واژگان NLLB
# وجود دارند اما برچسب زبانِ آموزش‌دیده‌ی مدل نیستند؛ مدل با کدهای
# کامل FLORES-200 (pes_Arab و arb_Arab) آموزش دیده. اگر کد کوتاه را
# مستقیم به target_prefix بدهید، خروجی نامرتبط/انگلیسی تولید می‌شود.
# بنابراین کدهای سطح API (pes/arb — طبق قرارداد راند ۳۵) پیش از
# فراخوانی مدل به کدهای FLORES نگاشت می‌شوند و قرارداد بیرونی
# دست‌نخورده می‌ماند. جزئیات در README.md همین پوشه.
# ══════════════════════════════════════════════════════════════

import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import ctranslate2
import transformers
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ─── ثابت‌های سرویس ────────────────────────────────────────────

MODEL_DIR = '/model'
MODEL_ID = 'nllb-200-distilled-600M-int8'
SRC = 'pes'            # کد سطح API برای زبان مبدأ (فارسی)
TGT = 'arb'            # کد سطح API برای زبان مقصد (عربی)
MAX_TEXTS = 64         # سقف تعداد متن در هر درخواست
MAX_CHARS = 30000      # سقف طول هر متن (کاراکتر)

# نگاشت کد سطح API → کد FLORES-200 واقعی مدل NLLB.
# کدهای کامل (pes_Arab/arb_Arab) هم پذیرفته می‌شوند؛ هر کد دیگری رد
# می‌شود چون خروجی مدل را بی‌معنا می‌کند (توکن معمولی ≠ برچسب زبان).
NLLB_CODES: dict[str, str] = {
    'pes': 'pes_Arab',
    'pes_Arab': 'pes_Arab',
    'arb': 'arb_Arab',
    'arb_Arab': 'arb_Arab',
}

# پارامترهای رمزگشایی — سبک و سریع روی CPU (طبق معماری راند ۳۵)
BEAM_SIZE = 2
MAX_DECODING_LENGTH = 512   # سقف توکن‌های خروجی برای «هر خط»
MAX_BATCH_SIZE = 16         # اندازه‌ی دسته‌های داخلی translate_batch

# تعداد رشته‌های OpenMP برای هر worker ترجمه: دو هسته برای بقیه‌ی
# استک آزاد بماند (حداقل ۱). روی سرور ۴ هسته‌ای → ۲ رشته.
INTRA_THREADS = max(1, (os.cpu_count() or 2) - 2)

# ─── وضعیت سراسری (یک‌بار در lifespan بارگذاری می‌شوند) ──────────

translator: ctranslate2.Translator | None = None
tokenizer: transformers.PreTrainedTokenizerBase | None = None

# قفل تک‌دسته‌ای: مدل گلوگاه است؛ هم‌زمانی بیش از یک batch هم RAM را
# می‌ترکاند هم CPU را تکه‌تکه می‌کند. اندپوینت‌ها def معمولی‌اند تا
# FastAPI آن‌ها را در threadpool خودش اجرا کند و event loop آزاد بماند.
_TRANSLATE_LOCK = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """بارگذاری یک‌باره‌ی مدل و توکنایزر پیش از سرویس‌دهی.

    اگر این مرحله شکست بخورد، uvicorn بالا نمی‌آید و healthcheck
    compose وضعیت را نشان می‌دهد — صف ترجمه API هم pending می‌ماند.
    """
    global translator, tokenizer
    t0 = time.time()
    print(f'[startup] loading model from {MODEL_DIR} '
          f'(int8, inter_threads=1, intra_threads={INTRA_THREADS})', flush=True)
    translator = ctranslate2.Translator(
        MODEL_DIR,
        device='cpu',
        compute_type='int8',
        inter_threads=1,
        intra_threads=INTRA_THREADS,
    )
    tokenizer = transformers.AutoTokenizer.from_pretrained(MODEL_DIR)
    print(f'[startup] ready in {time.time() - t0:.1f}s '
          f'(vocab={tokenizer.vocab_size})', flush=True)
    yield
    # ctranslate2 منابع خودش را در تخریب شیء آزاد می‌کند؛ کاری لازم نیست.


app = FastAPI(
    title='sinshin-translator',
    version='1.0.0',
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,   # سرویس داخلی؛ مستندات لازم نیست بیرون دیده شود
)


# ─── مدل‌های بدنه‌ی درخواست ─────────────────────────────────────

class TranslateRequest(BaseModel):
    """بدنه‌ی POST /translate — source/target اختیاری‌اند با پیش‌فرض pes/arb."""
    texts: list[str]
    source: str = SRC
    target: str = TGT


# ─── هندلرهای خطا (همه با پیام فارسی) ──────────────────────────

@app.exception_handler(RequestValidationError)
async def on_validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    # بدنه‌ی خراب/نامعتبر — پیام عمومی فارسی به‌جای خطای انگلیسی pydantic
    return JSONResponse(
        status_code=422,
        content={'detail': 'بدنه‌ی درخواست نامعتبر است — texts باید آرایه‌ای از رشته‌ها باشد.'},
    )


@app.exception_handler(Exception)
async def on_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    # خطای پیش‌بینی‌نشده — جزئیات فقط در لاگ داخل کانتینر؛ پاسخ، فارسی و کوتاه
    print(f'[error] {type(exc).__name__}: {exc}', flush=True)
    return JSONResponse(
        status_code=500,
        content={'detail': 'خطای داخلی سرویس ترجمه — لطفاً کمی بعد دوباره تلاش کنید.'},
    )


# ─── اندپوینت‌ها ────────────────────────────────────────────────

@app.get('/health')
def health() -> dict[str, Any]:
    """سلامت سرویس — سبک و بدون هیچ فراخوانی مدل.

    چون lifespan مدل را «پیش از» سرویس‌دهی بارگذاری می‌کند، اگر این
    اندپوینت جواب بدهد یعنی مدل در حافظه است.
    """
    return {
        'ready': True,
        'model': MODEL_ID,
        'device': 'cpu',
        'src': SRC,
        'tgt': TGT,
    }


def _translate_lines(lines: list[str], flores_tgt: str) -> list[str]:
    """ترجمه‌ی دسته‌ای خطوط غیرخالی — باید داخل قفل صدا زده شود.

    دستور پخت استاندارد CT2+NLLB:
      ۱) tokenizer(line).input_ids → convert_ids_to_tokens → توکن‌های متنی
         (توکنایزر با src_lang تنظیم‌شده، کد زبان مبدأ و </s> را خودش
         اضافه می‌کند — همان چیزی که CT2 انتظار دارد)
      ۲) translate_batch با target_prefix=[[کد زبان مقصد]] * n
      ۳) hypotheses[0][1:] → حذف توکن اول (کد زبان مقصد) — چون کدهای
         FLORES در skip_special_tokens حذف نمی‌شوند باید دستی کنار برود
      ۴) convert_tokens_to_ids → batch_decode — چون batch_decode فقط
         «شناسه» می‌پذیرد و hypotheses «رشته» است (دام رایج دیگر)
    """
    assert tokenizer is not None and translator is not None

    token_batches: list[list[str]] = []
    for line in lines:
        ids = tokenizer(line, return_tensors=None).input_ids
        token_batches.append(tokenizer.convert_ids_to_tokens(ids))

    results = translator.translate_batch(
        token_batches,
        target_prefix=[[flores_tgt]] * len(token_batches),
        max_batch_size=MAX_BATCH_SIZE,
        beam_size=BEAM_SIZE,
        max_decoding_length=MAX_DECODING_LENGTH,
    )

    ids_out = [tokenizer.convert_tokens_to_ids(r.hypotheses[0][1:]) for r in results]
    return tokenizer.batch_decode(ids_out, skip_special_tokens=True)


@app.post('/translate')
def translate(req: TranslateRequest) -> dict[str, Any]:
    """ترجمه‌ی دسته‌ای متن — پیش‌فرض و حالت اصلی: فارسی → عربی."""
    # ── اعتبارسنجی اندازه و طول (422 با پیام فارسی) ──
    if not (1 <= len(req.texts) <= MAX_TEXTS):
        raise HTTPException(
            status_code=422,
            detail=f'تعداد متن‌ها باید بین ۱ تا {MAX_TEXTS} باشد '
                   f'(درخواست فعلی: {len(req.texts)}).',
        )
    for i, text in enumerate(req.texts):
        if not (1 <= len(text) <= MAX_CHARS):
            raise HTTPException(
                status_code=422,
                detail=f'طول متن شماره‌ی {i + 1} باید بین ۱ تا {MAX_CHARS} کاراکتر باشد '
                       f'(طول فعلی: {len(text)}).',
            )

    # ── نگاشت کدهای API به کدهای FLORES مدل ──
    flores_src = NLLB_CODES.get(req.source)
    flores_tgt = NLLB_CODES.get(req.target)
    if flores_src is None or flores_tgt is None:
        raise HTTPException(
            status_code=400,
            detail='کد زبان پشتیبانی نمی‌شود — فقط pes (فارسی) و arb (عربی) معتبرند.',
        )

    # ── مبدأ = مقصد → بازگرداندن خود متن‌ها (بدون هزینه) ──
    if flores_src == flores_tgt:
        return {'translations': list(req.texts)}

    # ── شکستن متن‌ها به خط؛ خطوط خالی/فاصله‌ای دست‌نخورده می‌مانند ──
    # متن‌های خیلی طولانی (Markdown مقاله‌ها) به خط تقسیم می‌شوند تا
    # هیچ ورودی تک‌قطعه‌ی غول‌آسایی به decoder نرسد.
    per_text_lines = [text.split('\n') for text in req.texts]
    pending: list[tuple[int, int, str]] = []   # (اندیس متن، اندیس خط، متن خط)
    for ti, lines in enumerate(per_text_lines):
        for li, line in enumerate(lines):
            if line.strip():
                pending.append((ti, li, line))

    t0 = time.time()
    if pending:   # متن فقط‌فاصله‌ای/تقریباً خالی → اصلاً مدل صدا زده نمی‌شود
        with _TRANSLATE_LOCK:
            if translator is None or tokenizer is None:   # عملاً رخ نمی‌دهد (lifespan) — محافظ
                raise HTTPException(status_code=503, detail='سرویس آماده نیست؛ مدل هنوز بارگذاری نشده است.')
            tokenizer.src_lang = flores_src   # تنظیم کد مبدأ توکنایزر — داخل قفل (شیء مشترک)
            translated = _translate_lines([line for _, _, line in pending], flores_tgt)
    else:
        translated = []

    # ── بازچینی: جای‌گذاری ترجمه‌ها در جای خطوط اصلی، حفظ ترتیب و خطوط خالی ──
    for (ti, li, _), result in zip(pending, translated):
        per_text_lines[ti][li] = result
    translations = ['\n'.join(lines) for lines in per_text_lines]

    # ── لاگ سبک هر درخواست در stdout ──
    total_chars = sum(len(t) for t in req.texts)
    print(
        f'[translate] texts={len(req.texts)} chars={total_chars} '
        f'lines={len(pending)} src={req.source}->{flores_src} '
        f'tgt={req.target}->{flores_tgt} ms={int((time.time() - t0) * 1000)}',
        flush=True,
    )
    return {'translations': translations}
