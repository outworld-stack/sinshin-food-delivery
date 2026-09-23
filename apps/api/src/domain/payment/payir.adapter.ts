//src/domain/payment/payir.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

const SEND_URL = 'https://pay.ir/pg/send'
const VERIFY_URL = 'https://pay.ir/pg/verify'

/** پی‌ایر — غیرمستقیم (لینک پرداخت) */
export class PayirAdapter implements PaymentGateway {
  readonly id = 'PAYIR'
  readonly mode = 'indirect' as const

  constructor(private readonly config: AppConfig) {}

  private get apiKey(): string {
    const key = this.config.gateway.payirApiKey
    if (!key) throw Err.conflict('PAYIR_API_KEY تنظیم نشده است.')
    return key
  }

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    const res = await Bun.fetch(SEND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api: this.apiKey,
        amount: input.amount * 10,
        callback: input.callbackUrl,
        description: input.description,
        mobile: input.mobile ?? undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    // round-16 — پاسخ غیر-JSON درگاه نباید ۵۰۰ بدهد
    const json = (await res.json().catch(() => null)) as { token?: string } | null
    if (!json?.token) throw Err.conflict('ایجاد پرداخت پی‌ایر ناموفق بود.')
    return { paymentUrl: `https://pay.ir/pg/${json.token}`, gatewayRef: json.token }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    // امن-۴: مرجع ذخیره‌شده در DB مقدم است؛ query فقط fallback —
    // هم‌تراز با زرین‌پال (stage two). قبلاً token کوئری مقدم بود و
    // state جعلی می‌توانست verify را روی token دلخواه اجرا کند.
    const token = input.gatewayRef ?? input.query.token ?? ''
    const res = await Bun.fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api: this.apiKey, token }),
      signal: AbortSignal.timeout(15_000),
    })
    // round-16 — پاسخ غیر-JSON درگاه (HTML/تایم‌اوت سرویس): وضعیت «نامشخص»،
    // نه شکست قطعی — failPayment بدون اطلاع یعنی بازگشت وجه اشتباه؛
    // job تایم‌اوت دوباره verify می‌کند (هم‌تراز با indeterminate زرین‌پال)
    const json = (await res.json().catch(() => null)) as {
      status?: number
      amount?: number
    } | null
    if (json === null) {
      return { success: false, gatewayRef: token, indeterminate: true }
    }
    // phase-2: چک مبلغ — پاسخ verify پی‌ایر شامل amount است؛ تطابق اجباری
    const amountOk = json.amount === undefined || Number(json.amount) === input.amount * 10
    if (json.status === 1 && !amountOk) {
      console.error(
        `[payir] مبلغ verify (${json.amount}) با مبلغ پرداخت (${input.amount * 10}) نمی‌خواند`,
      )
    }
    return { success: json.status === 1 && amountOk, gatewayRef: token }
  }
}