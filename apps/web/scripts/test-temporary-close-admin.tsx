import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { TEMPORARY_CLOSE_REASON_MIN_LENGTH, type AdminRestaurantStatusDto } from '@sinshin/shared'
import { qk } from '../src/utils/queryKeys'

// Exercise real card/translation handlers and API adapters. This small hook
// host preserves state and effect cleanup across renders and modal unmounts.
const react = { ...await import('react') }
type Host = { cells: any[]; cursor: number; effects: Array<() => void> }
const freshHost = (): Host => ({ cells: [], cursor: 0, effects: [] })
const cardHost = freshHost()
let host = cardHost
let fieldHost: Host | null = null
let fieldKey: unknown
let nextId = 0
mock.module('react', () => ({
	...react,
	memo: (component: unknown) => component,
	useCallback: (callback: unknown) => callback,
	useState<T>(initial: T) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = initial
		return [active.cells[index], (value: T | ((previous: T) => T)) => {
			active.cells[index] = typeof value === 'function' ? (value as (previous: T) => T)(active.cells[index]) : value
		}]
	},
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useId() {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = `arabic-field-${nextId++}`
		return host.cells[index]
	},
	useEffect(effect: () => void | (() => void), deps: unknown[]) {
		const active = host
		const index = active.cursor++
		const previous = active.cells[index]
		if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
		const slot = { kind: 'effect', deps, cleanup: undefined as undefined | (() => void) }
		active.cells[index] = slot
		active.effects.push(() => {
			previous?.cleanup?.()
			slot.cleanup = effect() || undefined
		})
	},
}))
function commit(active: Host) {
	for (const effect of active.effects.splice(0)) effect()
}
function unmount(active: Host) {
	for (const cell of active.cells) if (cell?.kind === 'effect') cell.cleanup?.()
}
type Input = { closed: boolean; disablePayments?: boolean; reason: string; reasonAr?: string | null; reopenTime?: string }
type Mutation = { mutationFn: (input: Input) => Promise<unknown>; onSuccess: () => void; onError: (error: unknown) => void }
const saves: Input[] = []
const saveProofs: { sourceRevision?: string; translationEdits?: { fieldId: string; sourceText: string; value: string }[] }[] = []
let saveWork = async (_input: Input) => {}
let status: AdminRestaurantStatusDto | undefined
let pendingWork: Promise<void> | null = null
let pending = false
const invalidations: unknown[] = []
mock.module('@tanstack/react-query', () => ({
	useQuery: () => ({ data: status }),
	useQueryClient: () => ({ invalidateQueries: ({ queryKey }: { queryKey: unknown }) => { invalidations.push(queryKey) } }),
	useMutation: (options: Mutation) => ({
		isPending: pending,
		mutate: (input: Input) => {
			pending = true
			pendingWork = options.mutationFn(input).then(options.onSuccess, options.onError).finally(() => { pending = false })
		},
	}),
}))
mock.module('#/utils/queryOptions', () => ({ settingsRestaurantStatusOptions: { queryKey: qk.settingsRestaurantStatus } }))
const translationRequests: string[][] = []
let translationWork = async (_texts: string[]) => ['ترجمة عربية طويلة لسبب الإغلاق المؤقت']
mock.module('#/lib/api-fetch', () => ({
	authJson: async (path: string, method: string, body: any) => {
		assert.equal(method, 'POST')
		if (path === '/admin/translate/preview') {
			translationRequests.push(body.texts)
			return { translations: await translationWork(body.texts) }
		}
		assert.equal(path, '/admin/settings/temporary-close')
		const { sourceRevision, translationEdits, ...businessFields } = body
		saveProofs.push({ sourceRevision, translationEdits })
		saves.push(businessFields)
		await saveWork(businessFields)
		return {}
	},
}))
const toasts: { message: string; kind?: string }[] = []
mock.module('#/stores/toastStore', () => ({
	useToastStore: (select: any) => select({ showToast(message: string, kind?: string) { toasts.push({ message, kind }) } }),
}))
const { TemporaryCloseCard } = await import('../src/components/admin/settings/TemporaryCloseCard')
const { ArField } = await import('../src/components/admin/ArField')
type Element = { type: unknown; key?: unknown; props: Record<string, any> }
let tree: unknown
let fieldTree: unknown
function rawNodes(value: unknown): Element[] {
	if (Array.isArray(value)) return value.flatMap(rawNodes)
	if (!value || typeof value !== 'object' || !('props' in value)) return []
	const element = value as Element
	return [element, ...rawNodes(element.props.children)]
}
function nodes(): Element[] { return [...rawNodes(tree), ...rawNodes(fieldTree)] }
function render(visible = true) {
	host = cardHost
	host.cursor = 0
	tree = TemporaryCloseCard({ visible })
	commit(cardHost)
	const field = rawNodes(tree).find((node) => node.type === ArField)
	if (fieldHost && (!field || field.key !== fieldKey)) {
		unmount(fieldHost)
		fieldHost = null
	}
	fieldTree = null
	if (field) {
		fieldHost ??= freshHost()
		fieldKey = field.key
		host = fieldHost
		host.cursor = 0
		fieldTree = ArField(field.props as any)
		commit(fieldHost)
	}
	return tree
}
function find(predicate: (element: Element) => boolean) {
	const element = nodes().find(predicate)
	assert(element, 'Expected card control is present')
	return element
}
const reasonField = () => find((node) => node.type === 'textarea' && !node.props.id)
const arabicField = () => find((node) => node.type === 'textarea' && Boolean(node.props.id))
const paymentToggle = () => find((node) => node.props.label === 'غیرفعال کردن پرداخت سفارش‌ها')
const previewButton = () => find((node) => node.props.title?.startsWith('ترجمه‌ی خودکار'))
const confirmButton = () => find((node) => node.type === 'button' && ['ثبت و بستن موقت', 'ثبت و باز شدن', 'ذخیره تغییرات', 'در حال ثبت...'].includes(node.props.children))
const makeStatus = (closed = false): AdminRestaurantStatusDto => ({
	sourceRevision: 'saved-status-token',
	isOpen: true, temporarilyClosed: closed, paymentsDisabled: false,
	temporaryCloseReason: null, temporaryCloseReasonAr: null, temporaryReopenTime: '',
	nextOpenTime: '11:00', anyClosed: closed, isBusy: false,
})
function toggle() {
	find((node) => node.props.label === 'باز/بسته موقت رستوران').props.onToggle()
	render()
}
function openModal(closed: boolean) {
	status = makeStatus(!closed)
	render()
	toggle()
}
function change(field: Element, value: string) {
	field.props.onChange({ target: { value } })
	render()
}
function cancel() {
	find((node) => node.type === 'button' && node.props.children === 'انصراف').props.onClick()
	render()
}
async function confirm() {
	pendingWork = null
	confirmButton().props.onClick()
	if (pendingWork) await pendingWork
	render()
}
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0))
	render()
}
function deferTranslation() {
	let resolve!: (result: string[]) => void
	translationWork = () => new Promise((done) => { resolve = done })
	return (result: string[]) => resolve(result)
}

