// src/server/auth.ts — کلاینت‌محور
import { authApi } from '#/lib/api-client'
import { publicApi } from '#/lib/api'
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
  const { data, error } = await publicApi.auth.check.post({ phone })
  if (error) throw toError(error)
  return data as CheckPhoneResponse
}

/** درخواست کد OTP */
export async function requestOtp(phone: string) {
  const { data, error } = await publicApi.auth['otp'].request.post({ phone })
  if (error) throw toError(error)
  const r = data as RequestOtpResponse
  return {
    success: true as const,
    message: 'کد ۴ رقمی ارسال شد.',
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
  const { data, error } = await publicApi.auth['otp'].verify.post({
    phone: input.phone,
    code: input.code,
    device: input.device,
    refCode: input.refCode ?? null,
    termsAccepted: input.termsAccepted ?? false,
    termsVersion: input.termsVersion ?? null,
  })
  if (error) throw toError(error)

  const result = data as VerifyOtpResponse
  setAccessToken(result.accessToken)
  return result
}

/** پروفایل + دستگاه‌های من */
export async function getAccount() {
  const { data, error } = await authApi.auth.me.get()
  if (error) {
    if ((error as { status?: number }).status === 401) onUnauthorized()
    throw toError(error)
  }
  return data
}

/** خروج از این دستگاه */
export async function logout() {
  try { await authApi.auth.logout.post() } catch { /* noop */ }
  onUnauthorized()
  return { success: true as const }
}

/** خروج از همه‌ی دستگاه‌ها */
export async function logoutAll() {
  try { await authApi.auth['logout-all'].post() } catch { /* noop */ }
  onUnauthorized()
  return { success: true as const }
}

/** حذف یکی از دستگاه‌های من */
export async function removeDevice(deviceId: string) {
  const { error } = await authApi.auth.devices({ id: deviceId }).delete()
  if (error) throw toError(error)
  return { success: true as const }
}