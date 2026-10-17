// src/server/auth.ts — کلاینت‌محور
import { authApi } from '#/lib/api-client'
import { postJson } from '#/lib/api-fetch'
import { setAccessToken, onUnauthorized } from '#/lib/auth-session'
import type { DeviceSignalsPayload } from '#/utils/deviceFingerprint'
import type {
  CheckPhoneResponse,
  RequestOtpResponse,
  VerifyOtpResponse,
} from '@sinshin/shared'

/** خطای Eden → Error فارسی */
function toError(error: unknown): Error {
  const e = error as { value?: { error?: { message?: string } } }
  return new Error(e?.value?.error?.message ?? 'خطای نامشخص')
}

/** چکِ سبک — کاربر جدید؟ نقش؟ (بدون پیامک) */
export async function checkIsNewUser(phone: string): Promise<CheckPhoneResponse> {
  return postJson<CheckPhoneResponse>('/auth/check', { phone })
}

/** درخواست کد OTP */
export async function requestOtp(phone: string) {
  const r = await postJson<RequestOtpResponse>('/auth/otp/request', { phone })
  return {
    success: true as const,
    message: 'کد ۶ رقمی ارسال شد.',
    cooldownSeconds: r.cooldownSeconds,
    ...(r.devCode ? { devCode: r.devCode } : {}),
  }
}

/** تأیید کد و ورود — با device fingerprint دو-لایه */
export async function verifyOtp(input: {
  phone: string
  code: string
  device: DeviceSignalsPayload
  refCode?: string | null
  termsAccepted?: boolean
  termsVersion?: string | null
}): Promise<VerifyOtpResponse> {
  const result = await postJson<VerifyOtpResponse>('/auth/otp/verify', {
    phone: input.phone,
    code: input.code,
    device: input.device,
    refCode: input.refCode ?? null,
    termsAccepted: input.termsAccepted ?? false,
    termsVersion: input.termsVersion ?? null,
  })
  setAccessToken(result.accessToken)
  return result
}

/** پروفایل + دستگاه‌های من */
export async function getAccount() {
  const { data, error } = await authApi.auth.me.get()
  if (error) {
    throw toError(error)
  }
  return data
}

/** خروج از این دستگاه */
export async function logout() {
  try { await authApi.auth.logout.post() } catch { /* هیچ‌کاری نمی‌کند */ }
  onUnauthorized()
  return { success: true as const }
}