assert.equal(TEMPORARY_CLOSE_REASON_MIN_LENGTH, 20)
assert.equal(render(false), null)
render()
toggle()
assert(!nodes().some((node) => node.type === 'textarea'), 'loading cannot open the dialog')
openModal(true)
assert.equal(reasonField().props.minLength, 20)
assert.equal(arabicField().props.minLength, 20)
assert.equal(reasonField().props.maxLength, 120)
assert.equal(arabicField().props.maxLength, 120)
assert.equal(paymentToggle().props.isOn, false, 'closing allows payments unless the admin disables them')
const nineteen = 'ا'.repeat(19)
const twenty = 'ا'.repeat(20)
for (const invalid of ['', ' '.repeat(20), nineteen, `  ${nineteen}  `]) {
	change(reasonField(), invalid)
	await confirm()
	assert.equal(saves.length, 0, 'closing requires 20 trimmed characters')
	assert(toasts.at(-1)?.message.includes('۲۰'))
}
change(reasonField(), ` ${twenty} `)
change(arabicField(), '   ')
change(find((node) => node.type === 'input'), '  ۱۹:۰۰  ')
await confirm()
assert.deepEqual(saves.at(-1), { closed: true, disablePayments: false, reason: twenty, reasonAr: null, reopenTime: '۱۹:۰۰' })
assert.equal(saveProofs.at(-1)?.translationEdits?.[0]?.sourceText, twenty, 'manual Arabic proof is bound only to the current Persian reason')
assert.equal(typeof saveProofs.at(-1)?.sourceRevision, 'string', 'the status mutation carries the pinned server source revision')
assert(!nodes().some((node) => node.type === 'textarea'))
assert.deepEqual(invalidations.slice(-2), [qk.settingsRestaurantStatus, qk.restaurantStatus])
openModal(true)
change(reasonField(), twenty)
change(arabicField(), ` ${nineteen} `)
await confirm()
assert.equal(saves.length, 1, 'nonempty Arabic also needs 20 trimmed characters')
change(arabicField(), ` ${twenty} `)
paymentToggle().props.onToggle()
render()
await confirm()
assert.deepEqual(saves.at(-1), { closed: true, disablePayments: true, reason: twenty, reasonAr: twenty, reopenTime: undefined })

