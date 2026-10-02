// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 12 از 49
// مسیر مقصد: apps/api/src/domain/terms/terms.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/domain/terms/terms.service.ts
import { desc, eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { terms } from '#/infra/db/schema'
import type { Lang } from '#/domain/shared/lang'
import type { TermsContentDto, TermsSection } from '@sinshin/shared'

// رارد ۴۶ — TermsSection به قرارداد مشترک (@sinshin/shared) منتقل شد.
// رارد ۴۷ — TermsContent حالا «مشتقِ» قرارداد است، نه کپیِ ناشناس: همه‌ی
// فیلدها از TermsContentDto می‌آیند و فقط updatedAt (مرز سریال‌سازی) Date
// می‌ماند — اگر قرارداد فیلدی عوض کند، این‌جا بلافاصله خطای تایپ می‌دهد.
export type TermsContent = Omit<TermsContentDto, 'updatedAt'> & {
  /** round-34 — بندهای عربی خام (برای فرم دوزبانه ادمین؛ NULL = پشتیبان فارسی) */
  sectionsAr?: TermsSection[] | null
  /** پیش از سریال‌سازی Date است؛ روی سیم ISO string (قرارداد) */
  updatedAt: Date
}

/** قوانین — آخرین نسخه (عمومی) + به‌روزرسانی (ادمین اصلی) */
export class TermsService {
  constructor(private readonly deps: { db: Db }) { }

  /** آخرین نسخه — برای مودال لاگین */
  async latest(lang: Lang = 'fa'): Promise<TermsContent> {
    const row = await this.deps.db
      .select()
      .from(terms)
      .orderBy(desc(terms.version))
      .limit(1)
      .then((r) => r[0])
    if (!row) {
      return { sections: [], sectionsAr: null, arAuto: false, version: 0, updatedAt: new Date() }
    }
    // round-34 — بندهای عربی: ساختار موازی sections؛ هم‌ترازی با ایندکس حیاتی است —
    // بخشِ بدون ترجمه‌ی عربی به همان فارسی برمی‌گردد (COALESCE به‌ازای هر مورد)
    const sections =
      lang === 'ar' && row.sectionsAr && row.sectionsAr.length > 0
        ? row.sections.map((s, i) => {
            const a = row.sectionsAr?.[i]
            return a && (a.title.trim() !== '' || a.items.length > 0) ? a : s
          })
        : row.sections
    return {
      sections,
      sectionsAr: row.sectionsAr ?? null,
      arAuto: row.arAuto,
      version: row.version,
      updatedAt: row.createdAt,
    }
  }

  /** نسخه‌ی خاص — برای ثبت لحظه‌ی پذیرش در auth */
  async byVersion(version: number, lang: Lang = 'fa'): Promise<TermsContent | null> {
    const row = await this.deps.db.query.terms.findFirst({
      where: eq(terms.version, version),
    })
    if (!row) return null
    // round-34 — همان COALESCE بخش‌به‌بخشِ نسخه‌ی خاص (ارجاع تاریخی)
    const sections =
      lang === 'ar' && row.sectionsAr && row.sectionsAr.length > 0
        ? row.sections.map((s, i) => {
            const a = row.sectionsAr?.[i]
            return a && (a.title.trim() !== '' || a.items.length > 0) ? a : s
          })
        : row.sections
    return {
      sections,
      sectionsAr: row.sectionsAr ?? null,
      arAuto: row.arAuto,
      version: row.version,
      updatedAt: row.createdAt,
    }
  }

  /** ذخیره — هر ذخیره = نسخه جدید (ادمین اصلی) */
  async update(
    sections: TermsSection[],
    /** round-34 — بندهای عربی (اختیاری؛ ساختار موازی؛ خالی = NULL = پشتیبان فارسی) */
    sectionsAr?: TermsSection[] | null,
  ): Promise<{ version: number }> {
    if (sections.length === 0) {
      throw new Error('حداقل یک بخش لازم است')
    }
    if (sections.some((s) => s.items.length === 0)) {
      throw new Error('هر بخش حداقل یک بند لازم دارد')
    }
    const latest = await this.latest()
    const newVersion = latest.version + 1
    await this.deps.db.insert(terms).values({
      version: newVersion,
      sections,
      // round-34 — ذخیره‌ی دستی: پرچم «خودکار» خاموش؛ آرایه‌ی خالی → NULL
      sectionsAr: sectionsAr && sectionsAr.length > 0 ? sectionsAr : null,
      arAuto: false,
    })
    return { version: newVersion }
  }
}