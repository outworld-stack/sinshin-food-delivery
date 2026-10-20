//src/domain/payment/gateway.types.ts
import type { PaymentId } from '#/domain/shared/brand'

/**
 * قرارداد آداپتر درگاه — مستقیم/غیرمستقیم/ساختگی همه همین.
 * paymentId برنددار (id موجودیت داخلی)؛ gatewayRef string خارجی است (در نتیجه‌ی gateway).
 */
export interface GatewayInitInput {
  paymentId: PaymentId
  /** کد نمایشی سفارش — فقط برای توضیحات درگاه */
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
  /** Internal attempt used to validate any PSP reservation identifier. */
  paymentId?: PaymentId
  gatewayRef: string | null
  amount: number
  /** کوئری خام بازگشت درگاه */
  query: Record<string, string>
}

export interface GatewayVerifyResult {
  success: boolean
  gatewayRef: string | null
  indeterminate?: boolean
}

export interface GatewayResumeInput {
  paymentId: PaymentId
  gatewayRef: string | null
  paymentUrl: unknown
}

export interface PaymentGateway {
  id: string
  mode: 'direct' | 'indirect' | 'mock'
  init(input: GatewayInitInput): Promise<GatewayInitResult>
  /** Reopen the same attempt, validating its destination and stored token. */
  resumeUrl(input: GatewayResumeInput): string | null
  verify(input: GatewayVerifyInput): Promise<GatewayVerifyResult>
}
