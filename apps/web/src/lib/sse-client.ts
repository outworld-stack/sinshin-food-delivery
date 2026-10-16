// src/lib/sse-client.ts
//
// stage-74 — کلاینتِ مشترکِ SSE مبتنی بر fetch (هدر Authorization — رارد H5).
//
// چرا این فایل؟ سه مصرف‌کننده‌ی fetch-SSE (پنل ادمین۲، صندوق اعلان، بعدی‌ها)
// یک الگوی مشترک داشتند که هرکدام سه حفره‌ی «فریز/مرگِ خاموشِ PWA» را
// تکرار می‌کردند (گزارش کارفرما — «SSE متصل به نظر می‌رسد ولی دیگر داده
// نمی‌آید»):
//   ① fetch بدون سقف: headers هرگز نرسد ⇒ connect() برای همیشه معلق ⇒
//      هیچ retry ای schedule نمی‌شود.
//   ② پرچمِ «متصل» قبل از اولین فریم معتبر روشن می‌شد (فقط با رسیدنِ
//      headers) — استریمِ خاموشِ بعدی، پول را به ریتمِ ایمنیِ کند می‌برد.
//   ③ بدون watchdog سکوت: سرور هر ۱۵s ضربان (`: ping`) می‌فرستد؛ اگر
//      استریم بی‌صدا بمیرد (شبکه‌ی موبایل/PWA از پس‌زمینه)، reader.read()
//      برای همیشه معلق می‌ماند و هیچ‌کس متوجه نمی‌شود.
//
// این کلاینت هر سه را می‌بندد:
//   • connectTimeoutMs — سقفِ رسیدنِ headers (پیش‌فرض ۱۵s)
//   • silenceTimeoutMs — سکوتِ استریم بیشتر از این = مرده (پیش‌فرض ۴۵s
//     = ۳ ضربانِ ازدست‌رفته‌ی سرور) ⇒ abort + reconnect
//   • retryMs — فاصله‌ی اتصال مجدد بعد از هر شکست (پیش‌فرض ۶۰s)
//   • tokenWaitMs — توکن هنوز هیدره نشده ⇒ چکِ بعدی (پیش‌فرض ۵s)
//   • روی «برگشت از پس‌زمینه/online» اگر در پنجره‌ی retry هستیم فوراً
//     وصل می‌شویم؛ اگر استریم بازِ کهنه است (آخرین بایت > از یک ضربان
//     پیش) هم بازسازی فوری — شبکه‌ی موبایل بعد از پس‌زمینه سوکت را
//     بی‌خدا کشته است.
//   • onStreamOpen/onStreamClosed — هوکِ وضعیت؛ پرچمِ «متصل» معنایی را
//     هوک می‌دهد (مثلاً فقط با فریمِ connected سرور) — نه با headers.

export interface SseTimings {
    /** سقفِ رسیدن headers (و شروع خواندن) */
    connectTimeoutMs: number
    /** سکوت استریم بیشتر از این = مرده (heartbeat سرور = ۱۵s) */
    silenceTimeoutMs: number
    /** فاصله‌ی retry */
    retryMs: number
    /** توکن غایب — فاصله‌ی چکِ بعدی */
    tokenWaitMs: number
    /** برگشت از پس‌زمینه: آخرین بایتِ قدیمی‌تر از این = بازسازی فوری */
    wakeStaleMs: number
}

export const DEFAULT_SSE_TIMINGS: SseTimings = {
    connectTimeoutMs: 15_000,
    silenceTimeoutMs: 45_000,
    retryMs: 60_000,
    tokenWaitMs: 5_000,
    wakeStaleMs: 20_000,
}

export interface FetchSseHandle {
    /** توقف کامل + پاکسازی (unmount) */
    stop(): void
    /** استریمِ فعلی باز است و می‌خواند؟ */
    isStreaming(): boolean
}

export interface FetchSseOptions {
    /**
     * هر بار connect صدا می‌شود. null = پیش‌نیاز (توکن) هنوز آماده نیست —
     * tokenWaitMs بعد دوباره پرسیده می‌شود.
     */
    url: () => string | null
    /** هدرهای هر تلاش اتصال (تازه خوانده می‌شوند — توکنِ تازه) */
    headers?: () => Record<string, string>
    /** فریمِ کامل SSE («event: …\ndata: …»)؛ فریم‌های heartbeat (: ping) اینجا نمی‌آیند */
    onFrame?: (frame: string) => void
    /** استریم باز شد و خواندن شروع شد (headers رسیده — نه لزوماً فریمِ connected) */
    onStreamOpen?: () => void
    /** استریم بسته شد — هر دلیلی: خطا/سکوت/abort/پایان از سمت سرور */
    onStreamClosed?: () => void
    timings?: Partial<SseTimings>
    /** بازگشت از پس‌زمینه/online → اتصالِ فوری در صورت نیاز (پیش‌فرض روشن) */
    reconnectOnWake?: boolean
}

