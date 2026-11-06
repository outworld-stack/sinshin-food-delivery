import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'
import { getArticleBlockTextFields, type ArticleBlocksDoc, type ContentEntityType, type ContentTranslationState } from '@sinshin/shared'
import type { DbOrTx } from '#/infra/db/client'
import { products, productSizes, categories, mainCategories, articles, articleCategories, articleSubCategories, contentAbout, galleryImages, terms, packagingItems, settings, SETTING_KEYS } from '#/infra/db/schema'
import { asProductId, asSizeId, asCategoryId, asMainCategoryId, asGalleryImageId } from '#/domain/shared/brand'
import { UUID_PATTERN } from '#/domain/shared/ids'

export type ContentRow = Record<string, unknown> & { translationState?: ContentTranslationState | null }
interface Adapter { table: AnyPgTable; where: (id: string) => SQL; arabicKeys: string[] }
const adapters: Partial<Record<ContentEntityType, Adapter>> = {
  product: { table: products, where: id => eq(products.id, asProductId(id)), arabicKeys: ['nameAr', 'descriptionAr', 'ingredientsAr'] },
  productSize: { table: productSizes, where: id => eq(productSizes.id, asSizeId(id)), arabicKeys: ['nameAr'] },
  mainCategory: { table: mainCategories, where: id => eq(mainCategories.id, asMainCategoryId(id)), arabicKeys: ['nameAr'] },
  category: { table: categories, where: id => eq(categories.id, asCategoryId(id)), arabicKeys: ['nameAr', 'sizeNamesAr'] },
  article: { table: articles, where: id => eq(articles.id, id), arabicKeys: ['titleAr', 'excerptAr', 'contentAr', 'processesAr', 'blocksAr'] },
  articleCategory: { table: articleCategories, where: id => eq(articleCategories.id, id), arabicKeys: ['nameAr'] },
  articleSubCategory: { table: articleSubCategories, where: id => eq(articleSubCategories.id, id), arabicKeys: ['nameAr'] },
  about: { table: contentAbout, where: () => eq(contentAbout.id, 1), arabicKeys: ['heroTitleAr', 'heroTextAr', 'teamTitleAr', 'teamAltAr', 'location', 'blocksAr'] },
  gallery: { table: galleryImages, where: id => eq(galleryImages.id, asGalleryImageId(id)), arabicKeys: ['altAr'] },
  terms: { table: terms, where: id => and(eq(terms.id, id), sql`${terms.version} = (SELECT max(version) FROM ${terms})`) as SQL, arabicKeys: ['sectionsAr'] },
  packagingItem: { table: packagingItems, where: id => eq(packagingItems.id, id), arabicKeys: ['titleAr'] },
}
export async function readContentRow(db: DbOrTx, type: ContentEntityType, id: string, lock = false): Promise<ContentRow | null> {
  if (type === 'about' && id !== '1') return null
  if (type !== 'about' && type !== 'temporaryClose' && !new RegExp(UUID_PATTERN).test(id.toLowerCase())) return null
  if (type === 'temporaryClose') {
    if (id !== 'temporaryCloseReason') return null
    const query = db.select().from(settings).where(inArray(settings.key, [SETTING_KEYS.temporaryCloseReason, SETTING_KEYS.temporaryCloseReasonAr])).orderBy(settings.key)
    const rows = lock ? await query.for('update') : await query
    const source = rows.find(row => row.key === SETTING_KEYS.temporaryCloseReason)
    if (!source) return null
    return { id, reason: source.value, reasonAr: rows.find(row => row.key === SETTING_KEYS.temporaryCloseReasonAr)?.value ?? null, translationState: source.translationState, updatedAt: source.updatedAt }
  }
  const adapter = adapters[type]
  if (!adapter) return null
  const query = db.select().from(adapter.table).where(adapter.where(id))
  const rows = lock ? await query.for('update') : await query
  return rows[0] as ContentRow | undefined ?? null
}
/** Explicit Arabic-only columns; never persists source text, prices, coordinates or other business attributes. */
export async function writeContentRow(db: DbOrTx, type: ContentEntityType, id: string, row: ContentRow): Promise<void> {
  if (type === 'temporaryClose') {
    await db.update(settings).set({ translationState: row.translationState, updatedAt: new Date() }).where(eq(settings.key, SETTING_KEYS.temporaryCloseReason))
    await db.insert(settings).values({ key: SETTING_KEYS.temporaryCloseReasonAr, value: row.reasonAr ?? '', updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { value: row.reasonAr ?? '', updatedAt: new Date() } })
    return
  }
  const adapter = adapters[type]
  if (!adapter) return
  const patch: Record<string, unknown> = { translationState: row.translationState }
  for (const key of adapter.arabicKeys) patch[key] = row[key]
  if ('arAuto' in row) {
    const fields = row.translationState?.fields ?? []
    const blockDoc = row.blocksAr as ArticleBlocksDoc | null | undefined
    const blockFields = blockDoc?.translation?.fields ?? []
    const legacyBlocks = blockDoc?.blocks.some(block => getArticleBlockTextFields(block).some(field => field.text.trim()
      && !blockFields.some(state => state.blockId === block.id && state.blockType === block.type
        && JSON.stringify(state.fieldPath) === JSON.stringify(field.path) && state.origin === 'automatic')))
    const manual = fields.some(field => field.origin !== 'automatic')
      || blockFields.some(field => field.origin !== 'automatic') || legacyBlocks
    patch.arAuto = !manual && (fields.some(field => field.origin === 'automatic' && field.status === 'translated')
      || blockFields.some(field => field.origin === 'automatic' && field.status === 'translated'))
  }
  if ('updatedAt' in row) patch.updatedAt = new Date(Math.max(Date.now(), row.updatedAt instanceof Date ? row.updatedAt.getTime() + 1 : 0))
  await db.update(adapter.table).set(patch).where(adapter.where(id))
}
export async function contentRows(db: DbOrTx, type: ContentEntityType, limit = 250, offset = 0): Promise<ContentRow[]> {
  if (type === 'temporaryClose') {
    const row = offset === 0 ? await readContentRow(db, type, 'temporaryCloseReason') : null
    return row ? [row] : []
  }
  if (type === 'terms') {
    if (offset > 0) return []
    return await db.select().from(terms).orderBy(desc(terms.version)).limit(1) as ContentRow[]
  }
  const adapter = adapters[type]
  if (!adapter) return []
  const columns = getTableColumns(adapter.table)
  const query = db.select().from(adapter.table).limit(limit).offset(offset)
  return (columns.id ? await query.orderBy(columns.id) : await query) as ContentRow[]
}
