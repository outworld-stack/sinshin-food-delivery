//src/domain/payment/sep.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { parsePaymentTarget } from '@sinshin/shared'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayResumeInput,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'
import { postGatewayJson, amountMatches, amountInRial } from './http-util'

const INIT_URL = 'https://sep.shaparak.ir/api/v1/Payment/InitPayment'
const PAYMENT_PAGE = 'https://sep.shaparak.ir/api/v1/Payment/PaymentPage'
const VERIFY_URL = 'https://sep.shaparak.ir/api/v1/Payment/VerifyPayment'

/**
 * stage-76 — CellNumber به فرمتِ مستندِ سامان (98xxxxxxxxxx).
 *
 * مستندات Token API شاپرک برای CellNumber فرمتِ «98 + شماره بدون صفرِ ابتدا»
 * می‌خواهد؛ شماره‌ی کاربران در DB به شکل 09xxxxxxxxx ذخیره می‌شود و همان‌طور
 * (با صفرِ ابتدا) فرستاده می‌شد. بعضی ترمینال‌های سامان مقدارِ خارج از
 * فرمت را با کد خطا رد می‌کنند ⇒ «init ناموفق» بدون هیچ دلیلِ قابل‌رؤیت.
 * نرمال‌سازی: 09xxxxxxxxx → 98xxxxxxxxx؛ هر شکلِ دیگر (خالی/غیر-ایرانی)
 * حذف می‌شود — CellNumber اختیاری است و نباید کلِ init را به خطر بیندازد.
 */
const sepCellNumber = (mobile: string | null | undefined): string | undefined => {
  if (!mobile) return undefined
  return /^09\d{9}$/.test(mobile) ? `98${mobile.slice(1)}` : undefined
}

