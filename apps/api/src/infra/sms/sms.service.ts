// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/sms/sms.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ماسک PII در لاگ — شماره کامل هرگز وارد لاگ نمی‌شود
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/sms/sms.service.ts
// وضعیت: جایگزینی کامل فایل موجود — درگاه SMS.ir (verify API)
// ═══════════════════════════════════════════════════════════════

// src/infra/sms/sms.service.ts
import type { AppConfig, SmsConfig } from '#/infra/config/env'
import { maskPhone } from '#/domain/shared/pg'

/**
 * آداپتر SMS.ir — تنها نقطه‌ی ارسال SMS در کل سیستم.
 *
 * فاز-۲ (معماری جدید):
 *  • SMS.ir فقط «قالب تأییدشده + پارامترها» را می‌پذیرد — متن آزاد حذف شد.
 *  • همه‌ی شناسه‌ی قالب‌ها از env خوانده می‌شوند (SMS_TEMPLATE_ID_*).
 *  • لینک گزارش: بک‌اند فقط TOKEN می‌سازد؛ SMS.ir خودش URL را از روی
 *    قالب (https://…/api/reports/download/#TOKEN#) می‌سازد.
 *  • سقف مقدار هر پارامتر در SMS.ir ۲۵ کاراکتر است — cutter امن همین‌جاست.
 *
 * ضد-کرش:
 *  • هرگز throw نمی‌کند — همیشه boolean برمی‌گرداند (قرارداد otp-core و jobs).
 *  • تایم‌اوت از کانفیگ + یک تلاش مجدد روی خطای شبکه/۵xx.
 *  • provider=console (توسعه): پیام در لاگ چاپ می‌شود — بقیه‌ی سیستم
 *    بدون پنل پیامک هم کامل بالا می‌آید.
 */

const SMS_IR_SEND_VERIFY = 'https://api.sms.ir/v1/send/verify'

/** سقف طول مقدار پارامتر در SMS.ir (مستندات رسمی) */
const PARAM_VALUE_MAX = 25

export interface SmsParam {
  name: string
  value: string
}

/** خروجی فراخوانی — جزئیات برای لاگ عملیاتی */
export interface SmsSendResult {
  ok: boolean
  /** شناسه‌ی یکتای پیامک (از SMS.ir) */
  messageId?: number
  /** اعتبار مصرفی */
  cost?: number
  /** علت شکست — فقط برای لاگ */
  error?: string
}

export class SmsService {
  constructor(private readonly config: AppConfig) {}

  private get sms(): SmsConfig {
    return this.config.sms
  }

  describe(): string {
    return this.sms.provider === 'real'
      ? `SMS.ir (قالب‌ها: otp=${this.sms.templateOtp}${this.sms.templateCourierOtp ? `, courier=${this.sms.templateCourierOtp}` : ''}, daily=${this.sms.templateDailyReport}, weekly=${this.sms.templateWeeklyReport}, health=${this.sms.templateHealthAlert})`
      : 'console (فقط لاگ — بدون پنل SMS.ir)'
  }

  // ═══════════ ورودی‌های دامنه — تنها این‌ها از بیرون صدا زده می‌شوند ═══════════

  /** کد ورود کاربر — قالب otp (#CODE#) */
  async sendOtp(phone: string, code: string): Promise<boolean> {
    return (await this.sendVerify(phone, this.sms.templateOtp, [{ name: 'CODE', value: code }])).ok
  }

  /**
   * کد ورود پیک — قالب اختصاصی courier-otp (#CODE#)؛
   * اگر قالب پیک تعریف نشده باشد، همان قالب otp استفاده می‌شود
   * (متن‌ها هم‌ارزش‌اند — رفتار خاموشِ نرم، بوت نمی‌شکند).
   */
  async sendCourierOtp(phone: string, code: string): Promise<boolean> {
    const template = this.sms.templateCourierOtp ?? this.sms.templateOtp
    return (await this.sendVerify(phone, template, [{ name: 'CODE', value: code }])).ok
  }

  /**
   * لینک گزارش روزانه/هفتگی — قالب daily-report / weekly-report (#TOKEN#).
   * ⚠️ فقط TOKEN فرستاده می‌شود؛ SMS.ir خودش URL را از قالب می‌سازد.
   */
  async sendReportToken(
    phone: string,
    kind: 'daily' | 'weekly',
    token: string,
  ): Promise<boolean> {
    const template =
      kind === 'daily' ? this.sms.templateDailyReport : this.sms.templateWeeklyReport
    return (await this.sendVerify(phone, template, [{ name: 'TOKEN', value: token }])).ok
  }

