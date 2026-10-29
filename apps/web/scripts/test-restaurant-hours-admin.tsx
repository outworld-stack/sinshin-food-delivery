import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { RestaurantHoursDto } from '@sinshin/shared'
import { QueryClient } from '@tanstack/react-query'

// Exercise the actual form event handlers with persistent React state and a
// real query cache; replace only the network and hook host boundaries.
const react = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number }
const freshHost = (): Host => ({ cells: [], cursor: 0 })
let host = freshHost()
mock.module('react', () => ({
	...react,
	memo: (component: unknown) => component,
	useState<T>(initial: T | (() => T)) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
		return [active.cells[index], (value: T | ((previous: T) => T)) => {
			active.cells[index] = typeof value === 'function' ? (value as (previous: T) => T)(active.cells[index] as T) : value
		}]
	},
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
}))
const { qk } = await import('../src/utils/queryKeys')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
let loadFailed = false
let retries = 0
let pending = false
type Mutation = {
	mutationFn: (next: RestaurantHoursDto) => Promise<RestaurantHoursDto>
	onSuccess: (saved: RestaurantHoursDto) => Promise<void>
}
mock.module('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: client.getQueryData(qk.restaurantHours),
		isError: loadFailed,
		isFetching: false,
		refetch: async () => { retries++ },
	}),
	useQueryClient: () => client,
	useMutation: (options: Mutation) => ({
		isPending: pending,
		async mutateAsync(next: RestaurantHoursDto) {
			pending = true
			try {
				const saved = await options.mutationFn(next)
				await options.onSuccess(saved)
				return saved
			} finally {
				pending = false
			}
		},
	}),
}))
mock.module('#/utils/queryOptions', () => ({
	restaurantHoursOptions: { queryKey: qk.restaurantHours },
	settingsBusyOptions: { queryKey: qk.settingsBusy },
}))
const saves: RestaurantHoursDto[] = []
let saveWork = async (value: RestaurantHoursDto) => value
mock.module('#/server/admin', () => ({
	setRestaurantHours: async ({ data }: { data: RestaurantHoursDto }) => {
		saves.push(data)
		return saveWork(data)
	},
	setRestaurantBusy: async () => {},
}))
const toasts: { message: string; kind?: string }[] = []
mock.module('#/stores/toastStore', () => ({
	useToastStore: (select: (state: unknown) => unknown) => select({
		showToast(message: string, kind?: string) { toasts.push({ message, kind }) },
	}),
}))
mock.module('#/components/admin/settings/TemporaryCloseCard', () => ({ TemporaryCloseCard: () => null }))
const { RestaurantHoursForm } = await import('../src/components/admin/settings/RestaurantHoursForm')
const { RestaurantStatusCard } = await import('../src/components/admin/settings/RestaurantStatusCard')
type Element = { type: unknown; props: Record<string, any> }
function nodes(value: unknown): Element[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('props' in value)) return []
	const element = value as Element
	return [element, ...nodes(element.props.children)]
}
function find(value: unknown, predicate: (element: Element) => boolean) {
	const result = nodes(value).find(predicate)
	assert(result, 'Expected form control is present')
	return result
}
const active = freshHost()
let tree: unknown
function renderForm() {
	host = active
	host.cursor = 0
	tree = RestaurantHoursForm({})
	return tree
}
const field = (name: string) => find(tree, (node) => node.props.name === name)
const button = () => find(tree, (node) => node.props.type === 'submit')
const submit = () => find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} }) as Promise<void>
function change(name: string, value: string) {
	field(name).props.onChange({ target: { value } })
	renderForm()
}

renderForm()
assert.equal(find(tree, (node) => node.type === 'fieldset').props.disabled, true)
change('openingTime', '09:00')
await submit()
assert.equal(saves.length, 0, 'loading cannot overwrite stored hours with placeholders')
loadFailed = true
renderForm()
assert(nodes(tree).some((node) => node.props.role === 'alert'))
find(tree, (node) => node.type === 'button' && node.props.type === 'button').props.onClick()
assert.equal(retries, 1, 'a failed initial load offers a working retry')

