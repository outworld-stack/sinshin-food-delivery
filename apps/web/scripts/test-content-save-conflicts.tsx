import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ContentTranslationBinding } from '../src/hooks/admin/useContentTranslationDraft'
import type { GalleryImage } from '../src/types/site/gallery'

const react = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number; mounted: boolean; cleanups: (() => void)[] }
const fresh = (): Host => ({ cells: [], cursor: 0, mounted: true, cleanups: [] })
let host = fresh(), lateWrites = 0
mock.module('react', () => ({ ...react, memo: (component: unknown) => component,
	useState<T>(initial: T | (() => T)) { const active = host, index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
		return [active.cells[index], (value: T | ((previous: T) => T)) => {
			if (!active.mounted) lateWrites++
			active.cells[index] = typeof value === 'function' ? (value as (previous: T) => T)(active.cells[index] as T) : value
		}] },
	useRef<T>(initial: T) { const index = host.cursor++; if (!(index in host.cells)) host.cells[index] = { current: initial }; return host.cells[index] },
	useCallback: (callback: unknown) => callback,
	useEffect(effect: () => undefined | (() => void), deps: unknown[]) { const index = host.cursor++, before = host.cells[index] as unknown[] | undefined
		if (!before || deps.some((value, at) => value !== before[at])) { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup) }
		host.cells[index] = deps },
}))
const rows = new Map<string, unknown>(), requests: { path: string; body?: Record<string, unknown> }[] = []
const tasks: Promise<unknown>[] = []
let requestWork: () => Promise<unknown> = async () => ({ success: true })
mock.module('#/lib/api-fetch', () => ({ authJson: async (path: string, _method: string, body?: Record<string, unknown>) => {
	requests.push({ path, body }); return requestWork()
}, getJson: async () => null, postJson: async () => null }))
mock.module('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: unknown[] }) => ({ data: rows.get(JSON.stringify(options.queryKey)), isLoading: false }),
	useQueryClient: () => ({ invalidateQueries: async () => {} }),
	useMutation: (options: { mutationFn: (value: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => unknown; onError?: (error: Error) => unknown }) => {
		const index = host.cursor++; if (!(index in host.cells)) host.cells[index] = { pending: false }
		const state = host.cells[index] as { pending: boolean }
		const mutateAsync = async (value: unknown) => { state.pending = true
			try { const result = await options.mutationFn(value); await options.onSuccess?.(result); return result }
			catch (error) { options.onError?.(error as Error); throw error }
			finally { state.pending = false }
		}
		return { isPending: state.pending, mutateAsync, mutate: (value: unknown) => { tasks.push(mutateAsync(value).catch(() => {})) } }
	},
}))
mock.module('#/utils/queryOptions', () => ({ adminMainCategoriesOptions: { queryKey: ['mains'] },
	adminAboutContentOptions: { queryKey: ['about'] }, adminGalleryImagesOptions: { queryKey: ['gallery'] } }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (state: unknown) => unknown) => select({ showToast: () => {} }) }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null, arBadgeOf: () => 'manual' }))
mock.module('#/components/Can', () => ({ Can: () => null }))
mock.module('#/components/shared/Toggle', () => ({ Toggle: () => null }))
mock.module('#/components/FileUploader', () => ({ FileUploader: () => null }))
mock.module('#/components/ConfirmModal', () => ({ ConfirmModal: () => null }))
mock.module('#/server/translation', () => ({ translatePreview: async () => assert.fail('Save must not request translation'),
	translateContentField: async () => assert.fail('Save must not request translation') }))

const { MainCategoryManager } = await import('../src/components/admin/products/MainCategoryManager')
const { GalleryImageRow } = await import('../src/components/admin/settings/GalleryImageRow')
const { ArField } = await import('../src/components/admin/ArField')
const { useSiteContentSettings } = await import('../src/hooks/admin/useSiteContentSettings')
type Node = { type: unknown; props: Record<string, unknown> }
function nodes(value: unknown): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('type' in value) || !('props' in value)) return []
	const node = value as Node; return [node, ...nodes(node.props.children)]
}
function find(tree: unknown, test: (node: Node) => boolean) { const found = nodes(tree).find(test); assert(found, `Expected control: ${test}`); return found }
function render(active: Host, component: unknown, props: unknown = {}) { host = active; active.cursor = 0; return (component as (props: unknown) => unknown)(props) }
function click(node: Node) { return (node.props.onClick as () => Promise<unknown> | undefined)() }
function change(node: Node, value: string) { (node.props.onChange as (event: unknown) => void)({ target: { value } }) }
function manual(node: Node, value: string) { (node.props.translation as ContentTranslationBinding).edit(value); (node.props.onChange as (value: string) => void)(value) }
function submit(tree: unknown) { return (find(tree, node => node.type === 'form').props.onSubmit as (event: unknown) => Promise<unknown> | undefined)({ preventDefault() {} }) }
function unmount(active: Host) { active.mounted = false; for (const cleanup of active.cleanups) cleanup() }
const conflict = Object.assign(new Error('نسخه ذخیره‌شده تغییر کرده است؛ پیش‌نویس شما حفظ شده است'), { status: 409 })

