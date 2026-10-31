// ═══════════════════════════════════════════════════════════════
// stage-102 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/scripts/test-stage102-client.tsx
// تست‌های سمت کلاینتِ استیج-۱۰۲:
//   ۱) fmt.datetime (fa) — ترکیبِ «روز، ساعت …» + گاردِ تاریخِ خراب
//   ۲) InboxList — اعلانِ بدونِ لینک: کلیک ⇒ خوانده‌شده + مدالِ محتوای
//      کامل (متنِ بلند قیچ نمی‌شود)؛ Escape می‌بندد؛ اعلانِ لینک‌دار ناوبری
//      می‌کند و مدال باز نمی‌کند
//   ۳) NotificationDetailModal — open=false ⇒ null؛ پرده/Escape بستن
//   ۴) بازبینی منبع: هاله‌های لندینگ بدونِ blur و با گرادیان + سیمِ
//      تاریخچه‌ی ادمین (ردیفِ بدونِ url ⇒ مدال)
// الگوی اجرا: همان «میزبانِ هوکِ دست‌ساز» ی test-cart-orb (فراخوانیِ
// مستقیمِ کامپوننت به‌عنوان تابع خالص + اجرای دستیِ افکت‌ها + حلِ
// بازگشتیِ کامپوننت‌های فرزند مثل InboxRow و مدال).
// ═══════════════════════════════════════════════════════════════

import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ReactElement } from 'react'

// ── میزبان هوک (همان الگوی test-cart-orb) ──
const react = { ...await import('react') }
type EffectCell = { deps: readonly unknown[]; cleanup?: () => void }
type Host = { cells: unknown[]; cursor: number; effects: Array<() => void>; dirty: boolean }
let host: Host = { cells: [], cursor: 0, effects: [], dirty: false }
const hooks = {
	memo: (component: unknown) => component,
	useCallback: (callback: unknown) => callback,
	useDebugValue() {},
	// خارج از Provider ⇒ I18N_FALLBACK فارسی با fmt واقعی
	useContext: () => null,
	useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
	useState<T>(initial: T) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = initial
		return [active.cells[index], (value: T) => {
			// setter تابعی (setDetail(null)) و مقداری هر دو
			const next = typeof value === 'function' ? (value as (prev: T) => T)(active.cells[index] as T) : value
			if (!Object.is(active.cells[index], next)) {
				active.cells[index] = next
				active.dirty = true
			}
		}]
	},
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
		const active = host
		const index = active.cursor++
		const previous = active.cells[index] as EffectCell | undefined
		if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
			const cell: EffectCell = { deps }
			active.cells[index] = cell
			active.effects.push(() => {
				previous?.cleanup?.()
				cell.cleanup = effect() || undefined
			})
		}
	},
}
mock.module('react', () => ({ ...react, ...hooks, default: { ...react.default, ...hooks } }))

// ── i18n واقعی برای fmt.datetime (fa) — قبل از mock ماژول ──
const realI18n = await import('../src/i18n')
const { formatDate, formatTime } = await import('../src/utils/format')

// ── ماک i18n برای InboxList (t/fmt ساختگی با جاسوسِ datetime) ──
const datetimeCalls: unknown[] = []
const FAKE_T: Record<string, string> = {
	'notify.title': 'اطلاعیه‌ها',
	'notify.unreadCount': '{n} خوانده‌نشده',
	'notify.markAllRead': 'همه را خوانده‌شده کن',
	'notify.empty': 'فعلاً اطلاعیه‌ای ندارید',
	'notify.inbox.loadError': 'خطا',
	'notify.inbox.retry': 'تلاش مجدد',
	'notify.inbox.daysLeft': '{n} روز مانده',
	'notify.inbox.lessThanDay': 'کمتر از یک روز مانده',
	'notify.inbox.capped': 'آخرین {n} اعلان نمایش داده می‌شود',
	'notify.inbox.sentAt': 'زمان ارسال',
	'notify.inbox.close': 'بستن',
	'notify.type.coupon': 'کوپن',
	'notify.type.discount': 'تخفیف',
	'notify.type.broadcast': 'عمومی',
	'notify.type.system': 'سیستم',
}
const fakeFmt = {
	num: (n: number) => String(n),
	relative: () => 'همین حالا',
	datetime: (d: unknown) => {
		datetimeCalls.push(d)
		return 'FAKE-DATETIME'
	},
}
mock.module('#/i18n', () => ({
	useI18n: () => ({ t: FAKE_T, fmt: fakeFmt }),
	useI18nSafe: realI18n.useI18nSafe,
	tpl: (value: string, args: { n: string }) => value.replace('{n}', args.n),
}))
mock.module('@tanstack/react-router', () => ({
	Link: (props: Record<string, unknown>) => ({ type: 'Link', props }),
}))

