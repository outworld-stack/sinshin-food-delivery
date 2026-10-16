// ═══════════════════════════════════════════════════════════════
// stage-70 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/device/device-label.ts
// وضعیت: فایل جدید
// تغییر: نام نمایشیِ دستگاه برای پنل ادمین (کاربران/جزئیات) — فارسی
// ═══════════════════════════════════════════════════════════════

//src/domain/device/device-label.ts
/**
 * ساخت نام نمایشی دستگاه (ستون «نام دستگاه» در پنل ادمین).
 *  - موبایل/تبلت: «برند مدل» — مثل «سامسونگ A55»، «اپل 16 Pro»، «شیائومی Redmi Note 10»
 *  - رایانه: «ویندوز» / «مک» / «لینوکس»
 *  - ردیف‌های قدیمی (پیش از stage-70): از platform/user_agent استنتاج می‌شود
 *  - هیچ داده‌ای: «—»
 *
 * مهاجرت ۰۰۰۵ device_type/device_brandِ ردیف‌های موجود را از UA پر می‌کند؛
 * این استنتاجِ زمانِ خواندن فقط تور ایمنی برای ردیف‌های بی‌UA است.
 */

export interface DeviceLabelInput {
  deviceType: string | null
  deviceBrand: string | null
  deviceModel: string | null
  platform: string | null
  userAgent: string | null
  /** stage-72 (P2-۲۳) — آیپدِ دسکتاپ‌مود (UA مک) فقط از لمس تشخیص‌پذیر است */
  touch?: boolean | null
}

const BRAND_FA: Record<string, string> = {
  apple: 'اپل',
  samsung: 'سامسونگ',
  xiaomi: 'شیائومی',
  huawei: 'هوآوی',
  honor: 'آنر',
  google: 'گوگل',
  other: 'سایر',
  windows: 'ویندوز',
  macos: 'مک',
  linux: 'لینوکس',
}

/** برند قاعده‌مند → فارسی (نامشناخته = همان ورودی) */
export function deviceBrandFa(brand: string | null | undefined): string | null {
  if (!brand) return null
  return BRAND_FA[brand] ?? brand
}

/** استخراج نوع/برند از platform + user_agent — برای ردیف‌های legacy */
export function deriveLegacyDevice(input: {
  platform: string | null
  userAgent: string | null
  /** stage-72 (P2-۲۳) — مکِ لمس‌پذیر = آیپدِ دسکتاپ‌مود */
  touch?: boolean | null
}): { type: 'mobile' | 'tablet' | 'desktop' | null; brand: string | null } {
  const uaL = (input.userAgent ?? '').toLowerCase()
  const platform = (input.platform ?? '').toLowerCase()
  if (!uaL && !platform) return { type: null, brand: null }

  if (uaL.includes('ipad') || platform === 'ipad') return { type: 'tablet', brand: 'apple' }
  if (uaL.includes('iphone') || platform === 'iphone') return { type: 'mobile', brand: 'apple' }
  if (uaL.includes('android')) {
    const tablet = !uaL.includes('mobile')
    let brand: string | null = null
    if (/sm-|gt-|sc-|samsung|galaxy/.test(uaL)) brand = 'samsung'
    else if (/redmi|poco|xiaomi|m2\d{3}|hm ?note|note ?\d/.test(uaL)) brand = 'xiaomi'
    else if (/huawei|ane-|clt-|harmony/.test(uaL)) brand = 'huawei'
    else if (uaL.includes('pixel')) brand = 'google'
    return { type: tablet ? 'tablet' : 'mobile', brand }
  }
  if (uaL.includes('windows') || platform.startsWith('win')) {
    return { type: 'desktop', brand: 'windows' }
  }
  if (/macintosh|mac os/.test(uaL) || platform === 'macintel') {
    // stage-72 (P2-۲۳) — مک صفحه‌ی لمسی ندارد؛ UA مک + touch = آیپد
    if (input.touch) return { type: 'tablet', brand: 'apple' }
    return { type: 'desktop', brand: 'macos' }
  }
  if (/linux|ubuntu|fedora|cros/.test(uaL) || platform.includes('linux')) {
    return { type: 'desktop', brand: 'linux' }
  }
  return { type: 'desktop', brand: null }
}

/** نام کامل نمایشی: موبایل → «برند مدل»؛ دسکتاپ → OS؛ بی‌داده → «—» */
export function deviceDisplayName(input: DeviceLabelInput): string {
  let type = input.deviceType
  let brand = input.deviceBrand
  if (!type || !brand) {
    const legacy = deriveLegacyDevice({
      platform: input.platform,
      userAgent: input.userAgent,
      touch: input.touch,
    })
    type = type ?? legacy.type
    brand = brand ?? legacy.brand
  }
  if (!type) return '—'
  const brandFa = deviceBrandFa(brand)
  if (type === 'desktop') return brandFa ?? 'رایانه'
  if (!brandFa) return type === 'mobile' ? 'موبایل' : 'تبلت'
  // آیپدِ legacy بدون مدل — نمایش «آیپد» به‌جای فقط «اپل»
  if (type === 'tablet' && brand === 'apple' && !input.deviceModel?.trim()) return 'آیپد'
  const model = input.deviceModel?.trim() ?? ''
  return model ? `${brandFa} ${model}` : brandFa
}
