// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 11 از 14
// مسیر مقصد: apps/web/deep-tests/browser-support.test.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// تست عمیق ر۳۱ — منطق پشتیبانی مرورگر (قانون غلتان ۲ ساله + معافیت کرالر)
import { describe, expect, test } from 'bun:test'
import {
	browserLabel,
	isBrowserOutdated,
	parseUserAgent,
	shouldShowOutdatedBanner,
} from '#/lib/browserSupport'

const NOW = new Date('2025-11-01T00:00:00Z')

const UAS = {
	chromeModern:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	chromeOld:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.0.0 Safari/537.36',
	firefoxModern:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
	firefoxOld:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:104.0) Gecko/20100101 Firefox/104.0',
	safariModern:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
	safariOld:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
	edgeModern:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
	edgeLegacy:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/18.17763',
	ie11: 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
	samsung:
		'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
	androidWebView:
		'Mozilla/5.0 (Linux; Android 12; SM-A127F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
	googlebot:
		'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
	telegram:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) TelegramBot (like TwitterBot)',
	crawlerGeneric: 'curl/8.5.0',
	unknown: 'SomeWeirdApp/1.0',
}

describe('R31 — parseUserAgent', () => {
	test('کروم مدرن شناخته می‌شود', () => {
		expect(parseUserAgent(UAS.chromeModern)?.name).toBe('chrome')
		expect(parseUserAgent(UAS.chromeModern)?.major).toBe(141)
	})
	test('فایرفاکس مدرن/قدیمی', () => {
		expect(parseUserAgent(UAS.firefoxModern)?.name).toBe('firefox')
		expect(parseUserAgent(UAS.firefoxModern)?.major).toBe(143)
	})
	test('Edge کرومیومی در برابر EdgeHTML قدیمی', () => {
		expect(parseUserAgent(UAS.edgeModern)?.name).toBe('edge')
		expect(parseUserAgent(UAS.edgeLegacy)?.name).toBe('edge-legacy')
	})
	test('IE همیشه مرده', () => {
		expect(parseUserAgent(UAS.ie11)?.name).toBe('ie')
	})
	test('سامسونگ اینترنت', () => {
		expect(parseUserAgent(UAS.samsung)?.name).toBe('samsung')
		// طراحی ر۳۱: با وجود توکن Chrome، major = نسخه‌ی موتور (قانون غلتان موتور)
		expect(parseUserAgent(UAS.samsung)?.major).toBe(125)
	})
	test('UA تهی → null (fail-open)', () => {
		expect(parseUserAgent(null)).toBeNull()
		expect(parseUserAgent(undefined)).toBeNull()
		expect(parseUserAgent('')).toBeNull()
	})
	test('برچسب خوانا', () => {
		expect(browserLabel(UAS.chromeModern)).toBe('Chrome 141')
		expect(browserLabel(UAS.ie11)).toBe('IE')
	})
})

describe('R31 — قانون غلتان ۲ ساله', () => {
	test('کروم ۹۵ (۲۰۲۱) قدیمی است', () => {
		expect(isBrowserOutdated(UAS.chromeOld, NOW)).toBe(true)
	})
	test('کروم ۱۴۱ مدرن است', () => {
		expect(isBrowserOutdated(UAS.chromeModern, NOW)).toBe(false)
	})
	test('فایرفاکس ۱۰۴ قدیمی است', () => {
		expect(isBrowserOutdated(UAS.firefoxOld, NOW)).toBe(true)
	})
	test('سافاری ۱۵.۴ قدیمی است', () => {
		expect(isBrowserOutdated(UAS.safariOld, NOW)).toBe(true)
	})
	test('سافاری ۱۸.۵ مدرن است', () => {
		expect(isBrowserOutdated(UAS.safariModern, NOW)).toBe(false)
	})
	test('IE و Edge قدیمی همیشه منسوخ', () => {
		expect(isBrowserOutdated(UAS.ie11, NOW)).toBe(true)
		expect(isBrowserOutdated(UAS.edgeLegacy, NOW)).toBe(true)
	})
	test('UA ناشناخته fail-open — بنر نمی‌آید', () => {
		expect(isBrowserOutdated(UAS.unknown, NOW)).toBe(false)
		expect(isBrowserOutdated(null, NOW)).toBe(false)
	})
})

describe('R31 — shouldShowOutdatedBanner', () => {
	test('بسته‌شده توسط کاربر → هرگز', () => {
		expect(
			shouldShowOutdatedBanner({ ua: UAS.chromeOld, dismissed: true, now: NOW }),
		).toBe(false)
	})
	test('قدیمی + نبسته → بنر', () => {
		expect(
			shouldShowOutdatedBanner({ ua: UAS.chromeOld, dismissed: false, now: NOW }),
		).toBe(true)
	})
	test('مدرن → بدون بنر', () => {
		expect(
			shouldShowOutdatedBanner({ ua: UAS.chromeModern, dismissed: false, now: NOW }),
		).toBe(false)
	})
})
