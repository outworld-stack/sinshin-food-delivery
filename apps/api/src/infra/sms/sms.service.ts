//src/infra/sms/sms.service.ts
import type { AppConfig } from '#/infra/config/env'
/**
 * آداپتر پیامک — تنها نقطه‌ی ارسال SMS در کل سیستم.
 * console = فقط لاگ (محیط توسعه بدون اعتبارنامه) | real = درگاه با Bun.fetch
 */
export class SmsService {
  constructor(private readonly config: AppConfig) {}

  describe(): string {
    return this.config.sms.provider === 'console' || !this.config.sms.baseUrl
      ? 'console (فقط لاگ)'
      : `درگاه واقعی (${this.config.sms.baseUrl})`
  }

  async send(phone: string, message: string): Promise<boolean> {
    if (this.config.sms.provider === 'console' || !this.config.sms.baseUrl || !this.config.sms.apiKey) {
      console.log(`[sms:console] → ${phone}: ${message}`)
      return true
    }

    try {
      const res = await Bun.fetch(`${this.config.sms.baseUrl}/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.sms.apiKey}`,
        },
        body: JSON.stringify({
          from: this.config.sms.sender,
          to: phone,
          text: message,
        }),
        // رارد ۴۵ — مهلت از کانفیگ (SMS_TIMEOUT_MS)؛ قبلاً ۱۰ ثانیه‌ی ثابت
        signal: AbortSignal.timeout(this.config.sms.timeoutMs),
      })
      if (!res.ok) {
        console.error(`[sms] درگاه ${res.status} برای ${phone}`)
        return false
      }
      return true
    } catch (err) {
      console.error(`[sms] درگاه در دسترس نیست (${phone}):`, err)
      return false
    }
  }
}