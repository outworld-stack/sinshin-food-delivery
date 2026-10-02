// src/lib/site.ts
// ثابت‌ها و هلپرهای سئو — یک منبع واحد برای canonical / og:image / sitemap / JSON-LD.
// اگر روزی دامنه عوض شد، فقط همین فایل را تغییر بده.
// (با canonical صفحه‌ی about هم‌راستاست: https://www.sinshin-foodpark.ir)

export const SITE_URL = 'https://www.sinshin-foodpark.ir'

/** تصویر پیش‌فرض og — همان برندینگ فعلی (مربع ۱۱۵۵×۱۱۵۵) */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/main.png`

/**
 * مسیر نسبی → URL مطلق؛ فقط برای چیزهایی که واقعاً URL اند.
 * رشته‌های موک (گرادیانت مثل 'from-blue-400 …') و مقادیر خالی → undefined.
 */
export function absoluteUrl(u?: string | null): string | undefined {
  if (!u) return undefined
  if (u.startsWith('https://') || u.startsWith('http://')) return u
  if (u.startsWith('/')) return SITE_URL + u
  return undefined
}

/**
 * سئو-۴: JSON-LD امن برای درج داخل <script>.
 * JSON.stringify اسلش را گریز نمی‌کند؛ نام/توصیف محصول می‌تواند
 * «</script><script>…» را تزریق کند (خروج از تگ = XSS).
 * جایگزینی < با \u003c برای پارسر JS شفاف است ولی پارسر HTML دیگر
 * تگ پایانی نمی‌بیند — روش استاندارد JSON-LD در React.
 */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c')
}