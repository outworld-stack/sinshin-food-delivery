// src/utils/image.ts
// round-12 — تشخیص «رشتهٔ گرادیانت موک» از URL واقعی آپلودی.
// تاریخچه: تا قبل از آپلود واقعی، عکس‌ها کلاس گرادیانت Tailwind بودند؛
// رندرها هنوز باید هر دو را پشتیبانی کنند (داده‌های قدیمی).
export const isRealImageUrl = (s: string): boolean =>
	s.startsWith('/') || s.startsWith('http')
