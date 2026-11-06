/** Pure source/identity/provenance regressions. No network or paid translator calls. */
import assert from 'node:assert/strict'
import {
  contentSourceRevision,
  contentTranslationFields,
  contentTranslationValue,
  eligibleContentTranslationFields,
  localizeContentRecord,
  matchesContentSourceRevision,
  reconcileContentTranslation,
  type ContentEntityType,
  type ContentFieldPath,
  type TranslationEdit,
} from '@sinshin/shared'

const requireValue = <T>(value: T | null | undefined): T => {
  assert(value !== null && value !== undefined, 'Expected a populated regression fixture value')
  return value
}

let count = 0
const test = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`) }
const id = 'content-shared-test'
const bind = <T extends object>(type: ContentEntityType, row: T) => reconcileContentTranslation(type, id, null, row)
const proof = (type: ContentEntityType, row: unknown, path: ContentFieldPath, value: string,
  origin: 'manual' | 'automatic' = 'manual'): TranslationEdit => {
  const field = contentTranslationFields(type, row).find(item => JSON.stringify(item.fieldPath) === JSON.stringify(path))
  assert(field, `Missing whitelist field ${type}:${JSON.stringify(path)}`)
  return { fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText, revision: field.revision, value, origin }
}
const source = { id, name: 'غذا', nameAr: 'وجبة', description: 'توضیح', descriptionAr: 'وصف',
  ingredients: ['پنیر', 'قارچ', 'سس'], ingredientsAr: ['جبن', 'فطر', 'صلصة'], price: 100000,
  image: '/uploads/product.webp', styles: { color: '#ffffff' } }

test('changing one product source preserves every other manual Arabic field and original objects', () => {
  const before = bind('product', source)
  const snapshot = structuredClone(before)
  const next = reconcileContentTranslation('product', id, before, { ...before, name: 'غذای تازه', nameAr: 'وجبة' })
  assert.equal(next.nameAr, null)
  assert.equal(next.descriptionAr, 'وصف')
  assert.deepEqual(next.ingredientsAr, ['جبن', 'فطر', 'صلصة'])
  const field = requireValue(contentTranslationFields('product', next).find(item => item.fieldId === 'name'))
  assert.equal(field.status, 'needs-review')
  assert.equal(field.staleValue, 'وجبة')
  assert.equal(field.staleSourceText, 'غذا')
  assert.deepEqual(before, snapshot, 'reconciliation must never mutate previous Persian/Arabic objects')
})

for (const [type, path, row, replacement] of [
  ['productSize', ['name'], { id, name: 'کوچک', nameAr: 'صغير', price: 1 }, 'بزرگ'],
  ['mainCategory', ['name'], { id, name: 'رستوران', nameAr: 'مطعم' }, 'رستوران تازه'],
  ['category', ['name'], { id, name: 'پیتزا', nameAr: 'بيتزا', sizeNames: ['کوچک'], sizeNamesAr: ['صغير'] }, 'پیتزای تازه'],
  ['articleCategory', ['name'], { id, name: 'آموزش', nameAr: 'تعليم' }, 'آموزش تازه'],
  ['articleSubCategory', ['name'], { id, name: 'غذا', nameAr: 'طعام' }, 'غذای تازه'],
  ['gallery', ['alt'], { id, alt: 'تصویر', altAr: 'صورة', src: '/image.webp', span: 'wide' }, 'تصویر تازه'],
  ['packagingItem', ['title'], { id, title: 'جعبه', titleAr: 'صندوق', price: 123 }, 'جعبه تازه'],
  ['temporaryClose', ['reason'], { id, reason: 'بسته', reasonAr: 'مغلق', isClosed: true }, 'بسته تا فردا'],
] as const) {
  test(`${type} invalidates only its explicit source field and preserves structural attributes`, () => {
    const before = bind(type, row)
    const next = reconcileContentTranslation(type, id, before, { ...before, [path[0]]: replacement })
    assert.equal(contentTranslationValue(type, next, [...path]), null)
    assert.equal(requireValue(contentTranslationFields(type, next).find(field => field.fieldPath[0] === path[0])).status, 'needs-review')
    for (const key of ['price', 'src', 'span', 'isClosed']) {
      assert.equal((next as Record<string, unknown>)[key], (row as Record<string, unknown>)[key])
    }
  })
}

test('manual source review requires exact source text, field path and matching revision', () => {
  const before = bind('product', source)
  const staleProof = proof('product', before, ['description'], 'قديم')
  const changed = reconcileContentTranslation('product', id, before, { ...before, description: 'توضیح تازه' })
  const outdated = reconcileContentTranslation('product', id, changed, { ...changed, descriptionAr: 'قديم' }, [staleProof])
  assert.equal(outdated.descriptionAr, null)
  const reviewed = reconcileContentTranslation('product', id, changed, changed, [proof('product', changed, ['description'], 'وصف مراجع')])
  assert.equal(reviewed.descriptionAr, 'وصف مراجع')
  assert.equal(requireValue(contentTranslationFields('product', reviewed).find(field => field.fieldId === 'description')).origin, 'manual')
  const invalidPath = { ...proof('product', changed, ['description'], 'خطأ'), fieldPath: ['image'] }
  assert.equal(reconcileContentTranslation('product', id, changed, changed, [invalidPath]).descriptionAr, null)
})

test('completed automatic fields and unrelated manual fields are never retransmitted or overwritten', () => {
  const empty = bind('product', { id, name: 'غذا', description: 'توضیح', ingredients: ['پنیر'], nameAr: null, descriptionAr: null, ingredientsAr: null })
  const complete = reconcileContentTranslation('product', id, empty, empty,
    eligibleContentTranslationFields('product', empty).map(field => ({ ...field, value: `عربي:${field.sourceText}`, origin: 'automatic' })))
  assert.equal(eligibleContentTranslationFields('product', complete).length, 0)
  const changed = reconcileContentTranslation('product', id, complete, { ...complete, description: 'فقط توضیح جدید' })
  assert.deepEqual(eligibleContentTranslationFields('product', changed).map(field => field.sourceText), ['فقط توضیح جدید'])
  const calls: string[][] = []
  const mockTranslate = (texts: string[]) => { calls.push(texts); return texts.map(text => `ترجمة:${text}`) }
  const selected = eligibleContentTranslationFields('product', changed)
  const outputs = mockTranslate(selected.map(field => field.sourceText))
  const translated = reconcileContentTranslation('product', id, changed, changed, selected.map((field, index) => ({
    ...field, value: requireValue(outputs[index]), origin: 'automatic',
  })))
  assert.deepEqual(calls, [['فقط توضیح جدید']])
  assert.equal(translated.nameAr, complete.nameAr)
  assert.deepEqual(translated.ingredientsAr, complete.ingredientsAr)
  assert.equal(translated.descriptionAr, 'ترجمة:فقط توضیح جدید')
  const attempted = reconcileContentTranslation('product', id, translated, translated,
    [proof('product', translated, ['description'], 'آلي جديد', 'automatic')])
  assert.equal(attempted.descriptionAr, translated.descriptionAr)
  const manual = bind('product', source)
  assert.equal(reconcileContentTranslation('product', id, manual, manual,
    [proof('product', manual, ['name'], 'آلي', 'automatic')]).nameAr, 'وجبة')
})

test('late automatic results cannot replace a newer source or newer manual translation', () => {
  const empty = bind('product', { id, name: 'غذا', description: 'توضیح', nameAr: null, descriptionAr: null, ingredients: [] })
  const pending = proof('product', empty, ['description'], 'استجابة قديمة', 'automatic')
  const changed = reconcileContentTranslation('product', id, empty, { ...empty, description: 'نسخه جدید' })
  assert.equal(reconcileContentTranslation('product', id, changed, changed, [pending]).descriptionAr, null)
  const manual = reconcileContentTranslation('product', id, empty, empty, [proof('product', empty, ['description'], 'يدوي')])
  assert.equal(reconcileContentTranslation('product', id, manual, manual, [pending]).descriptionAr, 'يدوي')
})

test('metadata-only mutations preserve translations and exact source revisions', () => {
  const before = bind('product', source)
  const next = reconcileContentTranslation('product', id, before, { ...before, price: 999999, image: '/new.webp', styles: { color: '#000000' } })
  assert.equal(next.nameAr, 'وجبة')
  assert.equal(contentSourceRevision('product', before), contentSourceRevision('product', next))
  const sourceChanged = reconcileContentTranslation('product', id, next, { ...next, description: 'متن تازه' })
  assert.equal(matchesContentSourceRevision('product', sourceChanged, contentSourceRevision('product', before)), false)
})

test('legacy ingredient reordering preserves every populated Arabic value without assuming automatic origin', () => {
  const next = reconcileContentTranslation('product', id, source, { ...source, ingredients: ['سس', 'پنیر', 'قارچ'] })
  assert.deepEqual(next.ingredientsAr, ['صلصة', 'جبن', 'فطر'])
  assert(contentTranslationFields('product', next).every(field => field.origin === 'legacy'))
  assert.equal(eligibleContentTranslationFields('product', next).length, 0)
})

for (const type of ['product', 'category'] as const) {
  const key = type === 'product' ? 'ingredients' : 'sizeNames'
  test(`${type} nested insert/delete/reorder/replacement preserves exact-source identities`, () => {
    const before = bind(type, { id, name: 'عنوان', nameAr: 'عنوان عربي', [key]: ['یک', 'دو', 'سه'], [`${key}Ar`]: ['أ', 'ب', 'ج'] })
    const next = reconcileContentTranslation(type, id, before, { ...before, [key]: ['سه', 'چهار', 'یک'] })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], ['ج', '', 'أ'])
    const archived = next.translationState.orphanedFields
    assert(archived?.some(field => field.sourceText === 'دو' && field.value === 'ب')
      || contentTranslationFields(type, next).some(field => field.staleSourceText === 'دو' && field.staleValue === 'ب'))
    const firstId = requireValue(contentTranslationFields(type, before).find(field => field.sourceText === 'یک')).fieldId
    assert.equal(requireValue(contentTranslationFields(type, next).find(field => field.sourceText === 'یک')).fieldId, firstId)
  })
  test(`${type} duplicated sources retain unchanged shape, conservatively archive ambiguous edits`, () => {
    const before = bind(type, { id, name: 'عنوان', price: 100, [key]: ['یک', 'یک', 'دو'], [`${key}Ar`]: ['أول', 'ثان', 'ب'] })
    const same = reconcileContentTranslation(type, id, before, { ...before, price: 200 })
    assert.deepEqual((same as Record<string, unknown>)[`${key}Ar`], ['أول', 'ثان', 'ب'])
    const next = reconcileContentTranslation(type, id, before, { ...before, [key]: ['دو', 'یک', 'یک', 'یک'] })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], ['ب', '', '', ''])
    assert.equal(new Set(next.translationState.fields.map(field => field.fieldId)).size, next.translationState.fields.length)
    assert.deepEqual(requireValue(next.translationState.orphanedFields).map(field => field.value).sort(), ['أول', 'ثان'].sort())
  })
}

for (const type of ['terms', 'article'] as const) {
  const key = type === 'terms' ? 'sections' : 'processes'
  const row = { id, title: 'مقاله', titleAr: 'مقال', excerpt: 'خلاصه', excerptAr: 'ملخص', content: 'محتوا', contentAr: 'محتوى',
    [key]: [{ title: 'اول', items: ['یک', 'دو'] }, { title: 'دوم', items: ['سه'] }],
    [`${key}Ar`]: [{ title: 'الأول', items: ['أ', 'ب'] }, { title: 'الثاني', items: ['ج'] }] }
  test(`${type} legacy section and item reorder preserves translations independently`, () => {
    const next = reconcileContentTranslation(type, id, row, { ...row,
      [key]: [{ title: 'دوم', items: ['سه'] }, { title: 'اول', items: ['دو', 'یک'] }],
    })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], [{ title: 'الثاني', items: ['ج'] }, { title: 'الأول', items: ['ب', 'أ'] }])
  })
  test(`${type} one nested source item invalidates only its matching Arabic item`, () => {
    const before = bind(type, row)
    const next = reconcileContentTranslation(type, id, before, { ...before,
      [key]: [{ title: 'اول', items: ['یک تازه', 'دو'] }, { title: 'دوم', items: ['سه'] }],
    })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], [{ title: 'الأول', items: ['', 'ب'] }, { title: 'الثاني', items: ['ج'] }])
    assert.equal(contentTranslationFields(type, next).filter(field => field.status === 'needs-review').length, 1)
  })
  test(`${type} sections sharing a title follow their full source fingerprint through reordering`, () => {
    const duplicated = { ...row, [key]: [{ title: 'مشترک', items: ['یک'] }, { title: 'مشترک', items: ['دو'] }],
      [`${key}Ar`]: [{ title: 'عنوان أ', items: ['أ'] }, { title: 'عنوان ب', items: ['ب'] }] }
    const before = bind(type, duplicated)
    const next = reconcileContentTranslation(type, id, before, { ...before,
      [key]: [{ title: 'مشترک', items: ['دو'] }, { title: 'مشترک', items: ['یک'] }],
    })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], [{ title: 'عنوان ب', items: ['ب'] }, { title: 'عنوان أ', items: ['أ'] }])
  })
  test(`${type} insertion/deletion preserves sibling sections and archives removed manual drafts`, () => {
    const before = bind(type, row)
    const next = reconcileContentTranslation(type, id, before, { ...before,
      [key]: [{ title: 'جدید', items: ['متن جدید'] }, { title: 'دوم', items: ['سه'] }],
    })
    assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], [{ title: '', items: [''] }, { title: 'الثاني', items: ['ج'] }])
    assert(next.translationState.orphanedFields?.some(field => field.value === 'أ'))
    assert(next.translationState.orphanedFields?.some(field => field.value === 'ب'))
  })
}

const about = { id, heroTitle: 'درباره', heroTitleAr: 'عن', heroText: 'متن', heroTextAr: 'نص', teamTitle: 'تیم', teamTitleAr: 'فريق',
  teamAlt: 'تصویر تیم', teamAltAr: 'صورة الفريق', location: { address: 'نشانی', addressAr: 'عنوان', lat: 37.479123456, lng: 49.439987654 },
  blocks: { version: 1, blocks: [] }, blocksAr: null, heroGradient: 'from-red-400 to-blue-500' }
for (const path of [['heroTitle'], ['heroText'], ['teamTitle'], ['teamAlt'], ['location', 'address']] as ContentFieldPath[]) {
  test(`About ${path.join('.')} changes only its matching translation and never coordinates`, () => {
    const before = bind('about', about)
    const changed = path[0] === 'location' ? { ...before, location: { ...before.location, address: 'نشانی تازه' } }
      : { ...before, [String(path[0])]: 'متن تازه' }
    const next = reconcileContentTranslation('about', id, before, changed)
    assert.equal(contentTranslationFields('about', next).filter(field => field.status === 'needs-review').length, 1)
    assert.equal(contentTranslationValue('about', next, path), null)
    assert.equal(next.location.lat, about.location.lat)
    assert.equal(next.location.lng, about.location.lng)
    assert.deepEqual(next.blocks, about.blocks)
    assert.equal(next.heroGradient, about.heroGradient)
  })
}
test('About coordinate-only updates leave every Arabic field valid and source revision unchanged', () => {
  const before = bind('about', about)
  const next = reconcileContentTranslation('about', id, before, { ...before, location: { ...before.location, lat: 1.234567890123, lng: 9.876543210987 } })
  assert(contentTranslationFields('about', next).every(field => field.status === 'translated'))
  assert.equal(next.location.addressAr, 'عنوان')
  assert.equal(contentSourceRevision('about', before), contentSourceRevision('about', next))
})

test('arAuto does not affect conservative legacy origin or block translation of missing sibling fields', () => {
  const legacy = { ...source, arAuto: true, descriptionAr: null }
  const next = reconcileContentTranslation('product', id, legacy, legacy)
  assert.equal(next.nameAr, 'وجبة')
  assert.deepEqual(eligibleContentTranslationFields('product', next).map(field => field.fieldId), ['description'])
  assert.equal(requireValue(contentTranslationFields('product', next).find(field => field.fieldId === 'name')).origin, 'legacy')
})
test('legacy metadata-only reconciliation loses no scalar or nested Arabic text', () => {
  const next = reconcileContentTranslation('product', id, source, source)
  assert.equal(next.nameAr, source.nameAr)
  assert.equal(next.descriptionAr, source.descriptionAr)
  assert.deepEqual(next.ingredientsAr, source.ingredientsAr)
  assert.deepEqual(source.ingredientsAr, ['جبن', 'فطر', 'صلصة'])
})
test('legacy extra Arabic entries are recoverable rather than silently removed', () => {
  const legacy = { ...source, ingredients: ['پنیر'], ingredientsAr: ['جبن', 'نص إضافي'] }
  const next = reconcileContentTranslation('product', id, legacy, legacy)
  assert.deepEqual(next.ingredientsAr, ['جبن'])
  assert(next.translationState.orphanedFields?.some(field => field.value === 'نص إضافي'))
})
test('archives remain bounded, survive later saves and never enter queue/public DTOs', () => {
  const before = bind('product', source)
  const next = reconcileContentTranslation('product', id, before, { ...before, ingredients: [] })
  assert.equal(requireValue(next.translationState.orphanedFields).length, 3)
  const later = reconcileContentTranslation('product', id, next, next)
  assert.equal(requireValue(later.translationState.orphanedFields).length, 3)
  assert.equal(eligibleContentTranslationFields('product', later).length, 0)
  const publicRow = localizeContentRecord('product', later)
  assert.equal('translationState' in publicRow, false)
})

test('legacy draft archive enforces its entry cap without altering active translations', () => {
  const before = bind('product', source)
  before.translationState.orphanedFields = Array.from({ length: 1001 }, (_, index) => ({
    fieldId: `removed:${index}`, fieldPath: ['ingredients', index], sourceText: `source-${index}`,
    value: `draft-${index}`, origin: 'legacy', status: 'needs-review', revision: 0,
  }))
  const next = reconcileContentTranslation('product', id, before, before)
  assert.equal(next.translationState.orphanedFields?.length, 1000)
  assert.equal(next.nameAr, source.nameAr)
  assert.deepEqual(next.ingredientsAr, source.ingredientsAr)
  assert.equal(eligibleContentTranslationFields('product', next).length, 0)
})

test('legacy draft archive enforces its text cap and skips oversized drafts safely', () => {
  const before = bind('product', source)
  const archive = (fieldId: string, length: number) => ({
    fieldId, fieldPath: ['ingredients', 0], sourceText: 's', value: 'a'.repeat(length),
    origin: 'legacy' as const, status: 'needs-review' as const, revision: 0,
  })
  before.translationState.orphanedFields = [archive('too-large', 2_000_000),
    archive('first', 999_999), archive('second', 999_999), archive('overflow', 1)]
  const next = reconcileContentTranslation('product', id, before, before)
  assert.deepEqual(next.translationState.orphanedFields?.map(field => field.fieldId), ['first', 'second'])
  assert.equal(next.translationState.orphanedFields?.reduce((sum, field) => sum + field.sourceText.length + field.value.length, 0), 2_000_000)
  assert.equal(next.descriptionAr, source.descriptionAr)
})
test('manual explicit clear removes stale draft, and source proof revisions prevent old draft restoration', () => {
  const before = bind('product', source)
  const next = reconcileContentTranslation('product', id, before, { ...before, name: 'غذای تازه' })
  const cleared = reconcileContentTranslation('product', id, next, next, [proof('product', next, ['name'], '')])
  assert.equal(cleared.nameAr, null)
  assert.equal(requireValue(contentTranslationFields('product', cleared).find(field => field.fieldId === 'name')).staleValue, undefined)
  assert.equal(reconcileContentTranslation('product', id, cleared, cleared, [proof('product', next, ['name'], 'قديم')]).nameAr, null)
})
test('invalid/mismatched provenance cannot make non-null Arabic look valid', () => {
  const before = bind('product', source)
  const mismatched = { ...before, translationState: { ...before.translationState, entityId: 'another-entity' } }
  assert.equal(contentTranslationValue('product', mismatched, ['name']), null)
  const invalid = { ...before, translationState: { ...before.translationState, fields: before.translationState.fields.filter(field => field.fieldId !== 'description') } }
  assert.equal(contentTranslationValue('product', invalid, ['description']), null)
})

for (const invalidState of ['incomplete', 'wrong-entity', 'invalid-revision'] as const) {
  test(`${invalidState} provenance preserves raw manual Arabic as recoverable drafts during metadata saves`, () => {
    const before = bind('product', source)
    if (invalidState === 'incomplete') before.translationState.fields = before.translationState.fields.filter(field => field.fieldId !== 'description')
    if (invalidState === 'wrong-entity') before.translationState.entityId = 'another-entity'
    if (invalidState === 'invalid-revision') {
      before.translationState.fields = before.translationState.fields.map(field => field.fieldId === 'description' ? { ...field, revision: -1 } : field)
    }
    const next = reconcileContentTranslation('product', id, before, { ...before, price: 200000 })
    const field = requireValue(contentTranslationFields('product', next).find(item => item.fieldId === 'description'))
    assert.equal(next.descriptionAr, null)
    assert.equal(field.status, 'needs-review')
    assert.equal(field.staleValue, source.descriptionAr)
    assert.equal(field.staleSourceText, source.description)
    assert.equal(contentTranslationValue('product', next, ['description']), null)
    const publicRow = localizeContentRecord('product', next)
    assert.equal(publicRow.descriptionAr, null)
    assert.equal(publicRow.description, source.description)
    const later = reconcileContentTranslation('product', id, next, next)
    assert.equal(requireValue(contentTranslationFields('product', later).find(item => item.fieldId === 'description')).staleValue, source.descriptionAr)
    assert.equal(eligibleContentTranslationFields('product', later).some(item => item.fieldId === 'description'), false)
    if (invalidState !== 'wrong-entity') {
      assert.equal(next.nameAr, source.nameAr)
      assert.deepEqual(next.ingredientsAr, source.ingredientsAr)
    }
  })
}

for (const type of ['terms', 'article'] as const) {
  test(`${type} new item identities follow their resolved parent and reject inconsistent namespaces`, () => {
    const key = type === 'terms' ? 'sections' : 'processes'
    const before = bind(type, { id, [key]: [], [`${key}Ar`]: null })
    const row = { ...before, [key]: [{ title: 'new section', items: ['new item'] }] }
    const parentId = `${key}:client-parent`
    const titleEdit: TranslationEdit = { fieldId: parentId, fieldPath: [key, 0, 'title'], sourceText: 'new section', value: 'manual Arabic title', revision: 0, origin: 'manual' }
    const itemEdit: TranslationEdit = { fieldId: `${parentId}:items:client-item`, fieldPath: [key, 0, 'items', 0], sourceText: 'new item', value: 'manual Arabic item', revision: 0, origin: 'manual' }
    const accepted = reconcileContentTranslation(type, id, before, row, [titleEdit, itemEdit])
    const values = () => contentTranslationFields(type, accepted).filter(field => field.fieldPath[0] === key)
    assert.deepEqual(values().map(field => field.value), ['manual Arabic title', 'manual Arabic item'])
    assert.deepEqual(values().map(field => field.fieldId), [parentId, itemEdit.fieldId])
    assert(values().every(field => field.status === 'translated' && field.origin === 'manual'))
    const later = reconcileContentTranslation(type, id, accepted, accepted)
    assert.deepEqual(contentTranslationFields(type, later).filter(field => field.fieldPath[0] === key).map(field => field.value), ['manual Arabic title', 'manual Arabic item'])
    const rejected = reconcileContentTranslation(type, id, before, row, [titleEdit, { ...itemEdit, fieldId: `${key}:wrong-parent:items:client-item` }])
    const fields = contentTranslationFields(type, rejected).filter(field => field.fieldPath[0] === key)
    assert.equal(fields[0]?.value, 'manual Arabic title')
    assert.equal(fields[1]?.value, null)
    assert.equal(fields[1]?.fieldId.startsWith(`${parentId}:items:`), true)
    assert.equal(rejected.translationState.fields.some(field => field.fieldId.includes('wrong-parent')), false)
    const twoItems = { ...before, [key]: [{ title: 'new section', items: ['new item', 'sibling item'] }] }
    const collided = reconcileContentTranslation(type, id, before, twoItems, [titleEdit, { ...itemEdit, fieldId: `${parentId}:items:1` }])
    assert.equal(new Set(collided.translationState.fields.map(field => field.fieldId)).size, collided.translationState.fields.length)
    assert.equal(contentTranslationFields(type, collided).find(field => field.sourceText === 'sibling item')?.value, null)
    assert.deepEqual(row[key], [{ title: 'new section', items: ['new item'] }])
  })
}

test('case variants of UUID request IDs bind provenance to the canonical database row', () => {
  const rowId = 'abcde123-abcd-4abc-8abc-abcdef123456'
  const before = reconcileContentTranslation('product', rowId, null, { ...source, id: rowId })
  const next = reconcileContentTranslation('product', rowId.toUpperCase(), before, { ...before, price: 200000 })
  assert.equal(next.translationState.entityId, rowId)
  assert.equal(contentTranslationValue('product', next, ['name']), source.nameAr)
  assert.equal(contentTranslationValue('product', next, ['description']), source.descriptionAr)
  assert.deepEqual(next.ingredientsAr, source.ingredientsAr)
  assert.equal(eligibleContentTranslationFields('product', next).length, 0)
})
test('whitelist excludes coordinates, IDs, URLs, images, styles and arbitrary object properties', () => {
  const fields = contentTranslationFields('about', about)
  assert.deepEqual(fields.map(field => field.fieldPath), [['heroTitle'], ['heroText'], ['teamTitle'], ['teamAlt'], ['location', 'address']])
  for (const path of [['location', 'lat'], ['location', 'lng'], ['id'], ['heroGradient'], ['blocks'], ['__proto__']] as ContentFieldPath[]) {
    assert.equal(contentTranslationValue('about', about, path), null)
  }
})
test('source-bound client identities for newly inserted fields remain stable without collisions', () => {
  const before = bind('product', { ...source, ingredients: ['پنیر'], ingredientsAr: ['جبن'] })
  const next = reconcileContentTranslation('product', id, before, { ...before, ingredients: ['پنیر', 'قارچ'] }, [{
    fieldId: 'ingredients:new-client-id', fieldPath: ['ingredients', 1], sourceText: 'قارچ', revision: 0, value: 'فطر', origin: 'manual',
  }])
  assert.deepEqual(next.ingredientsAr, ['جبن', 'فطر'])
  assert.equal(requireValue(contentTranslationFields('product', next).find(field => field.sourceText === 'قارچ')).fieldId, 'ingredients:new-client-id')
  const collided = reconcileContentTranslation('product', id, before, { ...before, ingredients: ['پنیر', 'قارچ', 'سس'] }, [{
    fieldId: 'ingredients:2', fieldPath: ['ingredients', 1], sourceText: 'قارچ', revision: 0, value: 'فطر', origin: 'manual',
  }])
  assert.equal(new Set(collided.translationState.fields.map(field => field.fieldId)).size, collided.translationState.fields.length)
})
test('new terms version identity preserves existing source-bound field origins and reorder mapping', () => {
  const before = bind('terms', { id, sections: [{ title: 'اول', items: ['یک'] }, { title: 'دوم', items: ['دو'] }],
    sectionsAr: [{ title: 'الأول', items: ['أ'] }, { title: 'الثاني', items: ['ب'] }] })
  const nextId = 'next-terms-version'
  const next = reconcileContentTranslation('terms', nextId, before, { ...before, id: nextId,
    sections: [{ title: 'دوم', items: ['دو'] }, { title: 'اول', items: ['یک'] }],
  })
  assert.equal(next.translationState.entityId, nextId)
  assert.deepEqual(next.sectionsAr, [{ title: 'الثاني', items: ['ب'] }, { title: 'الأول', items: ['أ'] }])
  assert(contentTranslationFields('terms', next).every(field => field.origin === 'manual' && field.status === 'translated'))
})
for (const [type, path, row, limit] of [
  ['product', ['description'], { id, name: 'غذا', description: 'توضیح', ingredients: [] }, 2000],
  ['product', ['ingredients', 0], { id, name: 'غذا', description: 'توضیح', ingredients: ['پنیر'] }, 60],
  ['category', ['sizeNames', 0], { id, name: 'دسته', sizeNames: ['کوچک'] }, 40],
  ['article', ['excerpt'], { id, title: 'مقاله', excerpt: 'خلاصه', content: 'متن', processes: [] }, 1000],
  ['article', ['content'], { id, title: 'مقاله', excerpt: 'خلاصه', content: 'متن', processes: [] }, 100000],
  ['article', ['processes', 0, 'items', 0], { id, title: 'مقاله', excerpt: 'خلاصه', content: 'متن', processes: [{ title: 'اول', items: ['یک'] }] }, 300],
] as const) {
  test(`${type}:${path.join('.')} translation output limit exactly matches admin API`, () => {
    const before = bind(type, row)
    const selected = requireValue(contentTranslationFields(type, before).find(field => JSON.stringify(field.fieldPath) === JSON.stringify(path)))
    assert.equal(selected.maxLength, limit)
    const accepted = reconcileContentTranslation(type, id, before, before, [proof(type, before, [...path], 'ا'.repeat(limit), 'automatic')])
    assert.equal(requireValue(contentTranslationValue(type, accepted, [...path])).length, limit)
    const rejected = reconcileContentTranslation(type, id, before, before, [proof(type, before, [...path], 'ا'.repeat(limit + 1), 'automatic')])
    assert.equal(contentTranslationValue(type, rejected, [...path]), null)
  })
}
test('failed-field error survives unrelated source edits and clears only for new source or successful translation', () => {
  const before = bind('product', { id, name: 'غذا', nameAr: 'وجبة', description: 'توضیح', descriptionAr: null, ingredients: [] })
  const failed = { ...before, translationState: { ...before.translationState, fields: before.translationState.fields.map(field =>
    field.fieldId === 'description' ? { ...field, error: 'Translator unavailable' } : field) } }
  const changedSibling = reconcileContentTranslation('product', id, failed, { ...failed, name: 'غذای تازه' })
  assert.equal(requireValue(contentTranslationFields('product', changedSibling).find(field => field.fieldId === 'description')).error, 'Translator unavailable')
  const changedSource = reconcileContentTranslation('product', id, failed, { ...failed, description: 'توضیح تازه' })
  assert.equal(requireValue(contentTranslationFields('product', changedSource).find(field => field.fieldId === 'description')).error, undefined)
  const translated = reconcileContentTranslation('product', id, failed, failed, [proof('product', failed, ['description'], 'وصف', 'automatic')])
  assert.equal(requireValue(contentTranslationFields('product', translated).find(field => field.fieldId === 'description')).error, undefined)
})
console.log(`Shared content translation regressions: ${count} passed`)
