/** Test-only convenience for older happy-path save fixtures. Security regressions call services directly. */
import { bindArticleBlockItemIdentities, collectionTranslationIdentities, contentSourceRevision, getArticleBlockTextFields, setArticleBlockTranslations, type ArticleBlocksDoc, type ContentEntityType } from '@sinshin/shared'
import type { ArticleService } from '../src/domain/article/article.service'
import type { GalleryService } from '../src/domain/gallery/gallery.service'
import type { MenuService } from '../src/domain/menu/menu.service'
import type { PackagingService } from '../src/domain/menu/packaging.service'
import { readContentRow } from '../src/domain/translation/content-translation.store'
import type { Db } from '../src/infra/db/client'

type SaveInput<T> = Omit<T, 'sourceRevision'> & { sourceRevision?: string }
/** Legal legacy maximum: added stable IDs exceed the old raw metadata allowance without changing content. */
export function maximumBlockTranslationFixture() {
  const source = bindArticleBlockItemIdentities({ version: 1, blocks: Array.from({ length: 200 }, (_, index) => ({
    id: `list-${String(index).padStart(3, '0')}`.padEnd(64, 'x'), type: 'list', props: { items: Array.from({ length: 30 }, () => 'متن') },
  })) } as ArticleBlocksDoc)
  const arabic = setArticleBlockTranslations(source, null, source.blocks.flatMap(block => getArticleBlockTextFields(block).map(field => ({
    blockId: block.id, path: field.path, text: 'عرب',
  }))))
  if (!arabic) throw new Error('Maximum block fixture must remain a valid document')
  return { source, arabic }
}
export async function contentFixtureProof(db: Db, type: ContentEntityType, id: string) {
  const row = await readContentRow(db, type, id)
  return { sourceRevision: row ? contentSourceRevision(type, row) : `sha256:${'0'.repeat(64)}`,
    translationIdentities: row ? collectionTranslationIdentities(type, row) : [] }
}
export async function fixtureUpdateProduct(service: MenuService, db: Db, input: SaveInput<Parameters<MenuService['updateProduct']>[0]>) {
  const proof = await contentFixtureProof(db, 'product', input.id)
  const sizes = input.sizes ? await Promise.all(input.sizes.map(async size => size.id
    ? { ...await contentFixtureProof(db, 'productSize', size.id), ...size } : size)) : undefined
  return service.updateProduct({ ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision, ...(sizes ? { sizes } : {}) })
}
export async function fixtureUpdateCategory(service: MenuService, db: Db, input: SaveInput<Parameters<MenuService['updateCategory']>[0]>) {
  const proof = await contentFixtureProof(db, 'category', input.id)
  return service.updateCategory({ ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision })
}
export async function fixtureUpdateMainCategory(service: MenuService, db: Db, input: SaveInput<Parameters<MenuService['updateMainCategory']>[0]>) {
  const proof = await contentFixtureProof(db, 'mainCategory', input.id)
  return service.updateMainCategory({ ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision })
}
export async function fixtureUpdateArticle(service: ArticleService, db: Db, id: string, input: SaveInput<Parameters<ArticleService['update']>[1]>) {
  const proof = await contentFixtureProof(db, 'article', id)
  return service.update(id, { ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision })
}
export async function fixtureUpdateArticleCategory(service: ArticleService, db: Db, id: string, input: SaveInput<Parameters<ArticleService['updateCategory']>[1]>) {
  const proof = await contentFixtureProof(db, 'articleCategory', id)
  const entries = input.subCategoryEntries ? await Promise.all(input.subCategoryEntries.map(async entry => entry.id
    ? { ...await contentFixtureProof(db, 'articleSubCategory', entry.id), ...entry } : entry)) : undefined
  return service.updateCategory(id, { ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision,
    ...(entries ? { subCategoryEntries: entries } : {}) })
}
export async function fixtureUpdateGallery(service: GalleryService, db: Db, id: string, input: SaveInput<Parameters<GalleryService['update']>[1]>) {
  const proof = await contentFixtureProof(db, 'gallery', id)
  return service.update(id, { ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision })
}
export async function fixtureUpdatePackaging(service: PackagingService, db: Db, id: string, input: SaveInput<Parameters<PackagingService['update']>[1]>) {
  const proof = await contentFixtureProof(db, 'packagingItem', id)
  return service.update(id, { ...proof, ...input, sourceRevision: input.sourceRevision ?? proof.sourceRevision })
}