loadFailed = false
const initial = { openingTime: '11:00', closingTime: '00:00' }
client.setQueryData(qk.restaurantHours, initial)
renderForm()
assert.equal(field('openingTime').props.value, '11:00')
assert.equal(field('closingTime').props.value, '00:00')
assert.equal(button().props.disabled, true, 'unchanged hours cannot submit')
for (const name of ['openingTime', 'closingTime']) {
	assert.equal(field(name).props.type, 'time')
	assert.equal(field(name).props.dir, 'ltr')
}

change('openingTime', '10:30')
client.setQueryData(qk.restaurantHours, { openingTime: '12:00', closingTime: '23:30' })
renderForm()
assert.equal(field('openingTime').props.value, '10:30', 'a background refresh preserves the edited opening hour')
assert.equal(field('closingTime').props.value, '00:00', 'a background refresh preserves the full draft')
saveWork = async () => { throw new Error('Connection lost') }
await submit()
renderForm()
assert.equal(field('openingTime').props.value, '10:30', 'failed saving retains the draft')
assert.equal(button().props.disabled, false, 'failed saving remains retryable')
assert.equal(find(tree, (node) => node.props.role === 'alert').props.children, 'Connection lost')
assert.equal(toasts.at(-1)?.kind, 'error')

let finishSave!: (value: RestaurantHoursDto) => void
saveWork = () => new Promise((resolve) => { finishSave = resolve })
const firstSubmit = submit()
await submit()
assert.equal(saves.length, 2, 'duplicate submissions are blocked before rerender')
renderForm()
assert.equal(find(tree, (node) => node.type === 'fieldset').props.disabled, true)
assert.equal(button().props.disabled, true)
change('closingTime', '03:00')
assert.equal(field('closingTime').props.value, '00:00', 'pending saving locks input handlers too')

let finishOldFetch!: (hours: RestaurantHoursDto) => void
const oldFetch = client.fetchQuery({
	queryKey: qk.restaurantHours,
	queryFn: () => new Promise<RestaurantHoursDto>((resolve) => { finishOldFetch = resolve }),
	staleTime: 0,
}).catch(() => undefined)
const saved = { openingTime: '10:30', closingTime: '00:00' }
finishSave(saved)
await firstSubmit
renderForm()
assert.deepEqual(client.getQueryData(qk.restaurantHours), saved, 'acknowledged hours immediately update the footer query')
assert.equal(button().props.disabled, true, 'successful saving marks the draft clean')
finishOldFetch(initial)
await oldFetch
await Promise.resolve()
assert.deepEqual(client.getQueryData(qk.restaurantHours), saved, 'older in-flight data cannot revert the saved hours')

saveWork = async (value) => value
const beforeInvalid = saves.length
for (const invalidTime of ['24:00', '10:60', '9:00', '11:00:00', '']) {
	change('openingTime', invalidTime)
	await submit()
	assert.equal(saves.length, beforeInvalid, `invalid time ${invalidTime} cannot save`)
}
change('openingTime', '00:00')
await submit()
assert.equal(saves.length, beforeInvalid, 'equal opening and closing times cannot save')
change('openingTime', '18:00')
change('closingTime', '02:15')
await submit()
renderForm()
assert.deepEqual(saves.at(-1), { openingTime: '18:00', closingTime: '02:15' }, 'overnight hours save successfully')
assert.equal(button().props.disabled, true)

const cardProps = {
	isMainAdmin: false,
	canAnnounceBusy: true,
	canToggleTemporaryClose: true,
	hourlyOpen: true,
	busy: false,
	temporarilyClosed: false,
	onToggleHourly() {},
	nextOpenTime: '11:00',
	onNextOpenTimeChange() {},
}
assert.equal(nodes(RestaurantStatusCard(cardProps)).some((node) => node.type === RestaurantHoursForm), false,
	'level-2 admins cannot mount the hours form even with temporary-close and busy permissions')
assert.equal(nodes(RestaurantStatusCard({ ...cardProps, isMainAdmin: true })).some((node) => node.type === RestaurantHoursForm), true,
	'main admins can edit regular hours')
client.clear()
console.log('PASS restaurant hours admin: permissions, loading/retry, draft retention, validation, overnight save and cache races')
