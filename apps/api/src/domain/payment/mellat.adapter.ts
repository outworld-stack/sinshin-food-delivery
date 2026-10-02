//src/domain/payment/mellat.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
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

/** تاریخ محلی شش‌رقمی — قالب خواسته‌شده‌ی به‌پرداخت */
const localDate = (d: Date): string => {
  const yy = String(d.getFullYear()).slice(2).padStart(2, '0')
  return `${yy}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** ساعت محلی شش‌رقمی */
const localTime = (d: Date): string =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('')

/** خروجی bpPayRequest — «کد،مرجع»؛ هر دو ترتیبِ محتمل را می‌پذیرد */
const parsePayResult = (raw: string): { code: string; refId: string } => {
  const parts = raw.split(',').map((p) => p.trim())
  const [a = '', b = ''] = parts
  if (parts.length === 2) {
    if (a === '0' && b !== '') return { code: '0', refId: b }
    if (b === '0' && a !== '') return { code: '0', refId: a }
  }
  return { code: a, refId: '' }
}

/**
 * بانک ملت (به‌پرداخت) — مستقیم، ساب قدیمی شاپرک.
 *
 * جریان:
 *   ۱) init → bpPayRequest (مبلغ ریال؛ orderId = هش عددیِ پایدار از
 *      شناسه‌ی پرداخت) → RefId؛ کاربر به StartPay/RefId می‌رود.
 *   ۲) برگشت بانک به callback با فرم POST (ResCode/RefId/SaleOrderId/
 *      SaleReferenceId) — فقط ResCode=0 مسیر تایید دارد.
 *   ۳) verify → bpVerifyRequest و بلافاصله bpSettleRequest سمت سرور؛
 *      مرجع قطعی تراکنش SaleReferenceId است.
 *
 * نکته‌ی gatewayRef — دو حالتِ کدگذاری‌شده با برچسب:
 *   • پس از init: «orderId:t:RefId» — t یعنی توکنِ صفحه‌ی پرداخت؛
 *   • پس از callback: «orderId:s:SaleReferenceId» — s یعنی مرجعِ ماندگار
 *     تراکنش که job تایم‌اوت بدون query هم می‌تواند دوباره وریفای کند
 *     (هم‌مکانیزم RefNum سامان از رارد ۲۳).
 *
 * پیوند امنیتی (هم‌تراز امن-۴ بقیه‌ی درگاه‌ها):
 *   orderId همیشه از مقدارِ ذخیره‌شده خوانده می‌شود نه از فرم برگشتی؛
 *   و RefId فرم باید با توکنِ init یکی باشد — فرم جعلی نمی‌تواند
 *   تراکنشِ سفارش دیگری را به این پرداخت بچسباند.
 *
 * ریسک پذیرفته‌شده (هم‌تراز سامان): اگر callback هرگز نرسد (تب بسته
 * شده)، تراکنش وریفای نشده و شاپرک خودش مبلغ را آزاد می‌کند؛ job
 * تایم‌اوت سفارش را قطعاً fail می‌کند.
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
      { name: 'amount', value: String(input.amount * 10), type: 'long' }, // تومان → ریال
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
    if (code !== '0' || !refId) {
      throw Err.conflict(`ایجاد پرداخت ملت ناموفق بود (کد ${code}).`)
    }
    return {
      paymentUrl: `${STARTPAY}/${refId}`,
      gatewayRef: `${orderId}:t:${refId}`,
    }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // کدگذاری gatewayRef را بالای فایل ببینید؛ بدون آن نه orderId
    // داریم نه مرجع تراکنش — داده‌ی ناشناخته = شکست قطعی (هم‌تراز سامان)
    const m = /^(\d{1,15}):([ts]):([A-Za-z0-9]+)$/.exec(input.gatewayRef ?? '')
    if (!m) return { success: false, gatewayRef: input.gatewayRef ?? null }
    const [, orderId = '', kind = '', storedRef = ''] = m

    if (kind !== 't') {
      // مرجع ماندگار از callback قبلی — مسیر ری-وریفای job تایم‌اوت
      return this.verifyAndSettle(orderId, storedRef)
    }

    const resCode = input.query.ResCode ?? input.query.resCode
    if (resCode === undefined) {
      // query خالی = job تایم‌اوت روی پرداختِ بدون callback → رهاشده
      return { success: false, gatewayRef: input.gatewayRef }
    }
    if (resCode !== '0') {
      // خود بانک شکست را اعلام کرده (۱۷ = انصراف مشتری) — قطعی
      return { success: false, gatewayRef: input.gatewayRef }
    }

    // توکن فرم باید با توکن init یکی باشد — جعلِ پیوند تراکنش ممنوع
    const formRef = input.query.RefId ?? input.query.refId
    if (formRef !== undefined && formRef !== storedRef) {
      return { success: false, gatewayRef: input.gatewayRef }
    }

    const saleReferenceId = input.query.SaleReferenceId ?? input.query.saleReferenceId
    if (!saleReferenceId) {
      // ResCode=0 بدون مرجع — پاسخ ناقص بانک؛ قطعی نیست
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
      // فالت/شبکه — قطعی نیست؛ job دوباره می‌کوشد
      return { success: false, gatewayRef: composite, indeterminate: true }
    }
    if (verified === '48') {
      // پول به مشتری برگشته — قطعی
      return { success: false, gatewayRef: composite }
    }
    if (verified !== '0' && verified !== '43') {
      // بقیه‌ی کدها قطعی نیستند — failPayment بدون اطمینان یعنی
      // بازگشت وجه اشتباه (هم‌تراز زرین‌پال/سامان)
      return { success: false, gatewayRef: composite, indeterminate: true }
    }

    // تسویه — تراکنشِ وریفای‌شده‌ی تسویه‌نشده توسط بانک برگشت می‌خورد
    const settled = await this.bpCall('bpSettleRequest', common)
    if (settled === '0' || settled === '45') {
      return { success: true, gatewayRef: composite }
    }
    console.error(`[mellat] تسویه ناموفق (کد ${settled ?? 'نامعتبر'}) — تراکنش ${saleReferenceId}`)
    return { success: false, gatewayRef: composite, indeterminate: true }
  }

  /** فراخوانی متد ساب — مقدار <return>؛ فالت یا خطای شبکه = null */
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
      const res = await Bun.fetch(SOAP_URL, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
        body: envelope,
        // رارد ۴۵ — مهلت از کانفیگ (PAYMENT_TIMEOUT_MS)؛ قبلاً ۱۵ ثانیه‌ی ثابت
        signal: AbortSignal.timeout(this.config.gateway.timeoutMs),
      })
      const xml = await res.text()
      if (/<(?:[A-Za-z][\w-]*:)?Fault[\s>]/.test(xml)) return null
      const m = /<return[^>]*>([^<]*)<\/return>/i.exec(xml)
      const value = m?.[1]
      return value === undefined ? null : unescapeXml(value.trim())
    } catch {
      return null
    }
  }
}