/**
 * بانک سامان (سامان‌کیش) — مستقیم، REST جدید شاپرک (Token API).
 *
 * جریان:
 *   ۱) init → InitPayment (مبلغ ریال؛ ResNum = شناسه‌ی پرداخت ما) → Token؛
 *      کاربر به PaymentPage?Token=… می‌رود.
 *   ۲) برگشت مرورگر به callback با State/ResNum/RefNum/TraceNo در query.
 *   ۳) تایید → VerifyPayment سمت سرور با RefNum + TerminalId — مرجع قطعی.
 *
 * نکته‌ی gatewayRef — عمداً null در init و RefNum بعد از callback:
 *   توکن سامان فقط برای ساخت صفحه‌ی پرداخت است (کوتاه‌عمر)؛ شناسه‌ی
 *   ماندگارِ تراکنش RefNum است که فقط در callback می‌رسد. پس:
 *   • callback قطعی → RefNum با finalize ذخیره می‌شود؛
 *   • callback نامشخص (خطای گذرای بانک) → سرویس RefNum را همان‌جا
 *     ذخیره می‌کند تا کارِ تایم‌اوت بدون کوئری هم بتواند دوباره تایید کند؛
 *   • هیچ callback ای نرسید → gatewayRef=null می‌ماند؛ نبود مرجع
 *     به‌تنهایی عدم برداشت وجه را ثابت نمی‌کند و بررسی دستی لازم است.
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
    // پاسخ غیر-JSON بانک (صفحه‌ی خطا) نباید ۵۰۰ بدهد — هم‌تراز زرین‌پال/پی‌ایر
    const json = await postGatewayJson<{
      IsSuccess?: boolean
      isSuccess?: boolean
      Token?: string
      token?: string
      ResultCode?: string | number
    }>(
      INIT_URL,
      {
        Action: 'Token',
        TerminalId: this.terminalId,
        Amount: amountInRial(input.amount),
        ResNum: input.paymentId, // یکتا — همان شناسه‌ی پرداخت داخلی
        RedirectUrl: input.callbackUrl,
        CellNumber: sepCellNumber(input.mobile),
      },
      this.config.gateway.timeoutMs,
    )

    const token = json?.Token ?? json?.token
    const ok = (json?.IsSuccess ?? json?.isSuccess) === true
    if (!ok || typeof token !== 'string' || !/^[A-Za-z0-9_+/=-]{1,200}$/.test(token)) {
      const code = json?.ResultCode
      // stage-76 — هم‌تراز زرین‌پال: شکلِ واقعی پاسخِ ردشده لاگ می‌شود تا
      // در تست‌های عملی، کدِ ترمینالِ واقعی دیده شود (null = غیر-JSON).
      console.error(
        `[sep] init ناموفق: ResultCode=${code ?? '-'} token=${token ? 'دارد' : 'ندارد'} پاسخ=${JSON.stringify(json)}`,
      )
      throw Err.conflict(
        `ایجاد پرداخت سامان ناموفق بود${code !== undefined && code !== null ? ` (کد ${code})` : ''}.`,
      )
    }

    return {
      paymentUrl: `${PAYMENT_PAGE}?Token=${encodeURIComponent(token)}`,
      gatewayRef: null, // RefNum فقط در callback می‌رسد — بالای فایل
    }
  }

  resumeUrl(input: GatewayResumeInput): string | null {
    // RefNum is a receipt, not the Token needed to reopen PaymentPage.
    const target = typeof input.paymentUrl === 'string' ? parsePaymentTarget(input.paymentUrl) : null
    return target?.gateway === this.id ? target.url : null
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // امن-۴: مرجع ذخیره‌شده در DB مقدم است؛ کوئری فقط پشتیبان —
    // هم‌تراز زرین‌پال/پی‌ایر (callback جعلی نتواند تایید را روی RefNum دلخواه بگذارد).
    // gatewayRef اینجا همیشه null (قبل از callback) یا RefNum (بعد از آن) است.
    const refNum =
      input.gatewayRef ??
      input.query.RefNum ??
      input.query.refNum ??
      input.query.refnum ??
      null

    // No receipt, including an unsigned browser cancellation, cannot prove
    // nonpayment. Preserve the hold until server verification or review.
    if (!refNum) {
      // Browser callback fields, including cancellation, are unsigned input.
      return { success: false, gatewayRef: null, indeterminate: true }
    }
    if (!/^[A-Za-z0-9_+/=-]{1,120}$/.test(refNum)) {
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }
    const reservation = input.query.ResNum ?? input.query.resNum ?? input.query.resnum
    if (input.paymentId && reservation !== undefined && reservation !== input.paymentId) {
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }

    try {
      // پاسخ غیرقابل‌فهم/شکل ناشناخته (صفحه‌ی خطای بانک، قطعی گذرا) —
      // قطعی نیست؛ سرویس RefNum را ذخیره می‌کند و کارِ تایم‌اوت دوباره
      // می‌کوشد (هم‌تراز indeterminate زرین‌پال/پی‌ایر) — failPayment
      // بدون اطلاع یعنی بازگشت وجه اشتباه.
      const json = await postGatewayJson<{
        IsSuccess?: unknown
        isSuccess?: unknown
        Success?: unknown
        Amount?: unknown
        amount?: unknown
        ResultCode?: string | number
        ResNum?: unknown
        resNum?: unknown
        RefNum?: unknown
        refNum?: unknown
        TerminalId?: unknown
        terminalId?: unknown
        TransactionDetail?: unknown
      }>(
        VERIFY_URL,
        {
          RefNum: refNum,
          TerminalId: this.terminalId,
        },
        this.config.gateway.timeoutMs,
      )
      const flags = [json?.IsSuccess, json?.isSuccess, json?.Success]
        .filter((value) => value !== undefined)
      if (json === null || flags.length === 0 ||
        flags.some((value) => typeof value !== 'boolean' || value !== flags[0])) {
        // stage-76 — هم‌تراز زرین‌پال: شکلِ واقعی پاسخِ نامشخص لاگ می‌شود
        // تا کدهای واقعیِ ترمینال در تست‌های عملی دیده و مستند شوند.
        console.warn(
          `[sep] verify indeterminate: RefNum=${refNum} State=${input.query.State ?? '-'} TraceNo=${input.query.TraceNo ?? '-'} پاسخ=${JSON.stringify(json)}`,
        )
        return { success: false, gatewayRef: refNum, indeterminate: true }
      }

      // Support both the flat VerifyPayment response and SEP's nested
      // Success + TransactionDetail response. Every supplied money/identity
      // field must agree; an alias must not conceal contradictory details.
      const rawDetail = json.TransactionDetail
      if (rawDetail !== undefined &&
        (rawDetail === null || typeof rawDetail !== 'object' || Array.isArray(rawDetail))) {
        return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
      }
      const detail = rawDetail as Record<string, unknown> | undefined
      const ok = flags[0] === true
      const reservations = [json.ResNum, json.resNum, detail?.ResNum]
        .filter((value) => value !== undefined)
      if (input.paymentId && reservations.some((value) => value !== input.paymentId)) {
        return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
      }
      const terminals = [json.TerminalId, json.terminalId, detail?.TerminalNumber]
        .filter((value) => value !== undefined)
      if (terminals.some((value) =>
        (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) ||
        String(value) !== this.terminalId)) {
        return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
      }
      const references = [json.RefNum, json.refNum, detail?.RefNum]
        .filter((value) => value !== undefined)
      if (references.some((value) => value !== refNum)) {
        return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
      }
      const amounts = [json.Amount, json.amount, detail?.OrginalAmount, detail?.AffectiveAmount]
        .filter((value) => value !== undefined)
      const amountOk = amounts.length > 0 && amounts.every((gatewayAmount) => amountMatches({
        gatewayAmount,
        expectedRial: amountInRial(input.amount),
        successReported: ok,
        tag: 'sep',
      }))
      // stage-58 — پول‌ایمنی: «موفق اعلام شده + مبلغ ناهم‌خوان» وضعیت قطعی
      // نیست — fail قطعی یعنی failPayment/بازگشت کیف پول در حالی که پولِ
      // مشتری در PSP گرفته شده (مبلغ واقعاً کم/زیاد واریز شده). indeterminate
      // می‌ماند تا کارِ تایم‌اوت/R12 پنل PSP قطعی‌اش کند. شکستِ قطعی فقط
      // وقتی خود بانک پرچم موفقیت را false داده.
      if (ok && !amountOk) {
        return { success: false, gatewayRef: refNum, indeterminate: true }
      }
      if (!ok) {
        // stage-76 — شکستِ قطعی با کدِ درگاه لاگ می‌شود (هم‌تراز لاگ‌های
        // زرین‌پال) — کدهای ترمینال‌های سامان در تست‌های عملی از اینجا
        // خوانده و در صورتِ «قطعاً پرداخت‌نشده» بودن به تحلیل اضافه می‌شوند.
        console.warn(
          `[sep] verify قطعی-ناموفق: RefNum=${refNum} State=${input.query.State ?? '-'} ResultCode=${json.ResultCode ?? '-'}`,
        )
      }
      return { success: ok, gatewayRef: refNum }
    } catch (e) {
      // شبکه/تایم‌اوت — وضعیت نامشخص
      console.error(`[sep] verify خطای شبکه — indeterminate: RefNum=${refNum}`, e)
      return { success: false, gatewayRef: refNum, indeterminate: true }
    }
  }
}
