import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const originalTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const activeTimers = new Set<ReturnType<typeof setTimeout>>()
globalThis.setTimeout = ((callback: () => void, delay: number) => {
  const timer = originalTimeout(() => { activeTimers.delete(timer); callback() }, delay)
  activeTimers.add(timer)
  return timer
}) as typeof setTimeout
globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
  activeTimers.delete(timer)
  originalClearTimeout(timer)
}) as typeof clearTimeout

type Request = { uid: string; timestamp: number; certificate?: null; signature?: string; signAlgorithm?: string; call?: string; params?: any }
class AgentSocket {
  static OPEN = 1
  static sockets: AgentSocket[] = []
  static failNext = false
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  requests: Request[] = []
  throwSend = false
  constructor(readonly url: string) {
    AgentSocket.sockets.push(this)
    const fail = AgentSocket.failNext
    AgentSocket.failNext = false
    queueMicrotask(() => {
      if (fail) this.onerror?.()
      else { this.readyState = 1; this.onopen?.() }
    })
  }
  send(raw: string) {
    if (this.throwSend) throw new Error('send failed')
    if (raw !== 'ping') this.requests.push(JSON.parse(raw) as Request)
  }
  close() { this.readyState = 3 }
  respond(result: unknown, error?: string) {
    const request = this.requests.at(-1)
    assert(request)
    this.onmessage?.({ data: JSON.stringify({ uid: request.uid, result, error }) })
  }
}
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: AgentSocket })
Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
const { connectPrintAgent, disconnectPrintAgent, getPrintAgentStatus, listAgentPrinters, agentPrintHtml } = await import('../src/lib/printAgent')
assert.equal(await connectPrintAgent(), false, 'server rendering does not access window')
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const current = () => AgentSocket.sockets.at(-1)!

const first = connectPrintAgent()
assert.equal(connectPrintAgent(), first, 'concurrent modal connections share one handshake')
assert.equal(getPrintAgentStatus(), 'connecting')
await assert.rejects(listAgentPrinters(), /آماده نیست/, 'an open socket is not ready until QZ approves it')
await flush()
const oldSocket = current()
assert.equal(AgentSocket.sockets.length, 1)
assert.equal(oldSocket.requests[0]?.certificate, null, 'QZ uses its unsigned approval path')
oldSocket.respond(null)
assert.equal(await first, true)
assert.equal(getPrintAgentStatus(), 'ready')

const names = listAgentPrinters()
const printerRequest = oldSocket.requests.at(-1)!
assert.equal(printerRequest.signature, '')
assert.equal(printerRequest.signAlgorithm, 'SHA1')
assert.equal(typeof printerRequest.timestamp, 'number')
oldSocket.onmessage?.({ data: 'null' })
oldSocket.onmessage?.({ data: 'not json' })
oldSocket.respond(['Kitchen', 'Kitchen', '', null, 10, 'Sales'])
assert.deepEqual(await names, ['Kitchen', 'Sales'])
assert.equal(activeTimers.size, 0, 'answered calls clear their timers')

const print = agentPrintHtml('Kitchen', '<html>receipt</html>', { heightMm: 72.3, jobName: 'order-123' })
assert.deepEqual(oldSocket.requests.at(-1)?.params.options.size, { width: 80, height: 73 })
assert.equal(oldSocket.requests.at(-1)?.params.options.jobName, 'order-123')
oldSocket.respond(null)
await print
const fallbackSize = agentPrintHtml('Sales', '<html/>', { heightMm: Number.NaN })
assert.deepEqual(oldSocket.requests.at(-1)?.params.options.size, { width: 80, height: 297 }, 'failed measurements retain receipt paper size')
oldSocket.respond(null)
await fallbackSize
oldSocket.throwSend = true
await assert.rejects(listAgentPrinters(), /send failed/)
assert.equal(activeTimers.size, 0, 'send exceptions remove pending calls and timers immediately')
oldSocket.throwSend = false

const staleClose = oldSocket.onclose
disconnectPrintAgent()
const second = connectPrintAgent()
await flush()
const replacement = current()
replacement.respond(null)
assert.equal(await second, true)
const pendingNames = listAgentPrinters()
staleClose?.()
assert.equal(getPrintAgentStatus(), 'ready', 'late close events from replaced sockets preserve the current connection')
replacement.respond(['Sales'])
assert.deepEqual(await pendingNames, ['Sales'])
const interrupted = listAgentPrinters()
disconnectPrintAgent()
await assert.rejects(interrupted, /بسته شد/)
replacement.onclose?.()
assert.equal(getPrintAgentStatus(), 'idle', 'intentional disconnect stays idle after its close event')
assert.equal(activeTimers.size, 0)

AgentSocket.failNext = true
const retry = connectPrintAgent()
await flush()
assert.match(current().url, /^ws:/, 'an unavailable secure socket falls back to the local plain socket')
current().respond(null)
assert.equal(await retry, true)
disconnectPrintAgent()

const cancelled = connectPrintAgent()
disconnectPrintAgent()
assert.equal(await cancelled, false, 'disconnect cancels an in-flight socket opening')
assert.equal(getPrintAgentStatus(), 'idle')
assert.equal(activeTimers.size, 0)
const source = readFileSync(new URL('../src/lib/printAgent.ts', import.meta.url), 'utf8')
assert(!source.includes('BEGIN PRIVATE KEY'), 'trusted signing keys must never return to the public browser bundle')
globalThis.setTimeout = originalTimeout
globalThis.clearTimeout = originalClearTimeout
console.log('Print agent: unsigned approval protocol, readiness, concurrency, socket replacement, receipt sizes and cleanup passed.')
