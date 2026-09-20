//src/domain/payment/zarinpal.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

const REQUEST_URL = 'https://payment.zarinpal.com/pg/v4/payment/request.json'
const VERIFY_URL = 'https://payment.zarinpal.com/pg/v4/payment/verify.json'
const STARTPAY = 'https://payment.zarinpal.com/pg/StartPay'

/** زرین‌پال — مستقیم (ریدایرکت + verify در callback) */
export class ZarinpalAdapter implements PaymentGateway {
  readonly id = 'ZARINPAL'
  readonly mode = 'direct' as const

  constructor(private readonly config: AppConfig) {}

  private get merchantId(): string {
    const id = this.config.gateway.zarinpalMerchantId
    if (!id) throw Err.conflict('ZARINPAL_MERCHANT_ID تنظیم نشده است.')
    return id
  }

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    const res = await Bun.fetch(REQUEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: input.amount * 10, // تومان → ریال
        callback_url: input.callbackUrl,
        description: input.description,
        metadata: input.mobile ? { mobile: input.mobile } : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json()) as { data?: { authority?: string } }
    const authority = json.data?.authority
    if (!authority) throw Err.conflict('ایجاد پرداخت زرین‌پال ناموفق بود.')
    return { paymentUrl: `${STARTPAY}/${authority}`, gatewayRef: authority }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    const authority = input.query.authority ?? input.gatewayRef ?? ''
    const res = await Bun.fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: input.amount * 10,
        authority,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json()) as { data?: { code?: number } }
    // 100 = موفق ، 101 = قبلاً verify شده (idempotent)
    return {
      success: json.data?.code === 100 || json.data?.code === 101,
      gatewayRef: authority,
    }
  }
}