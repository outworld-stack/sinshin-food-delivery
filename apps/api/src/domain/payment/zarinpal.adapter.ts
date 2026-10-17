//src/domain/payment/zarinpal.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { amountInRial, postGatewayJson } from './http-util'
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
      data?: { authority?: string; code?: number }
      errors?: Array<{ code?: number; message?: string }>
    }>(
      this.requestUrl,
      {
        merchant_id: this.merchantId,
        amount: amountInRial(input.amount),
        callback_url: input.callbackUrl,
        description: input.description,
        metadata: input.mobile ? { mobile: input.mobile } : undefined,
      },
      this.config.gateway.timeoutMs,
    )
    const authority = json?.data?.authority
    if (json?.data?.code !== 100 || typeof authority !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(authority)) {
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
    // Verify only the authority persisted during initialization.
    const authority = input.gatewayRef
    if (!authority || !/^[A-Za-z0-9_-]{1,120}$/.test(authority)) {
      return { success: false, gatewayRef: authority ?? null, indeterminate: true }
    }

    // Browser Status is unsigned, so NOK alone cannot release money.
    // Server verification is authoritative; log the browser status only
    // to help diagnose contradictory callbacks.
    const cbStatus = (input.query.Status ?? input.query.status ?? '').trim().toUpperCase()

    const json = await postGatewayJson<{
      data?: { code?: number }
      // v4 errors may be an array or a single object.
      errors?: Array<{ code?: number; message?: string }> | { code?: number; message?: string }
    }>(
      this.verifyUrl,
      {
        merchant_id: this.merchantId,
        amount: amountInRial(input.amount),
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
    // Validation, merchant configuration and authorization errors cannot
    // establish whether an earlier payment captured money (-9/-10/-11).
    // Only explicit unsuccessful transaction code -51 may release the hold.
    const DEFINITELY_NOT_PAID = new Set([-51])
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