// Machine translation fills the editable field through the existing preview API.
openModal(true)
assert.equal(paymentToggle().props.isOn, false, 'a new closure does not inherit the previous payment pause')
change(reasonField(), ` ${twenty} `)
const arabic = 'ترجمة عربية طويلة لسبب الإغلاق المؤقت'
let finishTranslation = deferTranslation()
previewButton().props.onClick()
previewButton().props.onClick()
render()
assert.equal(translationRequests.length, 1, 'a second immediate click cannot duplicate a preview')
assert.deepEqual(translationRequests[0], [twenty], 'translation receives the trimmed Persian reason')
assert.equal(previewButton().props.disabled, true)
assert.equal(arabicField().props.disabled, false, 'the Arabic draft remains editable during preview')
finishTranslation([arabic])
await settle()
assert.equal(arabicField().props.value, arabic)
assert.equal(previewButton().props.disabled, true, 'completed translations are protected against redundant automatic replacement')
change(arabicField(), twenty)
assert.equal(arabicField().props.value, twenty, 'machine output is editable before saving')

for (const [index, output] of [nineteen, 'ا'.repeat(121), ''].entries()) {
	change(reasonField(), twenty + 'ا'.repeat(index + 1))
	translationWork = async () => [output]
	previewButton().props.onClick()
	await settle()
	assert.equal(arabicField().props.value, twenty, 'invalid translation is neither applied nor silently truncated')
	assert.equal(toasts.at(-1)?.kind, 'error')
}
translationWork = async () => { throw new Error('Translator unavailable') }
previewButton().props.onClick()
await settle()
assert.equal(toasts.at(-1)?.message, 'Translator unavailable')
assert.equal(arabicField().props.value, twenty)
assert.equal(previewButton().props.disabled, false, 'translation failure permits retry')

finishTranslation = deferTranslation()
previewButton().props.onClick()
change(arabicField(), 'ب'.repeat(20))
finishTranslation([arabic])
await settle()
assert.equal(arabicField().props.value, 'ب'.repeat(20), 'late translation cannot overwrite a manual Arabic edit')
change(reasonField(), 'ت'.repeat(20))
finishTranslation = deferTranslation()
previewButton().props.onClick()
change(reasonField(), 'پ'.repeat(20))
finishTranslation([arabic])
await settle()
assert.equal(arabicField().props.value, 'ب'.repeat(20), 'late translation cannot apply to a changed Persian source')
finishTranslation = deferTranslation()
previewButton().props.onClick()
paymentToggle().props.onToggle()
render()
cancel()
openModal(true)
change(reasonField(), twenty)
finishTranslation([arabic])
await settle()
assert.equal(arabicField().props.value, '', 'canceling and reopening discards the previous modal translation')
assert.equal(paymentToggle().props.isOn, false)
cancel()

