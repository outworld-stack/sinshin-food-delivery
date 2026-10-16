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
import { postGatewayJson, amountMatches } from './http-util'

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
 *   • هیچ callback ای نرسید → gatewayRef=null می‌ماند و کارِ تایم‌اوت
 *     مسیرِ بدون gatewayRef را قطعاً شکست می‌دهد — همان رفتار
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
        Amount: input.amount * 10, // تومان → ریال
        ResNum: input.paymentId, // یکتا — همان شناسه‌ی پرداخت داخلی
        RedirectUrl: input.callbackUrl,
        CellNumber: sepCellNumber(input.mobile),
      },
      this.config.gateway.timeoutMs,
    )

    const token = json?.Token ?? json?.token
    const ok = (json?.IsSuccess ?? json?.isSuccess) === true
    if (!ok || !token) {
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

    // نه RefNum ذخیره‌شده داریم نه در کوئری رسیده:
    //   • کوئری خالی = کارِ تایم‌اوت روی پرداختِ بدون callback — رارد H6:
    //     کاربر ممکن است در بانک پرداخته و تب را بسته باشد → پول در PSP
    //     گرفته شده → indeterminate، نه شکست قطعی (پنجره‌ی ۲۴h در
    //     payment.service.reconcilePending) — fail یعنی بازگشت وجه اشتباه.
    //   • callback رسیده با State=لغو/خطا و بدون RefNum («Canceled By User»،
    //     NOK) = لغوی اعلام‌شده‌ی خود بانک → شکست قطعی.
    const isTimeoutProbe = Object.keys(input.query).length === 0
    if (!refNum) {
      if (isTimeoutProbe) {
        return { success: false, gatewayRef: null, indeterminate: true }
      }
      return { success: false, gatewayRef: null }
    }

    try {
      // پاسخ غیرقابل‌فهم/شکل ناشناخته (صفحه‌ی خطای بانک، قطعی گذرا) —
      // قطعی نیست؛ سرویس RefNum را ذخیره می‌کند و کارِ تایم‌اوت دوباره
      // می‌کوشد (هم‌تراز indeterminate زرین‌پال/پی‌ایر) — failPayment
      // بدون اطلاع یعنی بازگشت وجه اشتباه.
      const json = await postGatewayJson<{
        IsSuccess?: boolean
        isSuccess?: boolean
        Amount?: number
        amount?: number
        ResultCode?: string | number
      }>(
        VERIFY_URL,
        {
          RefNum: refNum,
          TerminalId: this.terminalId,
        },
        this.config.gateway.timeoutMs,
      )
      if (json === null || (json.IsSuccess ?? json.isSuccess) === undefined) {
        // stage-76 — هم‌تراز زرین‌پال: شکلِ واقعی پاسخِ نامشخص لاگ می‌شود
        // تا کدهای واقعیِ ترمینال در تست‌های عملی دیده و مستند شوند.
        console.warn(
          `[sep] verify indeterminate: RefNum=${refNum} State=${input.query.State ?? '-'} TraceNo=${input.query.TraceNo ?? '-'} پاسخ=${JSON.stringify(json)}`,
        )
        return { success: false, gatewayRef: refNum, indeterminate: true }
      }

      // چک مبلغ — پاسخ تایید سامان شامل Amount (ریال) است؛ تطابق اجباری
      const ok = (json.IsSuccess ?? json.isSuccess) === true
      const amountOk = amountMatches({
        gatewayAmount: json.Amount ?? json.amount,
        expectedRial: input.amount * 10,
        successReported: ok,
        tag: 'sep',
      })
      // stage-58 — پول‌ایمنی: «موفق اعلام شده + مبلغ ناهم‌خوان» وضعیت قطعی
      // نیست — fail قطعی یعنی failPayment/بازگشت کیف پول در حالی که پولِ
      // مشتری در PSP گرفته شده (مبلغ واقعاً کم/زیاد واریز شده). indeterminate
      // می‌ماند تا کارِ تایم‌اوت/R12 پنل PSP قطعی‌اش کند. شکستِ قطعی فقط
      // وقتی خود بانک IsSuccess=false داده.
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