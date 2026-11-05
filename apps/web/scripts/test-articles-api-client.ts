import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ArticleBlocksDoc } from '@sinshin/shared'

const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
let fetchError: Error | null = null
mock.module('#/lib/api-fetch', () => ({
  authJson: async (path: string, method: string, body?: Record<string, unknown>) => {
    requests.push({ path, method, body })
    return { success: true, ...(path === '/admin/translate/blocks' ? { blocksAr: body?.blocksAr } : {}),
      ...(path === '/admin/translate/block-field' ? { blockId: body?.blockId, blockType: body?.blockType, fieldPath: body?.fieldPath, sourceText: body?.text, translation: 'عنوان جديد' } : {}) }
  },
  getJson: async (path: string) => {
    requests.push({ path, method: 'GET' })
    if (fetchError) throw fetchError
    return null
  },
}))
const { updateArticle, updateArticleCategory, getArticleById, getAdminArticleCategories } = await import('../src/server/articles')
const { translateArticleBlocksPreview, translateArticleBlockField } = await import('../src/server/translation')
const id = '01234567-89ab-cdef-0123-456789abcdef'
const input = { id, title: 'Title', excerpt: 'Excerpt', content: 'Body', categoryId: id }
await updateArticle(input)
assert.deepEqual(requests.at(-1)?.body, { title: 'Title', excerpt: 'Excerpt', content: 'Body', categoryId: id },
  'omitted translations, images, blocks and processes must not be cleared by PATCH')
await updateArticle({ ...input, titleAr: '  ', excerptAr: null, contentAr: ' translated ', processesAr: [], profileImage: null, blocks: null })
const body = requests.at(-1)!.body!
assert.equal(body.titleAr, null)
assert.equal(body.excerptAr, null)
assert.equal(body.contentAr, 'translated')
assert.equal(body.processesAr, null)
assert.equal(body.profileImage, null)
assert.equal(body.blocks, null)

const blocks: ArticleBlocksDoc = { version: 1, blocks: [
  { id: 'pin', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, title: 'فارسی' } },
] }
const blocksAr: ArticleBlocksDoc = { version: 1, blocks: [
  { id: 'pin', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, title: 'عربي' } },
] }
await updateArticle({ ...input, blocks, blocksAr })
assert.deepEqual(requests.at(-1)?.body?.blocks, blocks)
assert.deepEqual(requests.at(-1)?.body?.blocksAr, blocksAr, 'Arabic documents travel separately with coordinate precision intact')
await updateArticle({ ...input, blocksAr: null })
assert.equal(requests.at(-1)?.body?.blocksAr, null)
assert(!('blocks' in requests.at(-1)!.body!), 'clearing Arabic translations never clears Persian blocks')
assert.deepEqual(await translateArticleBlocksPreview({ blocks, blocksAr, blockId: 'pin' }), blocksAr)
assert.deepEqual(requests.at(-1), { path: '/admin/translate/blocks', method: 'POST', body: { blocks, blocksAr, blockId: 'pin' } },
  'block translation uses the read-only review endpoint and the selected stable ID')
const fieldInput = { blockId: 'pin', blockType: 'location' as const, fieldPath: ['title'], text: 'عنوان تازه', blocksAr, blocks }
const fieldPreview = await translateArticleBlockField(fieldInput)
assert.deepEqual(requests.at(-1), { path: '/admin/translate/block-field', method: 'POST', body: {
  blockId: 'pin', blockType: 'location', fieldPath: ['title'], text: 'عنوان تازه',
} }, 'field client transmits only one source value and strips documents, existing Arabic and extra input properties')
assert.equal(fieldPreview.sourceText, 'عنوان تازه')
assert.equal(fieldPreview.translation, 'عنوان جديد')

await updateArticleCategory({ id, name: 'Category', hasSubCategories: true, subCategories: ['Sub'] })
assert.deepEqual(requests.at(-1)?.body, { name: 'Category', hasSubCategories: true, subCategories: ['Sub'] })
await updateArticleCategory({ id, name: 'Category', hasSubCategories: false, subCategories: [], nameAr: '', subCategoriesAr: null })
assert.equal(requests.at(-1)?.body?.nameAr, null)
assert.equal(requests.at(-1)?.body?.subCategoriesAr, null)

await getAdminArticleCategories()
assert.equal(requests.at(-1)?.path, '/admin/articles/categories', 'editors fetch original names separately from localized public categories')

const beforeMissing = requests.length
assert.equal(await getArticleById({ data: { id: 'not-an-article' } }), null)
assert.equal(requests.length, beforeMissing, 'malformed article links become not-found without a failing API request')
assert.equal(await getArticleById({ data: { id } }), null)
fetchError = new Error('offline')
await assert.rejects(getArticleById({ data: { id } }), /offline/, 'network failures remain errors, not missing articles')
console.log('Articles API client regressions passed (PATCH preservation, explicit clearing, missing links).')