// Existing closures can change payment availability without reopening.
status = { ...makeStatus(true), paymentsDisabled: true, temporaryCloseReason: twenty, temporaryCloseReasonAr: arabic, temporaryReopenTime: '19:30' }
render()
find((node) => node.props.children === 'ویرایش علت و پرداخت').props.onClick()
render()
assert.equal(reasonField().props.value, twenty)
assert.equal(arabicField().props.value, arabic, 'editing options retains the stored Arabic reason')
assert.equal(paymentToggle().props.isOn, true)
paymentToggle().props.onToggle()
render()
let finishSave!: () => void
saveWork = () => new Promise<void>((resolve) => { finishSave = resolve })
const beforeSave = saves.length
const save = confirmButton().props.onClick
save()
save()
render()
assert.equal(saves.length, beforeSave + 1, 'immediate duplicate saves are blocked')
assert.equal(confirmButton().props.disabled, true)
assert.equal(reasonField().props.disabled, true)
assert.equal(arabicField().props.disabled, true)
assert.equal(paymentToggle().props.disabled, true)
change(reasonField(), 'ت'.repeat(20))
paymentToggle().props.onToggle()
cancel()
assert.equal(reasonField().props.value, twenty, 'pending writes lock draft handlers and cancellation')
assert.equal(paymentToggle().props.isOn, false)
finishSave()
await pendingWork
render()
assert.deepEqual(saves.at(-1), { closed: true, disablePayments: false, reason: twenty, reasonAr: arabic, reopenTime: '19:30' })
saveWork = async () => {}

openModal(false)
assert.equal(reasonField().props.minLength, 3)
assert(!nodes().some((node) => node.type === ArField), 'reopening does not request a public Arabic reason')
const beforeReopen = saves.length
change(reasonField(), '  اب  ')
await confirm()
assert.equal(saves.length, beforeReopen)
change(reasonField(), '  باز  ')
await confirm()
assert.deepEqual(saves.at(-1), { closed: false, disablePayments: false, reason: 'باز', reasonAr: null, reopenTime: undefined })

openModal(true)
change(reasonField(), 'ا'.repeat(130))
change(arabicField(), 'ب'.repeat(130))
assert.equal(reasonField().props.value.length, 120)
assert.equal(arabicField().props.value.length, 120, 'manual text retains the existing 120-character input cap')
paymentToggle().props.onToggle()
render()
saveWork = async () => { throw new Error('Save unavailable') }
await confirm()
assert.equal(toasts.at(-1)?.message, 'Save unavailable')
assert.equal(reasonField().props.value.length, 120, 'failed saving preserves the draft')
assert.equal(paymentToggle().props.isOn, true, 'failed saving preserves the payment option')
assert.equal(confirmButton().props.disabled, false)
saveWork = async () => {}
await confirm()
assert.equal(saves.at(-1)?.reason.length, 120)
assert.equal(saves.at(-1)?.reasonAr?.length, 120)
assert.equal(saves.at(-1)?.disablePayments, true)

// Other ArField callers retain short translations when they do not request a
// minimum, and input mode/maxLength/manual editing still work as before.
const standalone = freshHost()
let standaloneValue = ''
function renderStandalone() {
	host = standalone
	host.cursor = 0
	const result = ArField({ label: 'نام محصول', value: standaloneValue, onChange: (value) => { standaloneValue = value }, faSource: 'قهوه', maxLength: 60 })
	commit(standalone)
	return rawNodes(result)
}
translationWork = async () => ['قهوة']
let standaloneNodes = renderStandalone()
standaloneNodes.find((node) => node.props.title?.startsWith('ترجمه‌ی خودکار'))!.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
standaloneNodes = renderStandalone()
assert.equal(standaloneValue, 'قهوة', 'the temporary closure minimum is not imposed on other forms')
const ordinaryInput = standaloneNodes.find((node) => node.type === 'input')!
assert.equal(ordinaryInput.props.minLength, undefined)
assert.equal(ordinaryInput.props.maxLength, 60)
ordinaryInput.props.onChange({ target: { value: 'شاي' } })
assert.equal(standaloneValue, 'شاي')
unmount(standalone)
console.log('PASS temporary close admin: trimmed validation, safe editable translation, async races, payment pause/default/reset, edit existing, pending protection and shared ArField compatibility')
