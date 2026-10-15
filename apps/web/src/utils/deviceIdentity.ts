// ═══════════════════════════════════════════════════════════════
// stage-70 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/utils/deviceIdentity.ts
// وضعیت: فایل جدید
// تغییر: تشخیص نوع/برند/مدل دستگاه — «نام دستگاه» در پنل ادمین و پروفایل
// ═══════════════════════════════════════════════════════════════

// src/utils/deviceIdentity.ts
//
// خروجی فقط «نمایشی» است و در قرارداد device به‌عنوان deviceType /
// deviceBrand / deviceModel می‌رود — سمت سرور (fingerprint، سهمیه، ریسک،
// لینک) هرگز از آن استفاده نمی‌کند؛ جعلش اثر عملکردی ندارد.
//
// منابع تشخیص (به‌ترتیب اعتبار):
//  ۱) navigator.userAgentData.getHighEntropyValues — فقط Chromium/اندروید؛
//     مدل واقعی (مثل SM-A556B) می‌دهد (UA کاهش‌یافته‌ی کروم فقط «K» دارد).
//  ۲) UA خود مرورگر — اندروید: کد مدل/نام بازاریابی؛ iOS: خانواده + نسخه.
//  ۳) نقشه‌ی «شناسه مدل → نام» برای اپل (خواسته‌ی کارفرما) — شناسه‌هایی مثل
//     iPhone15,3 وقتی در دسترس‌اند به نام بازاریابی (۱۶ پرو مکس) ترجمه
//     می‌شوند. نقشه embed شده (بدون نیاز به اینترنت)؛ اگر شناسه در نقشه
//     نبود (نقشه لازم به‌روزرسانی)، طبق دستور کارفرما fallback = «iOS».
//     نکته‌ی صادقانه: سافاری iOS شناسه‌ی مدل را به وب نمی‌دهد (UA فریز
//     است) — چنین کاربرانی «iOS + نسخه» می‌بینند؛ اندروید و دسکتاپ مدل
//     واقعی می‌گیرند.

export interface DeviceIdentity {
	type: 'mobile' | 'tablet' | 'desktop'
	/** قاعده‌مند: apple|samsung|xiaomi|huawei|honor|google|other — دسکتاپ: windows|macos|linux */
	brand: string | null
	/** مدل/جزئیات: «A55»، «Redmi Note 10»، «16 Pro»، «iOS 18.1»، null = نامشخص */
	model: string | null
}

/** ورودی high-entropy از userAgentData (اگر در دسترس بود) */
export interface HighEntropyInfo {
	model?: string
	platform?: string
	platformVersion?: string
}

// ── نقشه‌ی شناسه‌ی مدل اپل → نام بازاریایی (تا خانواده‌ی iPhone 16) ──
// شناسه‌ها همان فرمت سیستم‌اند: iPhone17,1 = 16 Pro.
const APPLE_MODEL_NAMES: Record<string, string> = {
	// iPhone 8 / X
	'iPhone10,1': '8',
	'iPhone10,4': '8',
	'iPhone10,2': '8 Plus',
	'iPhone10,5': '8 Plus',
	'iPhone10,3': 'X',
	'iPhone10,6': 'X',
	// XS / XR
	'iPhone11,2': 'XS',
	'iPhone11,4': 'XS Max',
	'iPhone11,6': 'XS Max',
	'iPhone11,8': 'XR',
	// 11
	'iPhone12,1': '11',
	'iPhone12,3': '11 Pro',
	'iPhone12,5': '11 Pro Max',
	'iPhone12,8': 'SE 2',
	// 12
	'iPhone13,1': '12 mini',
	'iPhone13,2': '12',
	'iPhone13,3': '12 Pro',
	'iPhone13,4': '12 Pro Max',
	// 13
	'iPhone14,2': '13 Pro',
	'iPhone14,3': '13 Pro Max',
	'iPhone14,4': '13 mini',
	'iPhone14,5': '13',
	'iPhone14,6': 'SE 3',
	'iPhone14,7': '14',
	'iPhone14,8': '14 Plus',
	// 14 Pro
	'iPhone15,2': '14 Pro',
	'iPhone15,3': '14 Pro Max',
	// 15
	'iPhone15,4': '15',
	'iPhone15,5': '15 Plus',
	'iPhone16,1': '15 Pro',
	'iPhone16,2': '15 Pro Max',
	// 16
	'iPhone16,3': '16e',
	'iPhone17,1': '16 Pro',
	'iPhone17,2': '16 Pro Max',
	'iPhone17,3': '16',
	'iPhone17,4': '16 Plus',
	// iPad — رایج‌ترین‌ها؛ بقیه → «iPad»
	'iPad11,6': 'iPad 8',
	'iPad11,7': 'iPad 8',
	'iPad12,1': 'iPad 9',
	'iPad12,2': 'iPad 9',
	'iPad13,1': 'iPad Air 4',
	'iPad13,2': 'iPad Air 4',
	'iPad13,4': 'iPad Pro 11 (M1)',
	'iPad13,5': 'iPad Pro 11 (M1)',
	'iPad13,8': 'iPad Pro 12.9 (M1)',
	'iPad13,9': 'iPad Pro 12.9 (M1)',
	'iPad14,1': 'iPad Air 5',
	'iPad14,2': 'iPad Air 5',
	'iPad14,3': 'iPad Pro 11 (M2)',
	'iPad14,4': 'iPad Pro 11 (M2)',
	'iPad14,5': 'iPad Pro 12.9 (M2)',
	'iPad14,6': 'iPad Pro 12.9 (M2)',
}