  /**
   * هشدار سلامت — قالب health-alert (#STATUS# / #SERVICE# / #DETAIL#).
   * هر سه مقدار باید ≤ ۲۵ کاراکتر باشند (cutter پایین را می‌گذرند).
   */
  async sendHealthAlert(
    phone: string,
    status: string,
    service: string,
    detail: string,
  ): Promise<boolean> {
    return (
      await this.sendVerify(phone, this.sms.templateHealthAlert, [
        { name: 'STATUS', value: status },
        { name: 'SERVICE', value: service },
        { name: 'DETAIL', value: detail },
      ])
    ).ok
  }

  // ═══════════ هسته — POST /v1/send/verify ═══════════

  // stage-55 — ماسک PII در لاگ — شماره کامل هرگز وارد لاگ نمی‌شود
  /**
   * ارسال با قالب — عمومی و safe:
   *  • console → چاپ در لاگ
   *  • templateId صفر/نامعتبر → false (بدون فراخوانی)
   *  • مقادیر به ۲۵ کاراکتر cut می‌شوند (مستندات SMS.ir)
   *  • شبکه/۵xx → یک تلاش مجدد؛ ۴xx → بدون تلاش مجدد
   */
  async sendVerify(phone: string, templateId: number, params: SmsParam[]): Promise<SmsSendResult> {
    if (this.sms.provider !== 'real') {
      console.log(
        `[sms:console] → ${maskPhone(phone)} (قالب ${templateId}): ` +
        params.map((p) => `${p.name}=${p.value}`).join(' , '),
      )
      return { ok: true }
    }
    if (!this.sms.apiKey) {
      console.error('[sms] SMS_IR_API_KEY خالی است — پیامک واقعی ممکن نیست.')
      return { ok: false, error: 'no-api-key' }
    }
    if (!Number.isInteger(templateId) || templateId <= 0) {
      console.error(`[sms] شناسه‌ی قالب نامعتبر برای ${maskPhone(phone)}: ${templateId}`)
      return { ok: false, error: 'invalid-template-id' }
    }

    const body = JSON.stringify({
      mobile: phone,
      templateId,
      parameters: params.map((p) => ({
        name: p.name,
        value: p.value.length > PARAM_VALUE_MAX ? p.value.slice(0, PARAM_VALUE_MAX) : p.value,
      })),
    })

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/plain',
      'x-api-key': this.sms.apiKey,
    }

    // تلاش ۱ + تلاش ۲ (فقط خطای شبکه/۵xx)
    let lastError = 'unknown'
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await Bun.fetch(SMS_IR_SEND_VERIFY, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(this.sms.timeoutMs),
        })
        // خطاهای ۴xx (احراز/قالب/پارامتر) با تلاش مجدد درست نمی‌شوند
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const text = await res.text().catch(() => '')
          console.error(`[sms] SMS.ir ${res.status} برای ${maskPhone(phone)}: ${text.slice(0, 200)}`)
          return { ok: false, error: `http-${res.status}` }
        }
        if (res.status >= 500 || res.status === 429) {
          lastError = `http-${res.status}`
          if (attempt === 1) {
            await sleep(700)
            continue
          }
          console.error(`[sms] SMS.ir ${res.status} برای ${maskPhone(phone)} (پس از تلاش مجدد)`)
          return { ok: false, error: lastError }
        }

        const json = (await res.json().catch(() => null)) as {
          status?: number
          message?: string
          data?: { messageId?: number; cost?: number }
        } | null
        // قرارداد SMS.ir: status=1 یعنی موفق
        if (json && json.status === 1) {
          return {
            ok: true,
            messageId: json.data?.messageId,
            cost: json.data?.cost,
          }
        }
        lastError = `status-${json?.status ?? 'parse'}: ${json?.message ?? ''}`
        // پاسخ ۲۰۰ با status != 1 معمولاً خطای منطقی (شماره/قالب) است — تلاش مجدد بی‌فایده
        console.error(`[sms] SMS.ir پاسخ ناموفق برای ${maskPhone(phone)}: ${lastError.slice(0, 200)}`)
        return { ok: false, error: lastError }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt === 1) {
          await sleep(700)
          continue
        }
        console.error(`[sms] درگاه در دسترس نیست (${maskPhone(phone)}):`, lastError)
        return { ok: false, error: 'network' }
      }
    }
    return { ok: false, error: lastError }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))