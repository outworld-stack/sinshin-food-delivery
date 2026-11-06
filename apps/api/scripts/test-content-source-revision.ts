import assert from 'node:assert/strict'
import { Elysia, t } from 'elysia'
import { contentSourceRevision, contentTranslationFields, matchesContentSourceRevision, reconcileContentTranslation } from '@sinshin/shared'
import { contentSourceFingerprint } from '../../../packages/shared/src/content-source-fingerprint'
import { translationEditsSchema } from '../src/http/routes/content-translation.schemas'

for (const input of ['', 'abc', 'عنوان فارسی و ترجمة عربية', '🙂\ud800',
	...Array.from({ length: 140 }, (_, length) => 'x'.repeat(length)), 'a'.repeat(1_000_000)]) {
	assert.equal(contentSourceFingerprint(input), new Bun.CryptoHasher('sha256').update(input).digest('hex'),
		`source digest agrees with platform SHA-256 for ${input.length} characters`)
}

const row = { id: 'legacy-terms', sections: Array.from({ length: 100 }, (_, section) => ({ title: `بخش ${section}`,
	items: Array.from({ length: 21 }, (_, item) => `${section}:${item}:${'ف'.repeat(990)}`) })), sectionsAr: null }
const sourceBytes = Buffer.byteLength(JSON.stringify(row))
assert(sourceBytes < 8 * 1024 * 1024, 'legacy terms remain within the existing HTTP body limit')
const token = contentSourceRevision('terms', row)
assert.equal(token.length, 71, 'large legacy terms carry a bounded optimistic token')
assert(matchesContentSourceRevision('terms', row, token))
const changed = structuredClone(row)
const section = changed.sections[20]
assert(section, 'the changed legacy section exists')
const item = section.items[11]
assert(item, 'the changed legacy item exists')
section.items[11] = `${item}تغییر`
assert(!matchesContentSourceRevision('terms', changed, token), 'changing one large nested field rejects the old proof')
assert.equal(contentSourceRevision('terms', { ...row, unrelatedStyle: 'new' }), token, 'unrelated structural properties do not invalidate content proofs')

const product = reconcileContentTranslation('product', 'one', null, { id: 'one', name: 'نام', nameAr: null, description: 'متن', descriptionAr: null })
const before = contentSourceRevision('product', product)
const field = contentTranslationFields('product', product).find(item => item.fieldId === 'name')
assert(field, 'product name is whitelisted')
const reviewed = reconcileContentTranslation('product', 'one', product, product, [{ fieldId: field.fieldId, fieldPath: field.fieldPath,
	sourceText: field.sourceText, revision: field.revision, value: 'اسم', origin: 'manual' }])
assert(!matchesContentSourceRevision('product', reviewed, before), 'manual field revisions fence late drafts')
const legacyToken = JSON.stringify([contentTranslationFields('product', product).map(item => [item.fieldId, item.fieldPath, item.sourceText, item.revision]), null, null])
assert(matchesContentSourceRevision('product', product, legacyToken), 'an unchanged earlier exact token remains compatible')
assert(!matchesContentSourceRevision('product', reviewed, legacyToken), 'earlier exact tokens cannot bypass a newer revision')
const proofApi = new Elysia().post('/proofs', ({ body }) => ({ count: body.edits.length }), { body: t.Object({ edits: translationEditsSchema }) })
const maximumTermsEdits = Array.from({ length: 100 }, (_, section) => [
	{ fieldId: `sections:${section}`, fieldPath: ['sections', section, 'title'], sourceText: `بخش ${section}`, value: 'عنوان', revision: 0, origin: 'manual' },
	...Array.from({ length: 100 }, (_, item) => ({ fieldId: `sections:${section}:items:${item}`, fieldPath: ['sections', section, 'items', item],
		sourceText: `بند ${item}`, value: 'بند', revision: 0, origin: 'manual' })),
]).flat()
const proofResponse = await proofApi.handle(new Request('http://localhost/proofs', { method: 'POST',
	headers: { 'content-type': 'application/json' }, body: JSON.stringify({ edits: maximumTermsEdits }) }))
assert.equal(proofResponse.status, 200, 'the proof schema accepts every field in the existing maximum terms model')
assert.deepEqual(await proofResponse.json(), { count: 10100 })
console.log('PASS compact source revisions: SHA-256 vectors, large legacy terms, exact text changes, manual revisions and earlier proof compatibility')
