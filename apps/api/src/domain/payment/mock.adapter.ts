//src/domain/payment/mock.adapter.ts
import type { AppConfig } from '#/infra/config/env'
import { signState } from './state'
import type {
  GatewayInitInput,
  GatewayInitResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
  PaymentGateway,
} from './gateway.types'

/** درگاه ساختگی — نتیجه با POST {success: true|false} انتخابی (قابل-پیش‌بینی برای تست) */
export class MockAdapter implements PaymentGateway {
  readonly id = 'MOCK'
  readonly mode = 'mock' as const

  constructor(private readonly config: AppConfig) {}

  async init(input: GatewayInitInput): Promise<GatewayInitResult> {
    const state = signState(input.paymentId, this.config.jwtSecret)
    return { paymentUrl: `/api/payments/mock/${state}`, gatewayRef: input.paymentId }
  }

  async verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult> {
    return { success: input.query.success === 'true', gatewayRef: input.gatewayRef }
  }
}