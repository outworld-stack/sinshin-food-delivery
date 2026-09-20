//src/domain/payment/gateway.types.ts
import type { PaymentId } from '#/domain/shared/brand'

/**
 * قرارداد آداپتر درگاه — مستقیم/غیرمستقیم/mock همه همین.
 * paymentId برنددار (id موجودیت داخلی)؛ gatewayRef string خارجی است (در gateway результата).
 */
export interface GatewayInitInput {
  paymentId: PaymentId
  /** کد نمایشی سفارش — فقط برای description درگاه */
  displayId: string
  /** تومان */
  amount: number
  callbackUrl: string
  description: string
  mobile?: string | null
}

export interface GatewayInitResult {
  paymentUrl: string
  /** شناسه‌ی خارجی درگاه — authority/token */
  gatewayRef: string | null
}

export interface GatewayVerifyInput {
  gatewayRef: string | null
  amount: number
  /** query خام بازگشت درگاه */
  query: Record<string, string>
}

export interface GatewayVerifyResult {
  success: boolean
  gatewayRef: string | null
}

export interface PaymentGateway {
  id: string
  mode: 'direct' | 'indirect' | 'mock'
  init(input: GatewayInitInput): Promise<GatewayInitResult>
  verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult>
}