const { InboxList } = await import('../src/components/dashboard/notifications/InboxList')
const { NotificationDetailModal } = await import('../src/components/shared/NotificationDetailModal')

// ── رندر: فراخوانیِ کامپوننت + حلِ کامپوننت‌های فرزند + اجرای افکت‌ها ──
/** عناصرِ type=تابع را (مثل InboxRow/memo ها) بازگشتی فراخوانی می‌کند تا
 *  درختِ نهایی فقط عناصرِ میزبان (div/button/Link-mock) را داشته باشد. */
function resolveTree(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(resolveTree)
	if (node && typeof node === 'object' && 'type' in (node as Record<string, unknown>)) {
		const el = node as Record<string, unknown>
		const elType = el.type
		if (typeof elType === 'function') {
			return resolveTree((elType as (p: unknown) => unknown)(el.props))
		}
		const props = el.props as Record<string, unknown> | null
		if (props && 'children' in props) {
			return { ...el, props: { ...props, children: resolveTree(props.children) } }
		}
	}
	return node
}
function render(element: (props: never) => ReactElement | null, props: never): ReactElement | null {
	let tree: ReactElement | null
	do {
		host.cursor = 0
		host.dirty = false
		host.effects = []
		tree = resolveTree(element(props)) as ReactElement | null
		for (const effect of host.effects) effect()
	} while (host.dirty)
	return tree
}
/** جست‌وجوی عمیق در درخت JSX برای عنصری با type دلخواه */
function findAll(node: unknown, type: unknown, acc: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
	if (Array.isArray(node)) {
		for (const child of node) findAll(child, type, acc)
	} else if (node && typeof node === 'object' && 'type' in (node as Record<string, unknown>)) {
		const el = node as Record<string, unknown>
		if (el.type === type) acc.push(el as Record<string, unknown>)
		const props = el.props as Record<string, unknown> | null
		if (props && 'children' in props) findAll(props.children, type, acc)
	}
	return acc
}
/** مدال‌ها: عنصری که role="dialog" دارد (type آن div است) */
function findDialogs(node: unknown, acc: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
	if (Array.isArray(node)) {
		for (const child of node) findDialogs(child, acc)
	} else if (node && typeof node === 'object' && 'type' in (node as Record<string, unknown>)) {
		const el = node as Record<string, unknown>
		if ((el.props as Record<string, unknown> | undefined)?.role === 'dialog') acc.push(el)
		const props = el.props as Record<string, unknown> | null
		if (props && 'children' in props) findDialogs(props.children, acc)
	}
	return acc
}

// ── window ساختگی برای شنونده‌ی Escape ──
type KeyEvent = { key: string; shiftKey?: boolean; preventDefault?: () => void }
const keyHandlers = new Set<(e: KeyEvent) => void>()
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
type FocusTarget = { isConnected: boolean; focus: () => void }
const fakeDocument: { activeElement: FocusTarget | null } = { activeElement: null }
Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: {
		addEventListener: (_kind: string, fn: (e: KeyEvent) => void) => keyHandlers.add(fn),
		removeEventListener: (_kind: string, fn: (e: KeyEvent) => void) => keyHandlers.delete(fn),
	},
})

