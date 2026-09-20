//src/domain/payment/sep.adapter.ts
import { Err } from '#/domain/shared/errors'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

/**
 * بانک سامان (SEP) — اسکلت مستند.
 * فعال‌سازی نیازمند امضای RSA ترمینال و شناسه‌های بانکی:
 *   init    → https://sep.shaparak.ir/payment.aspx?action=init
 *   verify  → https://sep.shaparak.ir/payments/referencepayment.asmx (VerifyTransaction)
 * تا تامین کلید، فراخوانی خطا می‌دهد (SEP_TERMINAL_ID در env آماده است).
 */
export class SepAdapter implements PaymentGateway {
  readonly id = 'SEP'
  readonly mode = 'direct' as const

  async init(_input: GatewayInitInput): Promise<GatewayInitResult> {
    throw Err.conflict('آداپتر سامان هنوز پیکربندی نشده است (SEP_TERMINAL_ID + کلید امضا).')
  }

  async verify(_input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    throw Err.conflict('آداپتر سامان هنوز پیکربندی نشده است.')
  }
}