export function createFetchSse(opts: FetchSseOptions): FetchSseHandle {
    const T: SseTimings = { ...DEFAULT_SSE_TIMINGS, ...opts.timings }

    let disposed = false
    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    let streaming = false
    let lastByteAt = 0

    const clearRetry = () => {
        if (retryTimer) {
            clearTimeout(retryTimer)
            retryTimer = null
        }
    }
    const clearConnect = () => {
        if (connectTimer) {
            clearTimeout(connectTimer)
            connectTimer = null
        }
    }
    const clearSilence = () => {
        if (silenceTimer) {
            clearTimeout(silenceTimer)
            silenceTimer = null
        }
    }

    const scheduleRetry = (ms: number) => {
        if (disposed) return
        clearRetry()
        retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
        }, ms)
    }

    const failStream = () => {
        if (!streaming) return
        streaming = false
        clearSilence()
        abort?.abort()
        abort = null
        opts.onStreamClosed?.()
        // استریم از سمت سرور بسته شد / watchdog سکوت / خطا → مثل خطا: retry
        scheduleRetry(T.retryMs)
    }

    const connect = async (): Promise<void> => {
        if (disposed) return
        const url = opts.url()
        if (!url) {
            // پیش‌نیاز (توکن) هنوز نرسیده — کوتاه‌مدت دوباره می‌خواهیم
            if (!retryTimer) scheduleRetry(T.tokenWaitMs)
            return
        }

        abort = new AbortController()
        streaming = false

        // ① سقفِ اتصال: headers باید در connectTimeoutMs برسند؛ وگرنه abort
        //    (قبلاً: fetch بی‌سقف ⇒ connect برای همیشه معلق ⇒ بدون retry)
        connectTimer = setTimeout(() => {
            connectTimer = null
            abort?.abort(
                new DOMException('مهلت اتصال استریم به پایان رسید.', 'TimeoutError'),
            )
        }, T.connectTimeoutMs)

        try {
            const res = await fetch(url, {
                headers: opts.headers?.() ?? {},
                cache: 'no-store',
                signal: abort.signal,
            })
            if (disposed) {
                abort?.abort()
                abort = null
                return
            }
            clearConnect()
            if (!res.ok || !res.body) throw new Error(`SSE failed (${res.status})`)

            // ② خواندن — watchdog سکوت: هر بایت تایمر را ریست می‌کند؛ سکوتِ
            //    > silenceTimeoutMs یعنی استریم مرده است (سرور هر ۱۵s ضربان
            //    می‌فرستد — نبودِ ۳ ضربان = مرگِ خاموش)
            streaming = true
            lastByteAt = Date.now()
            opts.onStreamOpen?.()
            const armSilence = () => {
                clearSilence()
                silenceTimer = setTimeout(() => {
                    silenceTimer = null
                    failStream()
                }, T.silenceTimeoutMs)
            }
            armSilence()

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (; ;) {
                const { done, value } = await reader.read()
                if (done) break
                lastByteAt = Date.now()
                armSilence()
                buffer += decoder.decode(value, { stream: true })
                const frames = buffer.split('\n\n')
                buffer = frames.pop() ?? ''
                for (const f of frames) {
                    // فریم‌های heartbeat/comment (خطِ «: ping») مستقیم رد می‌شوند —
                    // اما «رسیدنشان» watchdog را بالا ریست کرد (کارِ اصلی‌شان)
                    if (f.trimStart().startsWith(':')) continue
                    opts.onFrame?.(f)
                }
            }
            // استریم از سمت سرور بسته شد → مثل خطا
            failStream()
        } catch {
            clearConnect()
            if (disposed) return
            if (streaming) {
                failStream()
            } else {
                // شکست در فازِ اتصال (headers) → retry معمول
                abort?.abort()
                abort = null
                scheduleRetry(T.retryMs)
            }
        }
    }

    // ③ بازگشت از پس‌زمینه / وصل‌شدن شبکه:
    //    • در پنجره‌ی retry → اتصال فوری (صبر به ۶۰s معنا ندارد)
    //    • استریمِ بازِ کهنه (آخرین بایت > wakeStaleMs پیش — سوکت بعد از
    //      پس‌زمینه مرده) → بازسازی فوری به جای انتظارِ watchdog کامل
    //    • استریمِ تازه و سالم → دست نمی‌زنیم
    const onWake = () => {
        if (disposed) return
        if (streaming) {
            if (Date.now() - lastByteAt > T.wakeStaleMs) {
                failStream()
                clearRetry()
                void connect()
            }
            return
        }
        if (!retryTimer) return // در حال connect/token-wait — همان ادامه می‌دهد
        clearRetry()
        void connect()
    }

    if (opts.reconnectOnWake !== false && typeof window !== 'undefined') {
        window.addEventListener('online', onWake)
        document.addEventListener('visibilitychange', onWake)
    }

    void connect()

    return {
        stop() {
            disposed = true
            if (typeof window !== 'undefined' && opts.reconnectOnWake !== false) {
                window.removeEventListener('online', onWake)
                document.removeEventListener('visibilitychange', onWake)
            }
            clearRetry()
            clearConnect()
            clearSilence()
            streaming = false
            abort?.abort()
            abort = null
        },
        isStreaming() {
            return streaming
        },
    }
}
