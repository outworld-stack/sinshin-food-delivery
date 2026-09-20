//src/domain/terms/terms.service.ts
import { desc, eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { terms } from '#/infra/db/schema'

export interface TermsSection {
  title: string
  items: string[]
}

export interface TermsContent {
  sections: TermsSection[]
  version: number
  updatedAt: Date
}

/** قوانین — آخرین نسخه (عمومی) + به‌روزرسانی (ادمین اصلی) */
export class TermsService {
  constructor(private readonly deps: { db: Db }) { }

  /** آخرین نسخه — برای مودال لاگین */
  async latest(): Promise<TermsContent> {
    const row = await this.deps.db
      .select()
      .from(terms)
      .orderBy(desc(terms.version))
      .limit(1)
      .then((r) => r[0])
    if (!row) {
      return { sections: [], version: 0, updatedAt: new Date() }
    }
    return {
      sections: row.sections,
      version: row.version,
      updatedAt: row.createdAt,
    }
  }

  /** نسخه‌ی خاص — برای ثبت لحظه‌ی پذیرش در auth */
  async byVersion(version: number): Promise<TermsContent | null> {
    const row = await this.deps.db.query.terms.findFirst({
      where: eq(terms.version, version),
    })
    if (!row) return null
    return {
      sections: row.sections,
      version: row.version,
      updatedAt: row.createdAt,
    }
  }

  /** ذخیره — هر ذخیره = نسخه جدید (ادمین اصلی) */
  async update(sections: TermsSection[]): Promise<{ version: number }> {
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
    })
    return { version: newVersion }
  }
}