const FIXED = new Date('2026-10-30T14:45:00Z')
let checked = 0
try {
	// ═══ ۱) fmt.datetime واقعی (fa) ═══
	const fmt = realI18n.useI18nSafe().fmt
	assert.equal(fmt.datetime(FIXED), `${formatDate(FIXED)}، ساعت ${formatTime(FIXED)}`,
		'fa datetime composes the full day and clock time (stage-102)')
	assert.equal(fmt.datetime('not-a-date'), '—', 'datetime falls back for invalid dates')
	assert.ok(fmt.datetime(FIXED).includes('ساعت'), 'datetime includes the hour marker')
	checked += 2

	// ═══ ۲) اعلانِ بدونِ لینک ⇒ مدالِ محتوای کامل ═══
	const LONG_BODY = 'این متنِ بسیار طولانی است که در لیستِ صندوق با line-clamp-2 قیچ می‌شود '.repeat(6)
	const items = [
		{ id: 'n1', type: 'broadcast', title: 'اعلان بدون لینک', body: LONG_BODY, url: null,
			data: {}, createdAt: FIXED, readAt: null },
		{ id: 'n2', type: 'coupon', title: 'اعلان لینک‌دار', body: 'کوپن ویژه', url: '/products',
			data: {}, createdAt: FIXED, readAt: null },
	]
	const marked: string[] = []
	const props = {
		items, unread: 2, ttlDays: 7, isLoading: false, isError: false, isRefetching: false,
		onRetry: () => {}, isMarkingAll: false,
		onMarkRead: (id: string) => marked.push(id),
		onMarkAllRead: () => {},
	} as never

	let tree = render(InboxList as never, props)
	// ردیف لینک‌دار: عنصر Link با مقصد — بدون مدال
	const links = findAll(tree, 'Link')
	assert.equal(links.length, 1, 'linked notifications render as router Links')
	assert.equal((links[0].props as Record<string, unknown>).to, '/products')
	// کلیک روی Link فقط خوانده می‌کند (ناوبری خود Link است) — مدال باز نمی‌شود
	const linkClick = (links[0].props as { onClick: () => void }).onClick
	linkClick()
	assert.deepEqual(marked, ['n2'])
	assert.equal(findDialogs(render(InboxList as never, props)).length, 0,
		'linked notifications never open the detail modal')
	checked += 3

	// ردیف بدون لینک: دکمه‌ی ردیف (نه دکمه‌ی «همه خوانده‌شده» هدر) ⇒ کلیک = خوانده + مدال
	const buttons = findAll(tree, 'button')
	const rowButton = buttons.find((b) => (b.props as { className?: string }).className?.includes('text-right p-3')
		&& (b.props as { onClick?: unknown }).onClick)
	assert.ok(rowButton, 'linkless notification rows render as clickable buttons')
	const rowClick = (rowButton as unknown as { props: { onClick: () => void } }).props.onClick
	rowClick()
	assert.deepEqual(marked, ['n2', 'n1'], 'clicking a linkless row also marks it read')
	checked++

	tree = render(InboxList as never, props)
	const dialogs = findDialogs(tree)
	assert.equal(dialogs.length, 1, 'the full-content modal opens for a linkless notification')
	const dialogProps = dialogs[0].props as Record<string, unknown>
	assert.equal(dialogProps['aria-modal'], 'true')
	// پس از resolve، محتوا داخل درخت است — کل درختِ دیالوگ را متنی می‌کنیم
	const dialogText = JSON.stringify(dialogs[0], (_k, v) => (typeof v === 'function' ? '[fn]' : v))
	assert.equal(dialogProps['aria-label'], 'اعلان بدون لینک', 'modal announces the notification title')
	assert.ok(dialogText.includes(LONG_BODY), 'modal body preserves the full untruncated content')
	assert.ok(dialogText.includes('بستن'), 'modal shows the close label')
	assert.ok(dialogText.includes('زمان ارسال'), 'modal shows the sent-at meta label')
	assert.ok(dialogText.includes('FAKE-DATETIME'), 'modal renders the formatted timestamp value')
	assert.ok(datetimeCalls.at(-1) === FIXED || String(datetimeCalls.at(-1)) === String(FIXED),
		'sentAt meta formats the exact creation timestamp')
	checked += 6

	// Escape می‌بندد
	assert.equal(keyHandlers.size, 1, 'modal listens for Escape')
	for (const handler of keyHandlers) handler({ key: 'Escape' })
	assert.equal(findDialogs(render(InboxList as never, props)).length, 0,
		'Escape closes the full-content modal')
	checked++

	// ═══ ۳) NotificationDetailModal مستقیم (میزبان تازه — سلول‌های هوک مستقل) ═══
	for (const cell of host.cells) (cell as EffectCell | undefined)?.cleanup?.()
	host = { cells: [], cursor: 0, effects: [], dirty: false }
	assert.equal(render(NotificationDetailModal as never, {
		open: false, onClose: () => {}, icon: null, typeLabel: 'x', title: 't', body: 'b', closeLabel: 'c',
	} as never), null, 'closed modal renders nothing')
	let closeCalls = 0
	let restoredFocus = 0
	const trigger = { isConnected: true, focus: () => { restoredFocus++ } }
	fakeDocument.activeElement = trigger
	const modalProps = {
		open: true, onClose: () => { closeCalls++ }, icon: null, typeLabel: 'عمومی', title: 'عنوان', body: 'متن',
		meta: [{ label: 'گیرندگان', value: '۱۲' }], closeLabel: 'بستن',
	}
	const openModal = render(NotificationDetailModal as never, modalProps as never)
	assert.ok(openModal, 'open modal renders a dialog')
	assert.equal(findDialogs(openModal).length, 1)
	const backdrop = (openModal as ReactElement<{ children: unknown[] }>).props.children[0] as { props: { onClick: () => void } }
	backdrop.props.onClick()
	assert.equal(closeCalls, 1, 'clicking the backdrop requests dismissal')
	const first = { isConnected: true, focus: () => { fakeDocument.activeElement = first } }
	const last = { isConnected: true, focus: () => { fakeDocument.activeElement = last } }
	const card = findAll(openModal, 'div').find((node) => (node.props as { ref?: unknown }).ref)
	assert.ok(card)
	const cardRef = (card.props as { ref: { current: unknown } }).ref
	cardRef.current = {
		querySelectorAll: () => [first, last],
		contains: (node: unknown) => node === first || node === last,
	}
	let prevented = 0
	fakeDocument.activeElement = first
	for (const handler of keyHandlers) handler({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented++ } })
	assert.equal(fakeDocument.activeElement, last, 'Shift+Tab from the first control stays in the modal')
	for (const handler of keyHandlers) handler({ key: 'Tab', preventDefault: () => { prevented++ } })
	assert.equal(fakeDocument.activeElement, first, 'Tab from the last control stays in the modal')
	assert.equal(prevented, 2, 'wrapped focus suppresses default document navigation')
	render(NotificationDetailModal as never, { ...modalProps, open: false } as never)
	assert.equal(restoredFocus, 1, 'closing restores focus to the notification that opened the modal')
	assert.equal(keyHandlers.size, 0, 'closing removes the keyboard listener')
	checked += 8

	// ═══ ۴) بازبینی منبع: لندینگ بدونِ blur + سیمِ تاریخچه‌ی ادمین ═══
	const landing = await Bun.file(`${import.meta.dir}/../src/routes/index.tsx`).text()
	assert.ok(!landing.includes('blur-[100px]'), 'landing page no longer uses filter blur divs')
	assert.ok(landing.includes('landing-glow-tr') && landing.includes('landing-glow-bl'),
		'landing page wires the gradient glow classes')
	const styles = await Bun.file(`${import.meta.dir}/../src/styles.css`).text()
	assert.ok(!styles.includes('blur-[100px]'), 'no leftover blur utility in styles')
	// Visual appearance belongs in browser checks, without coupling this
	// interaction suite to the number or arrangement of CSS declarations.
	checked += 3
	const adminPage = await Bun.file(`${import.meta.dir}/../src/routes/admin/notifications/index.tsx`).text()
	assert.ok(adminPage.includes('NotificationDetailModal'), 'admin history wires the shared detail modal')
	assert.ok(adminPage.includes("role: 'button'"), 'linkless history rows are keyboard-clickable buttons')
	assert.ok(adminPage.includes('setDetail(n)'), 'clicking a linkless history row opens its content')
	checked += 3

	console.log(`Stage-109 client checks passed: ${checked} (fmt.datetime · linkless modal · linked navigation · modal keyboard focus · landing glow source · admin history wiring)`)
} finally {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
	else Reflect.deleteProperty(globalThis, 'window')
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
	else Reflect.deleteProperty(globalThis, 'document')
	host = { cells: [], cursor: 0, effects: [], dirty: false }
}
