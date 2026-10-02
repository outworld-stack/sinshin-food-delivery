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
    const json = await postGatewayJson<{ data?: { authority?: string } }>(
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
    if (!authority) throw Err.conflict('ایجاد پرداخت زرین‌پال ناموفق بود.')
    return { paymentUrl: `${this.startPay}/${authority}`, gatewayRef: authority }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // phase-fix: مرجع ذخیره‌شده در DB مقدم است؛ کوئری فقط پشتیبان است.
    const authority = input.gatewayRef ?? input.query.authority ?? ''
    const json = await postGatewayJson<{ data?: { code?: number } }>(
      this.verifyUrl,
      {
        merchant_id: this.merchantId,
        amount: input.amount * 10,
        authority,
      },
      this.config.gateway.timeoutMs,
    )
    const code = json?.data?.code
    // 100 = موفق ، 101 = قبلاً تایید شده (تکرارناپذر)
    if (code === 100 || code === 101) {
      return { success: true, gatewayRef: authority }
    }
    // phase-fix: فقط کدهای «قطعاً پرداخت‌نشده» به شکست می‌روند؛
    // بقیه (خطای بانک/سرویس/نامشخص) = indeterminate — پول ممکن است گرفته
    // شده باشد؛ قطعی‌سازی به‌عنوان FAILED یعنی بازگشت وجه اشتباه.
    //   -9  ورودی نامعتبر (پولی گرفته نشده)
    //   -10 پذیرنده/IP نامعتبر
    //   -11 authority پیدا نشد (پرداختی در کار نیست)
    if (code === -9 || code === -10 || code === -11) {
      return { success: false, gatewayRef: authority }
    }
    return { success: false, gatewayRef: authority, indeterminate: true }
  }
}