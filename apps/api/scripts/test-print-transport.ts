import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import { spyOn } from 'bun:test'
import { buildRasterJob, RASTER_FRAGMENT_DOTS } from '../src/domain/print/escpos'
import { scanCidrAllowed } from '../src/domain/print/printNet'
import { PrinterService } from '../src/domain/print/print.service'
import { sendRaw } from '../src/domain/print/printTransport'
import * as transport from '../src/domain/print/printTransport'

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Test deadline exceeded (${ms}ms)`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function withPrinter(
  accept: (socket: net.Socket) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer({ pauseOnConnect: true }, (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    accept(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run((server.address() as net.AddressInfo).port)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// Delay the real socket write deterministically. OS send-buffer sizes and Bun's
// internal receive buffers vary too much for a paused local peer to guarantee
// backpressure; the bytes still travel through a real TCP socket after release.
const delayedPayload = Buffer.alloc(64 * 1024, 0x5a)
async function withDelayedWrite(delayMs: number | null, run: () => Promise<void>) {
  const original = net.Socket.prototype._write
  const timers: ReturnType<typeof setTimeout>[] = []
  const spy = spyOn(net.Socket.prototype, '_write').mockImplementation(function (
    this: net.Socket,
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (chunk.length === delayedPayload.length && chunk[0] === 0x5a) {
      if (delayMs !== null) {
        timers.push(setTimeout(() => original.call(this, chunk, encoding, callback), delayMs))
      }
      return
    }
    original.call(this, chunk, encoding, callback)
  })
  try {
    await run()
  } finally {
    spy.mockRestore()
    for (const timer of timers) clearTimeout(timer)
  }
}

{
  const payload = delayedPayload
  const chunks: Buffer[] = []
  let completed!: (data: Buffer) => void
  const received = new Promise<Buffer>((resolve) => { completed = resolve })
  await withDelayedWrite(350, () => withPrinter((socket) => {
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.resume()
    socket.once('end', () => completed(Buffer.concat(chunks)))
  }, async (port) => {
    const result = await withDeadline(sendRaw('127.0.0.1', port, payload, {
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 5_000,
      collectReplyMs: 20,
    }), 7_000)
    assert.equal(result.online, true)
    assert.deepEqual(await withDeadline(received, 2_000), payload)
  }))
  console.log('PASS slow TCP receiver gets the entire payload before successful completion')
}

{
  await withDelayedWrite(null, () => withPrinter((socket) => socket.pause(), async (port) => {
    const result = await withDeadline(sendRaw('127.0.0.1', port, delayedPayload, {
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 150,
      collectReplyMs: 20,
    }), 2_000)
    assert.deepEqual(result, { online: false, reason: 'write-timeout' })
  }))
  console.log('PASS stalled TCP writes return failure instead of success at the reply timeout')
}

{
  await withPrinter((socket) => {
    socket.on('data', () => {})
    socket.resume()
    const timer = setInterval(() => socket.write(Buffer.alloc(128, 0x12)), 5)
    socket.once('close', () => clearInterval(timer))
  }, async (port) => {
    const result = await withDeadline(sendRaw('127.0.0.1', port, Buffer.from([0x10, 0x04, 0x01]), {
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      collectReplyMs: 80,
    }), 500)
    assert.equal(result.online, true)
    if (result.online) {
      assert.ok(result.reply && result.reply.length > 0)
      assert.ok(result.reply.length <= 256)
    }
  })
  console.log('PASS unsolicited status data has bounded duration and memory')
}

{
  await withDelayedWrite(350, () => withPrinter((socket) => socket.destroy(), async (port) => {
    const result = await withDeadline(sendRaw('127.0.0.1', port, delayedPayload, {
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      collectReplyMs: 20,
    }), 2_000)
    assert.equal(result.online, false)
  }))
  console.log('PASS disconnect during a pending write is reported as failure')
}

// Decode only raster commands and compare pixel rows; an LF between fragments
// is real paper movement and would put a blank band through the receipt.
for (const width of [384, 420, 576]) {
  const height = 2 * RASTER_FRAGMENT_DOTS + 17
  const rows = Buffer.alloc(Math.ceil(width / 8) * height)
  for (let i = 0; i < rows.length; i++) rows[i] = i % 251
  const job = Buffer.from(buildRasterJob(width, height, rows, { autoCut: true }))
  const decoded: Buffer[] = []
  let offset = 2
  let decodedHeight = 0
  while (decodedHeight < height) {
    assert.deepEqual(job.subarray(offset, offset + 4), Buffer.from([0x1d, 0x76, 0x30, 0]))
    const rowBytes = job.readUInt16LE(offset + 4)
    const fragmentHeight = job.readUInt16LE(offset + 6)
    assert.equal(rowBytes, Math.ceil(width / 8))
    assert.ok(fragmentHeight > 0 && fragmentHeight <= RASTER_FRAGMENT_DOTS)
    decoded.push(job.subarray(offset + 8, offset + 8 + rowBytes * fragmentHeight))
    offset += 8 + rowBytes * fragmentHeight
    decodedHeight += fragmentHeight
  }
  assert.equal(decodedHeight, height)
  assert.deepEqual(Buffer.concat(decoded), rows)
  assert.deepEqual(job.subarray(offset), Buffer.from([0x0a, 0x1b, 0x64, 2, 0x1d, 0x56, 0x42, 0, 0x1b, 0x40]))
}
console.log('PASS multi-fragment receipts preserve continuous image rows for every paper width')

assert.equal(scanCidrAllowed('10.0.0.0/7', {}), null)
assert.equal(scanCidrAllowed('192.168.0.0/15', {}), null)
assert.ok(scanCidrAllowed('10.0.0.0/8', {}))
assert.ok(scanCidrAllowed('192.168.0.0/16', {}))
console.log('PASS an allowed scan CIDR cannot include public addresses')

{
  const originalInterfaces = os.networkInterfaces
  const originalCidrs = process.env.PRINT_SCAN_CIDRS
  delete process.env.PRINT_SCAN_CIDRS
  os.networkInterfaces = () => ({
    public: [{
      address: '203.0.113.9', netmask: '255.255.255.0', family: 'IPv4',
      mac: '00:00:00:00:00:00', internal: false, cidr: '203.0.113.9/24',
    }],
  })
  try {
    // Discover uses neither DB nor settings; fail if it ever reaches those dependencies.
    const unused = new Proxy({}, { get: () => { throw new Error('Unexpected dependency access') } })
    const service = new PrinterService(unused as ConstructorParameters<typeof PrinterService>[0])
    await assert.rejects(() => service.discover({}), (e: unknown) =>
      (e as { status?: number }).status === 422)
  } finally {
    os.networkInterfaces = originalInterfaces
    if (originalCidrs === undefined) delete process.env.PRINT_SCAN_CIDRS
    else process.env.PRINT_SCAN_CIDRS = originalCidrs
  }
  console.log('PASS automatic discovery rejects public-only server interfaces')
}

{
  const originalInterfaces = os.networkInterfaces
  const originalCidrs = process.env.PRINT_SCAN_CIDRS
  delete process.env.PRINT_SCAN_CIDRS
  os.networkInterfaces = () => ({
    docker: [{
      address: '10.42.3.8', netmask: '255.255.0.0', family: 'IPv4',
      mac: '00:00:00:00:00:00', internal: false, cidr: '10.42.3.8/16',
    }],
    public: [{
      address: '203.0.113.9', netmask: '255.255.255.0', family: 'IPv4',
      mac: '00:00:00:00:00:00', internal: false, cidr: '203.0.113.9/24',
    }],
  })
  const sender = spyOn(transport, 'sendRaw').mockResolvedValue({ online: false, reason: 'test' })
  try {
    const unused = new Proxy({}, { get: () => { throw new Error('Unexpected dependency access') } })
    const service = new PrinterService(unused as ConstructorParameters<typeof PrinterService>[0])
    const result = await service.discover({})
    assert.deepEqual(result.scanned, ['10.42.3.0/24'])
    assert.equal(sender.mock.calls.length, 254)
    assert.ok(sender.mock.calls.every(([host, port]) => host.startsWith('10.42.3.') && port === 9100))

    sender.mockClear()
    process.env.PRINT_SCAN_CIDRS = '10.0.0.0/16,10.42.3.0/29'
    await assert.rejects(() => service.discover({}), (e: unknown) =>
      (e as { status?: number }).status === 422)
    assert.equal(sender.mock.calls.length, 0)
  } finally {
    sender.mockRestore()
    os.networkInterfaces = originalInterfaces
    if (originalCidrs === undefined) delete process.env.PRINT_SCAN_CIDRS
    else process.env.PRINT_SCAN_CIDRS = originalCidrs
  }
  console.log('PASS broad private interfaces scan their local /24 and invalid configured ranges never partially scan')
}

console.log('OK print transport regressions')

{
  const originalInterfaces = os.networkInterfaces
  const originalCidrs = process.env.PRINT_SCAN_CIDRS
  delete process.env.PRINT_SCAN_CIDRS
  os.networkInterfaces = () => Object.fromEntries([1, 2, 3].map((n) => [`lan${n}`, [{
    address: `192.168.${n}.8`, netmask: '255.255.255.0', family: 'IPv4' as const,
    mac: '00:00:00:00:00:00', internal: false, cidr: `192.168.${n}.8/24`,
  }]]))
  let active = 0
  let peak = 0
  const sender = spyOn(transport, 'sendRaw').mockImplementation(async (host) => {
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    active--
    return host.endsWith('.20') || host.endsWith('.3') ? { online: true, reply: null } : { online: false, reason: 'test' }
  })
  try {
    const unused = new Proxy({}, { get: () => { throw new Error('Unexpected dependency access') } })
    const service = new PrinterService(unused as ConstructorParameters<typeof PrinterService>[0])
    const [first, second] = await Promise.all([service.discover({}), service.discover({})])
    assert.deepEqual(first, second)
    assert.equal(first.scanned.length, 3, 'automatic scans handle multiple physical/VPN interfaces')
    assert.equal(sender.mock.calls.length, 762, 'concurrent print centers share one scan')
    assert.ok(peak <= 64)
    assert.deepEqual(first.found.map((p) => p.host), ['192.168.1.3', '192.168.1.20', '192.168.2.3', '192.168.2.20', '192.168.3.3', '192.168.3.20'])
    sender.mockClear()
    peak = 0
    await Promise.all([service.discover({ cidr: '192.168.1.0/25' }), service.discover({ cidr: '192.168.2.0/25' })])
    assert.equal(sender.mock.calls.length, 252)
    assert.ok(peak <= 64, 'different simultaneous scans share the global socket limit')
    process.env.PRINT_SCAN_CIDRS = '192.168.1.0/29,192.168.2.0/29,192.168.3.0/29,192.168.4.0/29,192.168.5.0/29'
    assert.equal((await service.discover({})).scanned.length, 5, 'configured networks are never silently dropped')
  } finally {
    sender.mockRestore()
    os.networkInterfaces = originalInterfaces
    if (originalCidrs === undefined) delete process.env.PRINT_SCAN_CIDRS
    else process.env.PRINT_SCAN_CIDRS = originalCidrs
  }
  console.log('PASS multi-interface discovery, deterministic dropdown order, shared scans and global connection limit')
}

{
  const row = {
    id: 'printer-1', name: 'Test', host: '192.168.1.20', port: 9100,
    widthDots: 576, autoCut: true, lastStatus: 'online', lastStatusDetail: null,
    lastStatusAt: new Date(0), createdAt: new Date(0), updatedAt: new Date(0),
  }
  const db = {
    select: () => ({ from: () => ({
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve([row])),
      where: async () => [row],
    }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  }
  const service = new PrinterService({ db, settings: { get: async () => null } } as unknown as ConstructorParameters<typeof PrinterService>[0])
  assert.deepEqual(await service.assignment(), { sales: null, kitchen: null }, 'corrupt/null settings fall back to empty defaults')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const sender = spyOn(transport, 'sendRaw').mockImplementation(async () => {
    calls++
    await gate
    return { online: true, reply: Buffer.from([0x12, 0x12]) }
  })
  try {
    const listing = Promise.all([service.list(), service.list()])
    for (let i = 0; i < 20; i++) await Promise.resolve()
    assert.equal(calls, 1, 'concurrent lists share each device probe')
    release()
    const [first, second] = await listing
    assert.equal(first[0]?.lastStatusAt, second[0]?.lastStatusAt)
    const cached = await service.list()
    assert.equal(calls, 1)
    assert.equal(cached[0]?.lastStatusAt, first[0]?.lastStatusAt, 'cache hits report the real probe time')
  } finally { sender.mockRestore() }

  const events: string[] = []
  let active = 0
  let peak = 0
  const queueSender = spyOn(transport, 'sendRaw').mockImplementation(async (_host, _port, payload) => {
    active++
    peak = Math.max(peak, active)
    events.push(payload.length === 6 ? 'status' : 'receipt')
    await Promise.resolve()
    active--
    return { online: true, reply: Buffer.from([0x12, 0x12]) }
  })
  try {
    const receipt = { printerId: row.id, widthPx: 576, heightPx: 1, rows: Buffer.alloc(72).toString('base64') }
    await Promise.all([service.dispatch(receipt), service.dispatch(receipt), service.test(row.id)])
    assert.equal(peak, 1, 'one printer never receives simultaneous jobs/status commands')
    assert.deepEqual(events, ['status', 'receipt', 'status', 'receipt', 'status', 'receipt'])
    const failed = service.dispatch({ ...receipt, heightPx: 4001 })
    const valid = service.dispatch(receipt)
    await assert.rejects(failed)
    await valid
  } finally { queueSender.mockRestore() }
  console.log('PASS shared status probes, accurate cached times, null defaults and serialized receipt/test jobs with failure recovery')
}
