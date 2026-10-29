import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
const effects: Array<() => (() => void) | void> = []
mock.module('react', () => ({
	...react,
	useRef: (current: unknown) => ({ current }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => (() => void) | void) => effects.push(effect),
}))

const keys = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'MutationObserver']
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let themeReads = 0
let strokes = 0
let clears = 0
let transform: number[] = []
let mutations: () => void = () => {}
const motion = Object.assign(new EventTarget(), { matches: false })
const documentMock = Object.assign(new EventTarget(), {
	hidden: false,
	documentElement: { classList: { contains: () => { themeReads++; return false } } },
})
const browser = Object.assign(new EventTarget(), {
	devicePixelRatio: 2,
	matchMedia: () => motion,
})
const context = {
	setTransform: (...values: number[]) => { transform = values },
	clearRect: () => { clears++ }, fillRect() {},
	beginPath() {}, moveTo() {}, lineTo() {}, stroke: () => { strokes++ },
}
const canvas = {
	width: 300, height: 150,
	parentElement: { getBoundingClientRect: () => ({ width: 300, height: 200 }) },
	getContext: () => context,
}
const install = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, value })
install('window', browser)
install('document', documentMock)
install('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
install('cancelAnimationFrame', (id: number) => frames.delete(id))
install('ResizeObserver', class { observe() {} disconnect() {} })
install('MutationObserver', class { constructor(callback: () => void) { mutations = callback } observe() {} disconnect() {} })

const cleanups: Array<() => void> = []
const frame = (time: number) => {
	const callbacks = [...frames.values()]
	frames.clear()
	for (const callback of callbacks) callback(time)
}
try {
	const { DualSparks } = await import('../src/components/site/product-detail/DualSparksBackground')
	const tree = DualSparks({}) as any
	tree.props.children[0].props.ref.current = canvas
	for (const effect of effects) {
		const cleanup = effect()
		if (cleanup) cleanups.push(cleanup)
	}
	assert.deepEqual([canvas.width, canvas.height], [600, 400], 'canvas uses a bounded retina backing resolution')
	assert.deepEqual(transform, [2, 0, 0, 2, 0, 0], 'particle coordinates stay in CSS pixels')
	assert.equal(frames.size, 1)
	frame(3000)
	strokes = 0; themeReads = 0
	frame(4000)
	assert(strokes > 0 && strokes < 200, 'visible sparks render while off-canvas shadow strokes are culled')
	assert(themeReads <= 3, 'theme checks are bounded per frame instead of repeated for every spark')
	assert.equal(frames.size, 1, 'only one animation loop remains active')

	documentMock.hidden = true
	documentMock.dispatchEvent(new Event('visibilitychange'))
	assert.equal(frames.size, 0, 'hidden tabs stop the animation immediately')
	documentMock.hidden = false
	documentMock.dispatchEvent(new Event('visibilitychange'))
	assert.equal(frames.size, 1, 'visible tabs restart one loop')
	motion.matches = true
	motion.dispatchEvent(new Event('change'))
	assert.equal(frames.size, 0, 'changing reduced motion stops animation')
	const previousClears = clears
	mutations()
	assert(clears > previousClears, 'theme changes repaint the still background without restarting animation')
	assert.equal(frames.size, 0)
	motion.matches = false
	motion.dispatchEvent(new Event('change'))
	assert.equal(frames.size, 1, 'turning motion back on resumes one loop')
	for (const cleanup of cleanups.splice(0)) cleanup()
	assert.equal(frames.size, 0, 'unmount removes scheduled animation work')
	documentMock.dispatchEvent(new Event('visibilitychange'))
	motion.dispatchEvent(new Event('change'))
	assert.equal(frames.size, 0, 'unmount also removes event listeners')
	console.log('Featured background regressions passed: off-screen culling, retina scaling, theme work, reduced motion and cleanup.')
} finally {
	for (const cleanup of cleanups) cleanup()
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
	mock.restore()
}
