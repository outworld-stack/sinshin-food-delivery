//src/domain/payment/zarinpal.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { postGatewayJson } from './http-util'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

// رارد ۴۵ — سرویس تست رسمی زرین‌پال (مستندات: sandbox.zarinpal.com):
// فقط هاست عوض می‌شود و مسیرها یکسان‌اند؛ authority های سندباکس با S
// شروع می‌شوند و مرچنت آیدی هر UUID دلخواهی قبول می‌شود.
const PROD_HOST = 'https://payment.zarinpal.com'
const SANDBOX_HOST = 'https://sandbox.zarinpal.com'

/** زرین‌پال — مستقیم (ریدایرکت + تایید در callback) */
export class ZarinpalAdapter implements PaymentGateway {
  readonly id = 'ZARINPAL'
  readonly mode = 'direct' as const

  private readonly requestUrl: string
  private readonly verifyUrl: string
  private readonly startPay: string

  constructor(private readonly config: AppConfig) {
    const host = config.gateway.zarinpalSandbox ? SANDBOX_HOST : PROD_HOST
    this.requestUrl = `${host}/pg/v4/payment/request.json`
    this.verifyUrl = `${host}/pg/v4/payment/verify.json`
    this.startPay = `${host}/pg/StartPay`
  }

  private get merchantId(): string {
    const id = this.config.gateway.zarinpalMerchantId
    if (!id) throw Err.conflict('ZARINPAL_MERCHANT_ID تنظیم نشده است.')
    return id
  }

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    // stage-58 — errors زرین‌پال خوانده می‌شود: v4 موقع رد، آرایه‌ی
    // errors:[{code,message}] می‌فرستد (مرچنت‌نامعتبر/IP غیرمجاز/دامنه‌ی
    // callback غیرسفید). قبلاً جزئیات دور ریخته می‌شد ⇒ «پرداخت گاهی خطا
    // می‌دهد» بدون هیچ سرنخی. حالا هم لاگ می‌شود هم کد به پیام می‌رسد.
    const json = await postGatewayJson<{
      data?: { authority?: string }
      errors?: Array<{ code?: number; message?: string }>
    }>(
      this.requestUrl,
      {
        merchant_id: this.merchantId,
        amount: input.amount * 10, // تومان → ریال
        callback_url: input.callbackUrl,
        description: input.description,
        metadata: input.mobile ? { mobile: input.mobile } : undefined,
      },
      this.config.gateway.timeoutMs,
    )
    const authority = json?.data?.authority
    if (!authority) {
      const firstError = json?.errors?.[0]
      if (json?.errors?.length) {
        console.error('[zarinpal] init errors:', JSON.stringify(json.errors))
      }
      throw Err.conflict(
        `ایجاد پرداخت زرین‌پال ناموفق بود${firstError?.code !== undefined ? ` (کد ${firstError.code})` : ''}.`,
      )
    }
    return { paymentUrl: `${this.startPay}/${authority}`, gatewayRef: authority }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // phase-fix: مرجع ذخیره‌شده در DB مقدم است؛ کوئری فقط پشتیبان است.
    const authority = input.gatewayRef ?? input.query.authority ?? ''

    // stage-74 — Status برگشتی درگاه (فقط در callback می‌رسد؛ در استعلامِ
    // job تایم‌اوت/رِتری کوئری خالی است). زرین‌پال برای «پرداخت لغوشده یا
    // ناموفق» Status=NOK می‌فرستد و طبق مستنداتش فقط برای Status=OK باید
    // Verify زده شود.
    //
    // چرا NOK «به‌تنهایی» مسیر را نهایی نمی‌کند؟ پارامترِ کوئری قابلِ
    // جعل توسط کاربر است (state در URL پرداختِ خودِ اوست) — اگر مشتری
    // پرداخت را «انجام داده» باشد و بعد callbackِ جعلیِ NOK بزند، نهایی
    // کردن به FAILED یعنی شکستِ سفارشِ پول‌گرفته. منبعِ حقیقت فقط پاسخِ
    // سرور-به-سرورِ Verify است: درِ قطعی‌شدنِ شکست همان کدهای -9/-10/-11
    // پاسخِ Verify است که باز می‌شود — برای پرداختِ لغوشده، زرین‌پال این
    // کدها را (در v4 اغلب در آرایه/شیءِ errors نه در data.code — ریشه‌ی
    // باگِ «سفارش تا ابد PENDING می‌ماند») برمی‌گرداند. Status فقط لاگ
    // می‌شود تا در تست‌های عملی کارفرما دیده شود.
    const cbStatus = (input.query.Status ?? input.query.status ?? '').trim().toUpperCase()

