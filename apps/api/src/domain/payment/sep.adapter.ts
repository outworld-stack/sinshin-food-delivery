//src/domain/payment/sep.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

const INIT_URL = 'https://sep.shaparak.ir/api/v1/Payment/InitPayment'
const PAYMENT_PAGE = 'https://sep.shaparak.ir/api/v1/Payment/PaymentPage'
const VERIFY_URL = 'https://sep.shaparak.ir/api/v1/Payment/VerifyPayment'

/**
 * بانک سامان (سامان‌کیش) — مستقیم، REST جدید شاپرک (Token API).
 *
 * جریان:
 *   ۱) init → InitPayment (مبلغ ریال؛ ResNum = شناسه‌ی پرداخت ما) → Token؛
 *      کاربر به PaymentPage?Token=… می‌رود.
 *   ۲) برگشت مرورگر به callback با State/ResNum/RefNum/TraceNo در query.
 *   ۳) verify → VerifyPayment سمت سرور با RefNum + TerminalId — مرجع قطعی.
 *
 * نکته‌ی gatewayRef — عمداً null در init و RefNum بعد از callback:
 *   توکن سامان فقط برای ساخت صفحه‌ی پرداخت است (کوتاه‌عمر)؛ شناسه‌ی
 *   ماندگارِ تراکنش RefNum است که فقط در callback می‌رسد. پس:
 *   • callback قطعی → RefNum با finalize ذخیره می‌شود؛
 *   • callback نامشخص (خطای گذرای بانک) → سرویس RefNum را همان‌جا
 *     ذخیره می‌کند تا job تایم‌اوت بدون query هم بتواند دوباره verify کند؛
 *   • هیچ callback ای نرسید → gatewayRef=null می‌ماند و job تایم‌اوت
 *     مسیرِ بدون gatewayRef را قطعاً fail می‌کند — همان رفتار
 *     پذیرفته‌شده برای پرداختِ رهاشده (هم‌تراز ریسک زرین‌پال).
 */
export class SepAdapter implements PaymentGateway {
  readonly id = 'SEP'
  readonly mode = 'direct' as const

  constructor(private readonly config: AppConfig) {}

  private get terminalId(): string {
    const id = this.config.gateway.sepTerminalId
    if (!id) throw Err.conflict('SEP_TERMINAL_ID تنظیم نشده است.')
    return id
  }

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    const res = await Bun.fetch(INIT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Action: 'Token',
        TerminalId: this.terminalId,
        Amount: input.amount * 10, // تومان → ریال
        ResNum: input.paymentId, // یکتا — همان شناسه‌ی پرداخت داخلی
        RedirectUrl: input.callbackUrl,
        CellNumber: input.mobile ?? undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    // پاسخ غیر-JSON بانک (صفحه‌ی خطا) نباید ۵۰۰ بدهد — هم‌تراز زرین‌پال/پی‌ایر
    const json = (await res.json().catch(() => null)) as {
      IsSuccess?: boolean
      isSuccess?: boolean
      Token?: string
      token?: string
      ResultCode?: string | number
    } | null

    const token = json?.Token ?? json?.token
    const ok = (json?.IsSuccess ?? json?.isSuccess) === true
    if (!ok || !token) {
      const code = json?.ResultCode
      throw Err.conflict(
        `ایجاد پرداخت سامان ناموفق بود${code !== undefined && code !== null ? ` (کد ${code})` : ''}.`,
      )
    }

    return {
      paymentUrl: `${PAYMENT_PAGE}?Token=${encodeURIComponent(token)}`,
      gatewayRef: null, // RefNum فقط در callback می‌رسد — بالای فایل
    }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // امن-۴: مرجع ذخیره‌شده در DB مقدم است؛ query فقط fallback —
    // هم‌تراز زرین‌پال/پی‌ایر (callback جعلی نتواند verify را روی RefNum دلخواه بگذارد).
    // gatewayRef اینجا همیشه null (قبل از callback) یا RefNum (بعد از آن) است.
    const refNum =
      input.gatewayRef ??
      input.query.RefNum ??
      input.query.refNum ??
      input.query.refnum ??
      null

    // نه RefNum ذخیره‌شده داریم نه در query رسیده:
    //   • query خالی = job تایم‌اوت روی پرداختِ بدون callback → رهاشده؛
    //   • یا callback با State=لغو/خطا که RefNum ندارد («Canceled By User»، NOK).
    // هر دو = شکست قطعی؛ سفارش/کوپن/کیف پول آزاد می‌شوند.
    if (!refNum) return { success: false, gatewayRef: null }

    try {
      const res = await Bun.fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          RefNum: refNum,
          TerminalId: this.terminalId,
        }),
        signal: AbortSignal.timeout(15_000),
      })

      // پاسخ غیرقابل‌فهم/شکل ناشناخته (صفحه‌ی خطای بانک، قطعی گذرا) —
      // قطعی نیست؛ سرویس RefNum را ذخیره می‌کند و job تایم‌اوت دوباره
      // می‌کوشد (هم‌تراز indeterminate زرین‌پال/پی‌ایر) — failPayment
      // بدون اطلاع یعنی بازگشت وجه اشتباه.
      const json = (await res.json().catch(() => null)) as {
        IsSuccess?: boolean
        isSuccess?: boolean
        Amount?: number
        amount?: number
      } | null
      if (json === null || (json.IsSuccess ?? json.isSuccess) === undefined) {
        return { success: false, gatewayRef: refNum, indeterminate: true }
      }

      // چک مبلغ — پاسخ verify سامان شامل Amount (ریال) است؛ تطابق اجباری
      const amount = json.Amount ?? json.amount
      const amountOk = amount === undefined || Number(amount) === input.amount * 10
      const ok = (json.IsSuccess ?? json.isSuccess) === true
      if (ok && !amountOk) {
        console.error(
          `[sep] مبلغ verify (${amount}) با مبلغ پرداخت (${input.amount * 10}) نمی‌خواند`,
        )
      }
      return { success: ok && amountOk, gatewayRef: refNum }
    } catch {
      // شبکه/تایم‌اوت — وضعیت نامشخص
      return { success: false, gatewayRef: refNum, indeterminate: true }
    }
  }
}
