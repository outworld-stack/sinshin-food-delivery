//src/domain/payment/mellat.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { amountInRial } from './http-util'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

const SOAP_URL = 'https://bpm.shaparak.ir/pgwchannel/services/pgw'
const STARTPAY = 'https://bpm.shaparak.ir/StartPay'
/** فضای‌نام متدهای ساب — همان که پیاده‌سازی‌های خامِ فعالِ بانک می‌فرستند */
const SOAP_NS = 'http://interfaces.core.sw.bps.com/'

/** پارامتر یک متد ساب — نوع برای ویژگی xsi:type */
interface BpParam {
  name: string
  value: string
  type: 'long' | 'string'
}

/** گریز نویسه‌های خاص مقدار در پوشه‌ی ساب */
const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })

/** بازگشت گریزهای موجود در مقدار <return> */
const unescapeXml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      default: return "'"
    }
  })

/**
 * تاریخ/ساعت محلی تهران — قالب خواسته‌شده‌ی به‌پرداخت (yymmdd / hhmmss).
 *
 * stage-58 — قبلاً getFullYear()/getHours() مستقیم روی Date بود؛ کانتینر
 * API هیچ TZ ندارد (compose فقط برای web/backup ست می‌کرد) ⇒ ساعتِ ارسالی
 * ۳:۳۰ عقب‌تر از تهران بود. حالا با Intl و timeZone صریح، مستقل از TZِ
 * کانتینر همیشه ساعت/تاریخ تهران ارسال می‌شود.
 */
const tehranParts = (d: Date): Map<string, string> => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const map = new Map<string, string>()
  for (const p of parts) map.set(p.type, p.value)
  return map
}

/** Gregorian Tehran date required by bpPayRequest (yyyyMMdd). */
const localDate = (d: Date): string => {
  const p = tehranParts(d)
  return `${p.get('year') ?? '0000'}${p.get('month') ?? '01'}${p.get('day') ?? '01'}`
}

/** ساعت تهران شش‌رقمی (hhmmss) */
const localTime = (d: Date): string => {
  const p = tehranParts(d)
  return `${p.get('hour') ?? '00'}${p.get('minute') ?? '00'}${p.get('second') ?? '00'}`
}

/**
 * خروجی bpPayRequest — قالب مستندِ رسمی: «کد،مرجع».
 *
 * stage-58 — قبلاً هر دو ترتیب پذیرفته می‌شد و شاخه‌ی دوم («X,0») هر
 * پاسخِ شکستِ دو‌بخشی را «موفق با refId=X» می‌خواند (مثلاً «39,0» ⇒
 * کاربر به StartPay/39 می‌رفت = صفحه‌ی مرده). حالا فقط ترتیب مستند؛
 * کدِ غیرصفر در بخش اول = شکست قطعی با کدِ واقعی.
 */
const parsePayResult = (raw: string): { code: string; refId: string } => {
  const parts = raw.split(',').map((p) => p.trim())
  const [a = '', b = ''] = parts
  if (parts.length === 2 && a === '0' && b !== '') return { code: '0', refId: b }
  return { code: parts.length === 2 ? a : raw, refId: '' }
}

/**
 * stage-76 — خواندن فیلد از فرم/کوئریِ callback با حساسیت‌به‌حروفِ
 * بی‌تفاوت — هم‌تراز زرین‌پال (Status/status) و سامان (RefNum/refNum/refnum).
 * بانک ملت فیلدها را با حروف دقیقِ مستند می‌فرستد، اما هر واسط/پروکسی
 * (URL-encode مجدد، بازنویسی فرم) می‌تواند بزرگ/کوچک‌سازی کند — شکستِ
 * «ResCode ناخوانده» یعنی indeterminate ابدی در حالی که callback رسیده.
 */