const main = { id: 'main', name: 'نام اصلی', nameAr: 'اسم سابق', slug: 'main', sortOrder: 0, sourceRevision: 'pinned-main-source' }
rows.set(JSON.stringify(['mains']), [main])
const mainHost = fresh(), drawManager = () => render(mainHost, MainCategoryManager, { canWrite: true })
click(find(drawManager(), node => node.props.children === 'ویرایش نام'))
const mainModal = find(drawManager(), node => (node.props.initialMain as { id?: string } | undefined)?.id === main.id)
const modalHost = fresh(), drawMain = () => render(modalHost, mainModal.type, mainModal.props)
let mainTree = drawMain()
change(find(mainTree, node => node.type === 'input' && node.props.value === main.name), 'نام تازه')
mainTree = drawMain(); manual(find(mainTree, node => node.type === ArField), 'اسم يدوي')
requestWork = async () => { throw conflict }
submit(drawMain()); await Promise.all(tasks.splice(0)); mainTree = drawMain()
assert.equal(find(mainTree, node => node.type === 'input' && node.props.value === 'نام تازه').props.value, 'نام تازه')
assert.equal(find(mainTree, node => node.type === ArField).props.value, 'اسم يدوي')
assert(nodes(mainTree).some(node => node.props.children === conflict.message), 'main form displays the server conflict')
assert.equal(requests.at(-1)?.body?.sourceRevision, main.sourceRevision)
assert(nodes(drawManager()).some(node => (node.props.initialMain as { id?: string } | undefined)?.id === main.id), 'failed main save leaves the dialog open')

const image = { id: 'image', alt: 'عکس اصلی', altAr: 'صورة سابقة', src: '/old.webp', span: 'normal', sortOrder: 0, isActive: true,
	sourceRevision: 'pinned-image-source' } as GalleryImage
rows.set(JSON.stringify(['gallery']), [image])
const settingsHost = fresh(), settings = render(settingsHost, () => useSiteContentSettings({ enabled: true })) as ReturnType<typeof useSiteContentSettings>
const imageHost = fresh()
const imageProps = { image, canMoveUp: false, canMoveDown: false, isBusy: false, onToggleActive: () => {}, onMove: () => {}, onRequestDelete: () => {},
	onSave: (id: string, fields: Record<string, unknown>) => settings.patchImage({ id, ...fields }) }
const drawImage = () => render(imageHost, GalleryImageRow, imageProps)
click(find(drawImage(), node => node.props.children === 'ویرایش'))
let imageTree = drawImage(); change(find(imageTree, node => node.type === 'input'), 'عکس تازه')
imageTree = drawImage(); manual(find(imageTree, node => node.type === ArField), 'صورة يدوية')
let rejectImage: ((error: Error) => void) | undefined
requestWork = () => new Promise((_resolve, reject) => { rejectImage = reject })
imageTree = drawImage(); const imageSave = click(find(imageTree, node => node.props.children === 'تایید'))
await click(find(imageTree, node => node.props.children === 'تایید'))
assert.equal(requests.filter(request => request.path === '/admin/gallery/image').length, 1, 'duplicate saves are rejected before rerender')
assert(nodes(drawImage()).some(node => node.type === 'input'), 'editor remains visible while save is pending')
assert.equal(find(drawImage(), node => node.props.children === 'تایید').props.disabled, true)
assert(rejectImage); rejectImage(conflict); await imageSave
imageTree = drawImage()
assert.equal(find(imageTree, node => node.type === 'input').props.value, 'عکس تازه')
assert.equal(find(imageTree, node => node.type === ArField).props.value, 'صورة يدوية')
assert.equal(find(imageTree, node => node.props.role === 'alert').props.children, conflict.message)
assert.equal(requests.at(-1)?.body?.sourceRevision, image.sourceRevision)
requestWork = async () => ({ success: true })
await click(find(imageTree, node => node.props.children === 'تایید'))
assert.equal(nodes(drawImage()).some(node => node.type === 'input'), false, 'editor closes only after a successful awaited save')

const unmountedHost = fresh(), drawUnmounted = () => render(unmountedHost, GalleryImageRow, imageProps)
click(find(drawUnmounted(), node => node.props.children === 'ویرایش'))
let resolveUnmounted: ((value: unknown) => void) | undefined
requestWork = () => new Promise(resolve => { resolveUnmounted = resolve })
const unmountedSave = click(find(drawUnmounted(), node => node.props.children === 'تایید'))
unmount(unmountedHost); assert(resolveUnmounted); resolveUnmounted({ success: true }); await unmountedSave
assert.equal(lateWrites, 0, 'settled gallery saves cannot update an unmounted editor')
console.log('PASS content save conflicts: main category errors and pinned drafts, awaited gallery mutation plumbing, failed update retention, duplicate saves, success-only closing and unmount protection')