/** شناسه → نام؛ نبود در نقشه = null (فراخواننده fallback می‌کند) */
export function appleModelName(identifier: string): string | null {
	const id = identifier.trim()
	const direct = APPLE_MODEL_NAMES[id]
	if (direct) return direct
	if (/^iPad/.test(id)) return 'iPad'
	return null
}

// ── سامسونگ: کد → مدل بازاریابی ──
// قاعده‌ی A/M series: SM-A556B → A55 (رقم سوم = نسل/بازنگری).
// پرچمداران S/Note/Z قطری‌اند و جدول می‌خواهند.
const SAMSUNG_FLAGSHIP: Record<string, string> = {
	'SM-S911': 'S23',
	'SM-S916': 'S23 Ultra',
	'SM-S918': 'S23 Ultra',
	'SM-S921': 'S24',
	'SM-S926': 'S24 Ultra',
	'SM-S928': 'S24 Ultra',
	'SM-S931': 'S25',
	'SM-S936': 'S25 Ultra',
	'SM-S938': 'S25 Ultra',
	'SM-F711': 'Z Flip 3',
	'SM-F721': 'Z Flip 4',
	'SM-F731': 'Z Flip 5',
	'SM-F956': 'Z Fold 6',
}

function normalizeSamsungModel(code: string): string {
	const prefix = SAMSUNG_FLAGSHIP[code.replace(/B$/i, '')]
	if (prefix) return prefix
	const m = /^SM-([A-Z])(\d{2})\d/.exec(code)
	if (m) return `${m[1]}${m[2]}`
	return code.replace(/^(SM-|GT-|SC-)/i, '')
}

function normalizeModel(brand: string, rawModel: string): string {
	const model = rawModel.trim()
	if (!model) return model
	if (brand === 'samsung') return normalizeSamsungModel(model)
	return model
}

// ── برند از کد/نام مدل اندروید ──
function androidBrand(model: string): string | null {
	const m = model.toLowerCase()
	if (/^sm-|^gt-|^sc-|samsung|galaxy/.test(m)) return 'samsung'
	if (/redmi|poco|xiaomi|^mi\s|^m2\d{3}|^hm|^note\s?\d|^2\d{4}[a-z]?/.test(m))
		return 'xiaomi'
	if (/huawei|harmony|^ane-|^clt-|^els-|^jny-/.test(m)) return 'huawei'
	if (/honor|^hry-|^cma-/.test(m)) return 'honor'
	if (/pixel/.test(m)) return 'google'
	return null
}

/** استخراج کد مدل اندروید از UA (کروم قدیمی/فایرفاکس/سافاری-اندروید) */
function androidModelFromUa(ua: string): string | null {
	// الگوی رایج: (Linux; Android 14; SM-A556B) یا (Linux; Android 11; Redmi Note 10 Pro)
	const m =
		/Android[^;)]*;\s*([A-Za-z0-9][A-Za-z0-9\s._+-]*?)\s*(?:Build\/|[);])/i.exec(
			ua,
		)
	if (!m || !m[1]) return null
	const model = m[1].trim()
	// UA کاهش‌یافته‌ی کروم (فریز): «K» یا «Android» → مدل واقعی باید از
	// high-entropy بیاید؛ اگر نیامد، null (نمایش فقط برند).
	if (/^(k|android)$/i.test(model)) return null
	if (/^w\)$/i.test(model)) return null
	return model
}

