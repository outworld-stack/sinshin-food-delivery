import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { AppConfig } from '../src/infra/config/env'
import { DockerLogsService, demuxDockerStream } from '../src/infra/logs/docker-logs.service'

const fixture = await mkdtemp(join(tmpdir(), 'sinshin-report-logs-'))
const uploads = join(fixture, 'uploads')
await mkdir(uploads)
const settings = {
  NODE_ENV: 'development', DATABASE_URL: 'postgres://unused:unused@localhost/unused',
  JWT_SECRET: 'docker-log-test-secret-'.repeat(3), SITE_URL: 'https://sinshin.example',
  UPLOAD_DIR: uploads, DOCKER_LOGS_ENABLED: 'true', REPORT_LOGS_MAX_MB: '1',
}
let text = '2026-10-29T00:00:00Z پیام فارسی داکر\nsecond synthetic line\n'
let failed = false
let responseBytes: Buffer | undefined
const calls: string[] = []
function frame(value: string | Uint8Array, stream = 1) {
  const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  const header = Buffer.alloc(8)
  header[0] = stream
  header.writeUInt32BE(data.length, 4)
  return Buffer.concat([header, data])
}
const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  assert.equal(url.origin, 'http://docker.local')
  assert(!init?.method || init.method === 'GET', 'capture does not create or start truncate containers')
  calls.push(url.pathname)
  if (url.pathname === '/containers/json') return Response.json([{ Id: 'fixture-container', Names: ['/api-fixture'], Image: 'fixture-image' }])
  if (url.pathname === '/containers/fixture-container/logs') {
    assert(url.searchParams.get('since'))
    return failed ? new Response('Unavailable', { status: 503 }) : new Response(responseBytes ?? frame(text))
  }
  throw new Error(`Unexpected test transport request: ${url.pathname}`)
}) as typeof Bun.fetch

try {
  const persian = Buffer.from('پیام فارسی داکر\n', 'utf8')
  assert.equal(demuxDockerStream(Buffer.concat([
    frame(persian.subarray(0, 1)), frame(''), frame(persian.subarray(1)),
  ])), persian.toString('utf8'), 'a Persian character can span frames and an empty frame')
  assert.equal(demuxDockerStream(Buffer.concat([
    frame(persian.subarray(0, 1)), frame('stderr\n', 2), frame(persian.subarray(1)),
  ])), 'stderr\n' + persian.toString('utf8'), 'interleaved stdout/stderr retain separate UTF-8 state')
  assert.equal(demuxDockerStream(persian), persian.toString('utf8'), 'TTY plain text remains supported')
  assert.throws(() => demuxDockerStream(frame('incomplete').subarray(0, 5)), /Truncated.*header/)
  assert.throws(() => demuxDockerStream(Buffer.concat([frame('prefix'), Buffer.from([1, 0, 0])])), /Truncated.*header/)
  assert.throws(() => demuxDockerStream(Buffer.concat([frame('prefix'), frame('tail').subarray(0, -1)])), /Truncated.*payload/)
  const malformedHeader = frame('tail')
  malformedHeader[1] = 1
  assert.throws(() => demuxDockerStream(Buffer.concat([frame('prefix'), malformedHeader])), /Invalid.*header/)

  const logs = new DockerLogsService(new AppConfig(settings), fetcher)
  const captured = await logs.collectAndArchive()
  assert(captured.collected && captured.archivePath)
  assert.equal(captured.containers, 1)
  assert.equal(captured.skipped.length, 0)
  assert.equal(captured.bytes, Buffer.byteLength(text, 'utf8'))
  assert.match(logs.readArchive(captured.archivePath)!, /پیام فارسی داکر/)
  assert.equal(logs.readMarker(), null, 'capturing alone cannot advance the successful-report marker')
  logs.completeCollection(captured)
  assert.equal(logs.readMarker()!.toISOString(), captured.until.toISOString())
  const another = await logs.collectAndArchive()
  assert.notEqual(another.archivePath, captured.archivePath, 'a retry never overwrites its previous source archive')
  console.log('PASS Docker binary log frames are archived as UTF-8; markers advance only after explicit report completion')

  responseBytes = Buffer.concat([frame('valid prefix'), frame('missing tail').subarray(0, -1)])
  const damaged = await logs.collectAndArchive()
  assert(damaged.skipped.includes('api-fixture'), 'a truncated trailing frame must not count as a complete container capture')
  assert.equal(damaged.containers, 0)
  logs.completeCollection(damaged)
  assert.equal(logs.readMarker()!.toISOString(), captured.until.toISOString(), 'damaged log responses cannot advance the marker')
  responseBytes = undefined
  console.log('PASS split/interleaved Persian UTF-8 survives framing; malformed or truncated responses preserve the marker')

  const blockedUploads = join(fixture, 'blocked-uploads')
  await mkdir(blockedUploads)
  await writeFile(join(blockedUploads, '.reports'), 'Deliberately prevents creating an archive directory')
  const blocked = new DockerLogsService(new AppConfig({ ...settings, UPLOAD_DIR: blockedUploads }), fetcher)
  const rejected = await blocked.collectAndArchive()
  assert.equal(rejected.collected, false)
  assert.equal(rejected.archivePath, null)
  assert(rejected.skipped.includes('archive-write-failed'))
  blocked.completeCollection(rejected)
  assert.equal(blocked.readMarker(), null)
  console.log('PASS archive write failures cannot report successful capture or discard the source-log period')

  const partialUploads = join(fixture, 'partial-uploads')
  const partial = new DockerLogsService(new AppConfig({ ...settings, UPLOAD_DIR: partialUploads }), fetcher)
  text = 'خط بزرگ فارسی\n'.repeat(200_000)
  const capped = await partial.collectAndArchive()
  assert(capped.collected && capped.archivePath)
  assert(capped.skipped.some((note) => note.includes('سقف حجم')))
  partial.completeCollection(capped)
  assert.equal(partial.readMarker(), null)
  failed = true
  const unavailable = await partial.collectAndArchive()
  assert(unavailable.skipped.includes('api-fixture'))
  partial.completeCollection(unavailable)
  assert.equal(partial.readMarker(), null)
  assert(calls.every((path) => path === '/containers/json' || path.endsWith('/logs')))
  console.log('PASS truncated and failed container captures preserve their marker and never mutate live logs')
} finally {
  const absoluteFixture = resolve(fixture)
  assert(absoluteFixture.startsWith(resolve(tmpdir()) + sep), 'remove only this generated temp fixture')
  await rm(absoluteFixture, { recursive: true, force: true })
}
