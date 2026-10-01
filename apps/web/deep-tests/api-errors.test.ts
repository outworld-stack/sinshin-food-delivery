// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 12 از 14
// مسیر مقصد: apps/web/deep-tests/api-errors.test.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// تست عمیق ر۳۳+ر۳۶ — نقشه‌ی خطای API عربی (شامل پیام‌های جدید OTP)
import { describe, expect, test } from 'bun:test'
import { arApiErrorMessage } from '#/i18n/apiErrors'

describe('R33/R36 — arApiErrorMessage', () => {
	test('پیام‌های دقیق OTP', () => {
		expect(arApiErrorMessage('VALIDATION_ERROR', 'کد وارد شده صحیح نیست.')).toBe(
			'الكود المُدخل غير صحيح.',
		)
		expect(arApiErrorMessage(undefined, 'کدی برای این شماره صادر نشده یا منقضی شده است.')).toBe(
			'لم يُصدر كود لهذا الرقم أو انتهت صلاحيته.',
		)
	})

	test('الگوی پویا: N تلاش باقی مانده', () => {
		expect(arApiErrorMessage('VALIDATION_ERROR', 'کد وارد شده صحیح نیست. 2 تلاش باقی مانده.')).toBe(
			'الكود المُدخل غير صحيح. بقي ٢ من المحاولات.',
		)
	})

	test('الگوی پویا: پنجره‌ی قفل دقیقه‌ای', () => {
		expect(arApiErrorMessage('RATE_LIMITED', 'تلاش‌های ناموفق زیاد است؛ 15 دقیقه دیگر تلاش کنید.')).toBe(
			'عدد المحاولات الفاشلة كبير؛ حاول بعد ١٥ دقيقة.',
		)
	})

	test('الگوی نام محصول (ر۳۳)', () => {
		expect(
			arApiErrorMessage('CONFLICT', 'سایز انتخابی «برگر ذغالی» دیگر موجود نیست — سبد خرید را به‌روز کنید.'),
		).toContain('الحجم المختار')
	})

	test('کد عمومی', () => {
		expect(arApiErrorMessage('UNAUTHORIZED', 'ابتدا وارد حساب کاربری خود شوید.')).toBe(
			'يرجى تسجيل الدخول إلى حسابك أولاً.',
		)
	})

	test('نقشه‌نشده = فارسی دست‌نخورده', () => {
		expect(arApiErrorMessage(undefined, 'یک پیام خیلی جدید و نقشه‌نشده')).toBe('یک پیام خیلی جدید و نقشه‌نشده')
	})

	test('«خطای N» → «خطأ N»', () => {
		expect(arApiErrorMessage(undefined, 'خطای 404')).toBe('خطأ ٤٠٤')
	})
})
