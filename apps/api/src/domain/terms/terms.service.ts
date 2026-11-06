// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 29 از 97
// مسیر مقصد: apps/api/src/domain/terms/terms.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

//src/domain/terms/terms.service.ts
import { desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { terms } from '#/infra/db/schema'
import type { Lang } from '#/domain/shared/lang'
import { assertContentSourceRevision, localizeContentRecord, reconcileContentTranslation, type TermsContentDto, type TermsSection, type TranslationEdit } from '@sinshin/shared'
import { Err } from '#/domain/shared/errors'

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
  async latest(lang: Lang = 'fa', includeState = false): Promise<TermsContent> {
    const row = await this.deps.db
      .select()
      .from(terms)
      .orderBy(desc(terms.version))
      .limit(1)
      .then((r) => r[0])
    if (!row) {
      return { sections: [], ...(includeState ? { sectionsAr: null, translationState: null } : {}), arAuto: false, version: 0, updatedAt: new Date() }
    }
    return this.toContent(row, lang, includeState)
  }

  /** نسخه‌ی خاص — برای ثبت لحظه‌ی پذیرش در auth */
  async byVersion(version: number, lang: Lang = 'fa'): Promise<TermsContent | null> {
    const row = await this.deps.db.query.terms.findFirst({
      where: eq(terms.version, version),
    })
    if (!row) return null
    return this.toContent(row, lang)
  }


  /**
   * رارد ۴۸ (اسکن A12) — همان COALESCE بخش‌به‌بخش که قبلاً در latest و
   * byVersion بایت‌به‌بایت تکرار می‌شد؛ بخشِ بدون ترجمه‌ی عربی به همان
   * فارسی برمی‌گردد (هم‌ترازی با ایندکس حیاتی است).
   */
  private toContent(
    row: typeof terms.$inferSelect,
    lang: Lang,
    includeState = false,
  ): TermsContent {
    const localized = lang === 'ar' ? localizeContentRecord('terms', row) : row
    const sections = lang === 'ar' ? row.sections.map((section, index) => {
      const arabic = localized.sectionsAr?.[index]
      return {
        title: arabic?.title.trim() ? arabic.title : section.title,
        items: section.items.map((item, itemIndex) => {
          const translated = arabic?.items[itemIndex]
          return translated?.trim() ? translated : item
        }),
      }
    }) : row.sections
    return {
      sections,
      ...(includeState ? { id: row.id, sectionsAr: row.sectionsAr ?? null, translationState: row.translationState } : {}),
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
    translationEdits: TranslationEdit[] = [],
    sourceRevision?: string,
  ): Promise<{ version: number }> {
    if (sections.length === 0) {
      throw new Error('حداقل یک بخش لازم است')
    }
    if (sections.some((s) => s.items.length === 0)) {
      throw new Error('هر بخش حداقل یک بند لازم دارد')
    }
    return this.deps.db.transaction(async (tx) => {
      // Keep accepted historical versions immutable, while serializing allocation of the next version.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('content:terms'))`)
      const [latest] = await tx.select().from(terms).orderBy(desc(terms.version)).limit(1).for('update')
      if (!assertContentSourceRevision('terms', latest ?? { sections: [] }, sourceRevision)) throw Err.validation('قوانین تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
      const id = crypto.randomUUID()
      const next = reconcileContentTranslation('terms', id, latest ?? null, {
        ...latest, id, version: (latest?.version ?? 0) + 1, sections,
        sectionsAr: sectionsAr === undefined ? latest?.sectionsAr ?? null : sectionsAr,
        translationState: latest?.translationState ?? null,
        createdAt: new Date(), arAuto: false,
      }, translationEdits)
      await tx.insert(terms).values(next)
      return { version: next.version }
    })
  }
}