/** نسخه‌ی iOS از UA: «CPU iPhone OS 17_5 like Mac OS X» */
function iosVersionFromUa(ua: string): string | null {
	const m = /(?:iPhone|iPad) OS (\d+)[._](\d+)/i.exec(ua)
	if (!m) return null
	return `${m[1]}.${m[2]}`
}

/**
 * تشخیص هویت دستگاه — خالص و ایزومورفیک (نه window نه document)؛
 * navigator/userAgentData به‌عنوان ورودی داده می‌شوند.
 */
export function detectDeviceIdentity(
	ua: string,
	highEntropy?: HighEntropyInfo | null,
): DeviceIdentity {
	const uaL = ua.toLowerCase()
	const heModel = highEntropy?.model?.trim() || null
	const hePlatform = highEntropy?.platform?.toLowerCase() || null

	// ── اپل: iPhone / iPad ──
	if (uaL.includes('ipad')) {
		const ident = /iPad(\d+,\d+)/.exec(ua)?.[1]
		const mapped = ident ? appleModelName(`iPad${ident}`) : null
		return { type: 'tablet', brand: 'apple', model: mapped ?? 'iPad' }
	}
	if (uaL.includes('iphone')) {
		// شناسه‌ی مدل اگر جایی در UA باشد (برخی WebViewها/اپ‌ها می‌دهند)
		const ident = /iPhone(\d+,\d+)/.exec(ua)?.[1]
		if (ident) {
			const mapped = appleModelName(`iPhone${ident}`)
			if (mapped) return { type: 'mobile', brand: 'apple', model: mapped }
		}
		// سافاری iOS: شناسه در دسترس نیست → طبق دستور کارفرما: «iOS»
		const ver = iosVersionFromUa(ua)
		return { type: 'mobile', brand: 'apple', model: ver ? `iOS ${ver}` : 'iOS' }
	}

	// ── اندروید ──
	if (uaL.includes('android')) {
		const tablet = !uaL.includes('mobile')
		const uaModel = androidModelFromUa(ua)
		const model = heModel ?? uaModel
		if (!model) {
			// مدل واقعی در دسترس نیست (UA فریز + بدون high-entropy)
			const brand = hePlatform === 'android' ? 'other' : null
			return { type: tablet ? 'tablet' : 'mobile', brand, model: null }
		}
		const brand = androidBrand(model) ?? 'other'
		return {
			type: tablet ? 'tablet' : 'mobile',
			brand,
			model: normalizeModel(brand, model),
		}
	}

	// ── دسکتاپ ──
	// ویندوز ۱۱ فقط از high-entropy قابل تشخیص است (UA هر دو را NT 10.0
	// می‌گوید)؛ نمایش بدون نسخه هم طبق خواسته‌ی کارفرما کافی است («ویندوز»).
	if (uaL.includes('windows') || hePlatform === 'windows') {
		return { type: 'desktop', brand: 'windows', model: null }
	}
	if (
		/macintosh|mac os/.test(uaL) ||
		hePlatform === 'macos' ||
		hePlatform === 'darwin'
	) {
		return { type: 'desktop', brand: 'macos', model: null }
	}
	if (
		/linux|ubuntu|fedora|cros/.test(uaL) ||
		hePlatform === 'linux' ||
		hePlatform === 'chromeos'
	) {
		return {
			type: 'desktop',
			brand: hePlatform === 'chromeos' ? 'linux' : 'linux',
			model: null,
		}
	}

	return { type: 'desktop', brand: null, model: null }
}

/**
 * خواندن امنِ high-entropy از navigator.userAgentData (فقط Chromium).
 * مهلت ۳۰۰ms — هر شکست/نبود API = null (بدون تاثیر روی تشخیص پایه).
 */
export async function readHighEntropy(): Promise<HighEntropyInfo | null> {
	try {
		const nav = navigator as Navigator & {
			userAgentData?: {
				getHighEntropyValues(
					hints: string[],
				): Promise<Record<string, string | string[] | boolean>>
			}
		}
		if (!nav.userAgentData?.getHighEntropyValues) return null
		const timeout = new Promise<null>((resolve) => {
			setTimeout(() => resolve(null), 300)
		})
		const result = await Promise.race([
			nav.userAgentData.getHighEntropyValues([
				'model',
				'platform',
				'platformVersion',
			]),
			timeout,
		])
		if (!result || typeof result !== 'object') return null
		return {
			model: typeof result.model === 'string' ? result.model : undefined,
			platform:
				typeof result.platform === 'string' ? result.platform : undefined,
			platformVersion:
				typeof result.platformVersion === 'string'
					? result.platformVersion
					: undefined,
		}
	} catch {
		return null
	}
}