    const json = await postGatewayJson<{
      data?: { code?: number }
      // stage-74 — v4 خطاها را در دو شکل می‌فرستد: آرایه یا شیءی تکی.
      // قبلاً فقط data.code خوانده می‌شد؛ برای پرداختِ لغوشده (شایع‌ترین
      // شکل: errors:[{code:-11,…}] با data خالی) کد undefined می‌شد و
      // نتیجه indeterminate → سفارش تا ۲۴ ساعت در PENDING_PAYMENT +
      // «مجموع پرداخت‌ها» آلوده (گزارش کارفرما — stage-74).
      errors?: Array<{ code?: number; message?: string }> | { code?: number; message?: string }
    }>(
      this.verifyUrl,
      {
        merchant_id: this.merchantId,
        amount: input.amount * 10,
        authority,
      },
      this.config.gateway.timeoutMs,
    )

    const dataCode = json?.data?.code
    const errorsObj = Array.isArray(json?.errors) ? json?.errors[0] : json?.errors
    const errCode = errorsObj?.code

    // 100 = موفق ، 101 = قبلاً تایید شده (تکرارناپذر)
    if (dataCode === 100 || dataCode === 101) {
      // پول واقعاً گرفته شده — حتی اگر callback با NOK آمده باشد (نظریه‌ی
      // جعل/سبقت) پاسخِ Verify مقدم است.
      if (cbStatus === 'NOK') {
        console.warn(
          `[zarinpal] verify: authority=${authority} کد ${dataCode} (پرداخت موفق) ولی Status=NOK در callback — پاسخ Verify مقدم است.`,
        )
      }
      return { success: true, gatewayRef: authority }
    }
    // phase-fix: فقط کدهای «قطعاً پرداخت‌نشده» به شکست می‌روند؛
    // بقیه (خطای بانک/سرویس/نامشخص) = indeterminate — پول ممکن است گرفته
    // شده باشد؛ قطعی‌سازی به‌عنوان FAILED یعنی بازگشت وجه اشتباه.
    //   -9  ورودی نامعتبر (پولی گرفته نشده)
    //   -10 پذیرنده/IP نامعتبر
    //   -11 authority پیدا نشد (پرداختی در کار نیست — حالتِ پرداختِ لغوشده)
    // stage-74: کدها از هر دو شکلِ پاسخ (data.code یا errors[].code)
    // خوانده می‌شوند.
    const DEFINITELY_NOT_PAID = new Set([-9, -10, -11])
    if (
      DEFINITELY_NOT_PAID.has(dataCode ?? Number.NaN) ||
      DEFINITELY_NOT_PAID.has(errCode ?? Number.NaN)
    ) {
      if (cbStatus) {
        console.log(
          `[zarinpal] verify: authority=${authority} Status=${cbStatus} → data.code=${dataCode ?? '-'} errors.code=${errCode ?? '-'} — شکست قطعی (پول گرفته نشده).`,
        )
      }
      return { success: false, gatewayRef: authority }
    }
    // نامشخص — شکلِ واقعی پاسخ لاگ می‌شود تا کدِ درگاه‌های دیگر در تست‌های
    // عملی دیده و در صورت «قطعاً پرداخت‌نشده» بودن به مجموعه‌ی بالا اضافه شود.
    console.warn(
      `[zarinpal] verify indeterminate: authority=${authority} Status=${cbStatus || '-'} data=${JSON.stringify(json?.data ?? null)} errors=${JSON.stringify(json?.errors ?? null)}`,
    )
    return { success: false, gatewayRef: authority, indeterminate: true }
  }
}