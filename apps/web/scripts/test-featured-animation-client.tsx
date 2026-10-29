import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

const react = { ...await import('react') }
mock.module('react', () => ({ ...react, memo: (component: unknown) => component }))
const { qk } = await import('../src/utils/queryKeys')
const client = new QueryClient()
let mutation: { onSuccess: (data: undefined, next: string) => Promise<void> }
let failed = false
let retries = 0
const selections: string[] = []
mock.module('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: client.getQueryData(qk.settingsFeaturedAnimation),
		isError: failed,
		refetch: async () => { retries++ },
	}),
	useQueryClient: () => client,
	useMutation: (options: typeof mutation) => {
		mutation = options
		return { isPending: false, mutate: (next: string) => selections.push(next) }
	},
}))
mock.module('#/utils/queryOptions', () => ({
	settingsFeaturedAnimationOptions: { queryKey: qk.settingsFeaturedAnimation },
}))
mock.module('#/server/admin', () => ({ setFeaturedAnimation: async () => {} }))
mock.module('#/stores/toastStore', () => ({
	useToastStore: (select: (value: { showToast: () => void }) => unknown) => select({ showToast() {} }),
}))
const { FeaturedAnimationCard } = await import('../src/components/admin/settings/FeaturedAnimationCard')
type Element = { type: unknown; props: Record<string, any> }
function nodes(value: any): Element[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('props' in value)) return []
	return [value, ...nodes(value.props.children)]
}

client.setQueryData(qk.settingsFeaturedAnimation, 'sonar')
client.setQueryData(qk.featuredAnimation, 'sonar')
let finishOldFetch!: (animation: string) => void
const oldFetch = client.fetchQuery({
	queryKey: qk.featuredAnimation,
	queryFn: () => new Promise<string>((resolve) => { finishOldFetch = resolve }),
	staleTime: 0,
}).catch(() => undefined)
FeaturedAnimationCard({ visible: true })
await mutation!.onSuccess(undefined, 'sparks')
assert.equal(client.getQueryData(qk.settingsFeaturedAnimation), 'sparks')
assert.equal(client.getQueryData(qk.featuredAnimation), 'sparks',
	'the acknowledged setting replaces the public cache without rereading stale HTTP data')
assert.equal(client.getQueryState(qk.featuredAnimation)?.isInvalidated, false)
finishOldFetch('sonar')
await oldFetch
await Promise.resolve()
assert.equal(client.getQueryData(qk.featuredAnimation), 'sparks',
	'an older in-flight response cannot overwrite a saved setting')

client.removeQueries({ queryKey: qk.settingsFeaturedAnimation })
failed = true
const errorTree = FeaturedAnimationCard({ visible: true })
assert(nodes(errorTree).some(node => node.props.role === 'alert'))
const retry = nodes(errorTree).find(node => node.type === 'button')
assert(retry)
retry.props.onClick()
assert.equal(retries, 1, 'failed loading offers a working retry control')
for (const input of nodes(errorTree).filter(node => node.type === 'input')) {
	assert.equal(input.props.disabled, true)
	input.props.onChange()
}
assert.deepEqual(selections, [], 'failed loading cannot silently overwrite the saved setting')
assert.equal(FeaturedAnimationCard({ visible: false }), null)
client.clear()
console.log('PASS featured animation settings: immediate cache updates, stale-response cancellation and load-error recovery')