const qget = (query: Record<string, string>, name: string): string | undefined => {
  if (query[name] !== undefined) return query[name]
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(query)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

/**
 * بانک ملت (به‌پرداخت) — مستقیم، ساب قدیمی شاپرک.
 *
 * جریان:
 *   ۱) init → bpPayRequest (مبلغ ریال؛ orderId = هش عددیِ پایدار از
 *      شناسه‌ی پرداخت) → RefId؛ کاربر به StartPay/RefId می‌رود.
 *   ۲) برگشت بانک به callback با فرم POST (ResCode/RefId/SaleOrderId/
 *      SaleReferenceId) — فقط ResCode=0 مسیر تایید دارد.
 *   ۳) تایید → bpVerifyRequest و بلافاصله bpSettleRequest سمت سرور؛
 *      مرجع قطعی تراکنش SaleReferenceId است.
 *
 * نکته‌ی gatewayRef — دو حالتِ کدگذاری‌شده با برچسب:
 *   • پس از init: «orderId:t:RefId» — t یعنی توکنِ صفحه‌ی پرداخت؛
 *   • پس از callback: «orderId:s:SaleReferenceId» — s یعنی مرجعِ ماندگار
 *     تراکنش که کارِ تایم‌اوت بدون کوئری هم می‌تواند دوباره وریفای کند
 *     (هم‌مکانیزم RefNum سامان از رارد ۲۳).
 *
 * پیوند امنیتی (هم‌تراز امن-۴ بقیه‌ی درگاه‌ها):
 *   orderId همیشه از مقدارِ ذخیره‌شده خوانده می‌شود نه از فرم برگشتی؛
 *   و RefId فرم باید با توکنِ init یکی باشد — فرم جعلی نمی‌تواند
 *   تراکنشِ سفارش دیگری را به این پرداخت بچسباند.
 *
 * ریسک پذیرفته‌شده (هم‌تراز سامان): اگر callback هرگز نرسد (تب بسته
 * شده)، تراکنش وریفای نشده و شاپرک خودش مبلغ را آزاد می‌کند؛ کارِ
 * تایم‌اوت سفارش را قطعاً شکست می‌دهد.
 */
export class MellatAdapter implements PaymentGateway {
  readonly id = 'MELLAT'
  readonly mode = 'direct' as const

  constructor(private readonly config: AppConfig) {}

  private get creds(): { terminalId: string; userName: string; userPassword: string } {
    const { mellatTerminalId, mellatUserName, mellatUserPassword } = this.config.gateway
    if (!mellatTerminalId || !mellatUserName || !mellatUserPassword) {
      throw Err.conflict(
        'تنظیمات درگاه ملت کامل نیست (MELLAT_TERMINAL_ID / MELLAT_USERNAME / MELLAT_PASSWORD).',
      )
    }
    return { terminalId: mellatTerminalId, userName: mellatUserName, userPassword: mellatUserPassword }
  }

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    const { terminalId, userName, userPassword } = this.creds
    const now = new Date()
    const orderId = this.numericOrderId(input.paymentId)

    const raw = await this.bpCall('bpPayRequest', [
      { name: 'terminalId', value: terminalId, type: 'long' },
      { name: 'userName', value: userName, type: 'string' },
      { name: 'userPassword', value: userPassword, type: 'string' },
      { name: 'orderId', value: orderId, type: 'long' },
      { name: 'amount', value: String(amountInRial(input.amount)), type: 'long' },
      { name: 'localDate', value: localDate(now), type: 'string' },
      { name: 'localTime', value: localTime(now), type: 'string' },
      { name: 'additionalData', value: '', type: 'string' },
      { name: 'callBackUrl', value: input.callbackUrl, type: 'string' },
      { name: 'payerId', value: '0', type: 'long' },
    ])
    if (raw === null) {
      throw Err.conflict('ایجاد پرداخت ملت ناموفق بود (پاسخ نامعتبر بانک).')
    }

    const { code, refId } = parsePayResult(raw)
    if (code !== '0' || !/^[A-Za-z0-9]{1,100}$/.test(refId)) {
      throw Err.conflict(`ایجاد پرداخت ملت ناموفق بود (کد ${code}).`)
    }
    return {
      paymentUrl: `${STARTPAY}/${refId}`,
      gatewayRef: `${orderId}:t:${refId}`,
    }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // Without a valid stored order/receipt association, nonpayment cannot
    // be established. Preserve the hold for reconciliation.
    const m = /^(\d{1,15}):([ts]):([A-Za-z0-9]+)$/.exec(input.gatewayRef ?? '')
    if (!m) return { success: false, gatewayRef: input.gatewayRef ?? null, indeterminate: true }
    const [, orderId = '', kind = '', storedRef = ''] = m
    if (input.paymentId && orderId !== this.numericOrderId(input.paymentId)) {
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }

    if (kind !== 't') {
      // مرجع ماندگار از callback قبلی — مسیر ری-وریفای کارِ تایم‌اوت
      return this.verifyAndSettle(orderId, storedRef)
    }

    const saleReferenceId = qget(input.query, 'SaleReferenceId')
    if (!saleReferenceId) {
      // رارد H6 — کوئری خالی = کارِ تایم‌اوت روی پرداختِ بدون callback:
      // کاربر ممکن است در بانک پرداخته و callback نرسیده باشد → پول در PSP
      // گرفته شده → indeterminate (پنجره‌ی ۲۴h در reconcilePending)، نه fail
      // خودکار که یعنی بازگشت وجهِ اشتباه.
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }
    // توکن فرم باید با توکن init یکی باشد — جعلِ پیوند تراکنش ممنوع
    const formRef = qget(input.query, 'RefId')
    if (formRef !== undefined && formRef !== storedRef) {
      console.warn(
        `[mellat] callback RefId mismatch — leaving payment pending for a valid bank verification.`,
      )
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }

    const saleOrderId = qget(input.query, 'SaleOrderId')
    if (saleOrderId !== undefined && saleOrderId !== orderId) {
      return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
    }
    return this.verifyAndSettle(orderId, saleReferenceId)
  }

  // ── داخلی ──

  /** شناسه‌ی عددی سفارش — به‌پرداخت عدد می‌خواهد؛ هشِ پایدار از شناسه‌ی پرداخت (≤۱۵ رقم) */
  private numericOrderId(paymentId: string): string {
    const hex = new Bun.CryptoHasher('sha256').update(`mellat:${paymentId}`).digest('hex').slice(0, 12)
    return String(Number.parseInt(hex, 16))
  }

  /**
   * تایید و تسویه — کدها از جدول رسمی به‌پرداخت:
   *   ۰ موفق · ۴۳ قبلاً وریفای شده · ۴۵ قبلاً تسویه شده · ۴۸ برگشت خورده
   */
  private async verifyAndSettle(orderId: string, saleReferenceId: string): Promise<GatewayVerifyResult> {
    if (!/^[1-9]\d{0,18}$/.test(saleReferenceId) || BigInt(saleReferenceId) > 9223372036854775807n) {
      return { success: false, gatewayRef: null, indeterminate: true }
    }
    const { terminalId, userName, userPassword } = this.creds
    const common: BpParam[] = [
      { name: 'terminalId', value: terminalId, type: 'long' },
      { name: 'userName', value: userName, type: 'string' },
      { name: 'userPassword', value: userPassword, type: 'string' },
      { name: 'orderId', value: orderId, type: 'long' },
      { name: 'saleOrderId', value: orderId, type: 'long' },
      { name: 'saleReferenceId', value: saleReferenceId, type: 'long' },
    ]
    const composite = `${orderId}:s:${saleReferenceId}`

    const verified = await this.bpCall('bpVerifyRequest', common)
    if (verified === null) {
      // فالت/شبکه — قطعی نیست؛ کار دوباره می‌کوشد
      console.warn(
        `[mellat] verify فالت/شبکه — indeterminate: orderId=${orderId} saleRef=${saleReferenceId}`,
      )
      return { success: false, gatewayRef: composite, indeterminate: true }
    }
    if (verified === '48') {
      // پول به مشتری برگشته — قطعی
      console.warn(
        `[mellat] verify کد ۴۸ — تراکنش برگشت خورده (قطعی-ناموفق): orderId=${orderId} saleRef=${saleReferenceId}`,
      )
      return { success: false, gatewayRef: composite }
    }
    if (verified === '45') return { success: true, gatewayRef: composite }
    if (verified !== '0' && verified !== '43') {
      // بقیه‌ی کدها قطعی نیستند — failPayment بدون اطمینان یعنی
      // بازگشت وجه اشتباه (هم‌تراز زرین‌پال/سامان). stage-76: کدِ درگاه
      // لاگ می‌شود تا پس از تایید مستندات درگاه، کدهای «قطعاً پرداخت‌نشده»
      // به این جدول اضافه شوند.
      console.warn(
        `[mellat] verify کد ناشناخته ${verified} — indeterminate: orderId=${orderId} saleRef=${saleReferenceId}`,
      )
      return { success: false, gatewayRef: composite, indeterminate: true }
    }

    // تسویه — تراکنشِ وریفای‌شده‌ی تسویه‌نشده توسط بانک برگشت می‌خورد
    const settled = await this.bpCall('bpSettleRequest', common)
    if (settled === '0' || settled === '45') {
      return { success: true, gatewayRef: composite }
    }
    console.error(
      `[mellat] تسویه ناموفق (کد ${settled ?? 'نامعتبر'}) — indeterminate: تراکنش ${saleReferenceId} (کد verify=${verified})`,
    )
    return { success: false, gatewayRef: composite, indeterminate: true }
  }

  /** فراخوانی متد ساب — مقدار <return>؛ فالت یا خطای شبکه = null
   *
   * stage-76 — fetch سراسری (در Bun همان Bun.fetch است؛ رفتار production
   * یکسان) تا در تست‌ها mock-پذیر باشد — همان درسِ stage-74 برای http-util:
   * آداپتور ملت آخرین درگاهِ متصل به Bun.fetch بود و تستِ بدون-شبکه‌اش
   * ناممکن می‌کرد. */
  private async bpCall(op: string, params: BpParam[]): Promise<string | null> {
    const fields = params
      .map((p) => `      <${p.name} xsi:type="xsd:${p.type}">${escapeXml(p.value)}</${p.name}>`)
      .join('\n')
    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
      '  <soapenv:Body>\n' +
      `    <ns:${op} xmlns:ns="${SOAP_NS}">\n` +
      fields +
      '\n' +
      `    </ns:${op}>\n` +
      '  </soapenv:Body>\n' +
      '</soapenv:Envelope>'

    try {
      const res = await fetch(SOAP_URL, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
        body: envelope,
        // رارد ۴۵ — مهلت از کانفیگ (PAYMENT_TIMEOUT_MS)؛ قبلاً ۱۵ ثانیه‌ی ثابت
        signal: AbortSignal.timeout(this.config.gateway.timeoutMs),
      })
      if (!res.ok) return null
      const xml = await res.text()
      if (/<(?:[A-Za-z][\w-]*:)?Fault[\s>]/.test(xml)) return null
      // stage-76 — <return> با پیشوندِ namespace هم پذیرفته می‌شود
      // (هم‌ترازِ رجکسِ Fault بالاتر): پاسخِ ساب می‌تواند به شکلِ
      // <ns:return> یا <ax23:return> بیاید (بسته به استکِ سابِ بانک)؛
      // رجکسِ قبلی فقط <return> لِترال می‌گرفت ⇒ مقدار گم می‌شد ⇒ null ⇒
      // همه‌چیز indeterminate. پیشوندِ تگِ باز و بسته باید یکی باشد (\1).
      const m = /<([\w-]*:)?return[^>]*>([^<]*)<\/\1return>/i.exec(xml)
      const value = m?.[2]
      return value === undefined ? null : unescapeXml(value.trim())
    } catch {
      return null
    }
  }
}
