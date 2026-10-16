//srcweb/scripts/build-sw.mjs
import { injectManifest } from 'workbox-build'

const res = await injectManifest({
  globDirectory: '.output/public',
  // stage-77 (P3-1/P3-3) — ① webmanifest هم precache می‌شود (revision-based:
  // تغییر آیکون/نام نصب دیگر برای همیشه در کشِ قدیمی نمی‌ماند)؛ ② خودِ
  // SWها و صفحه‌ی ریست از precache خارج شدند — از بیلدِ دوم به بعد،
  // sw.jsِ «قدیمیِ» کپی‌شده در public خودش وارد manifest می‌شد (precacheِ
  // خود-ارجاعی + حجمِ بی‌مصرفِ ۴MB) و sw-push/sw-reset هیچ‌وقت لازم
  // نیستند از کش خوانده شوند (مرورگر خودش تازه‌سازی‌شان می‌کند).
  globPatterns: ['**/*.{js,css,png,svg,woff2,html,webmanifest}'],
  globIgnores: ['sw.js', 'sw-push.js', 'sw-reset.html'],
  globFollow: true,
  swSrc: 'public/sw.template.js',
  swDest: 'public/sw.js',
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
})
console.log(`[sw] precached ${res.count} file(s) → public/sw.js`)