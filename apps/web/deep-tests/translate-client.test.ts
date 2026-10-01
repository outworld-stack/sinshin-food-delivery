// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 14 از 14
// مسیر مقصد: apps/api/deep-tests/translate-client.test.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// تست عمیق ر۳۵ — TranslateClient: دسته‌بندی ≤۴۸، retry، timeout، اعتبارسنجی
import { describe, expect, test } from 'bun:test'
import { TranslateClient } from '#/domain/translation/translate-client'
import { AppConfig } from '#/infra/config/env'

const PORT = 8399

interface Call {
        path: string
        body: { texts: string[]; source: string; target: string }
}

function makeServer(handler: (req: Request, call: Call) => Response | Promise<Response>) {
        const calls: Call[] = []
        const server = Bun.serve({
                port: PORT,
                reusePort: true,
                async fetch(req) {
                        let body = { texts: [] as string[], source: '', target: '' }
                        if (req.method === 'POST') {
                                try {
                                        body = (await req.json()) as typeof body
                                } catch {
                                        return new Response('bad json', { status: 400 })
                                }
                        }
                        const call: Call = { path: new URL(req.url).pathname, body }
                        calls.push(call)
                        return handler(req, call)
                },
        })
        return { server, calls }
}

function client(): TranslateClient {
        const config = new AppConfig({ TRANSLATOR_URL: `http://127.0.0.1:${PORT}` })
        return new TranslateClient({ config })
}

describe('R35 — TranslateClient', () => {
        test('سلامت: ready:true → up با نام مدل', async () => {
                const { server } = makeServer((req) => {
                        if (new URL(req.url).pathname === '/health')
                                return Response.json({ ready: true, model: 'nllb-200-distilled-600M-int8' })
                        return new Response('not found', { status: 404 })
                })
                const res = await client().health()
                expect(res.up).toBe(true)
                expect(res.model).toContain('nllb')
                server.stop(true)
        })

        test('سلامت: کانکت نشدن → up:false بدون throw', async () => {
                const config = new AppConfig({ TRANSLATOR_URL: 'http://127.0.0.1:59999' })
                const c = new TranslateClient({ config })
                const res = await c.health()
                expect(res.up).toBe(false)
                expect(res.model).toBe('')
        })

        test('دسته‌بندی: ۱۰۰ متن → حداقل ۳ درخواست، هر کدام ≤۴۸، ترتیب حفظ می‌شود', async () => {
                const { server, calls } = makeServer((_req, call) =>
                        Response.json({ translations: call.body.texts.map((t) => `AR(${t})`) }),
                )
                const texts = Array.from({ length: 100 }, (_, i) => `متن ${i}`)
                const out = await client().translate(texts)
                expect(out.length).toBe(100)
                expect(out[0]).toBe('AR(متن 0)')
                expect(out[99]).toBe('AR(متن 99)')
                expect(calls.length).toBeGreaterThanOrEqual(3)
                for (const c of calls) expect(c.body.texts.length).toBeLessThanOrEqual(48)
                server.stop(true)
        })

        test('ریتُری: دو خطای ۵۰۰ بعد موفقیت → پاسخ درست', async () => {
                let n = 0
                const { server, calls } = makeServer((_req, call) => {
                        n += 1
                        if (n <= 2) return new Response('boom', { status: 500 })
                        return Response.json({ translations: call.body.texts.map((t) => `OK:${t}`) })
                })
                const out = await client().translate(['یک', 'دو'])
                expect(out).toEqual(['OK:یک', 'OK:دو'])
                expect(calls.length).toBe(3)
                server.stop(true)
        })

        test('خطای دائمی ۵۰۰ → AppError سرویس در دسترس نیست (پس از رتُری‌ها)', async () => {
                const { server, calls } = makeServer(() => new Response('down', { status: 503 }))
                await expect(client().translate(['یک'])).rejects.toThrow()
                // رتُری‌ها انجام شده: RETRIES+1 تلاش
                expect(calls.length).toBeGreaterThanOrEqual(2)
                server.stop(true)
        })

        test('خطای ۴۰۰ (ورودی بد) → بدون رتُری، فقط یک درخواست', async () => {
                const { server, calls } = makeServer(() => new Response('bad', { status: 400 }))
                await expect(client().translate(['یک'])).rejects.toThrow('معتبر')
                expect(calls.length).toBe(1)
                server.stop(true)
        })

        test('پاسخ بدشکل (طول نامساوی) → خطا', async () => {
                const { server } = makeServer(() => Response.json({ translations: ['فقط یکی'] }))
                await expect(client().translate(['یک', 'دو', 'سه'])).rejects.toThrow()
                server.stop(true)
        })

        test('آرایه‌ی خالی → بدون تماس شبکه', async () => {
                const { server, calls } = makeServer(() => Response.json({ translations: [] }))
                const out = await client().translate([])
                expect(out).toEqual([])
                expect(calls.length).toBe(0)
                server.stop(true)
        })
})
