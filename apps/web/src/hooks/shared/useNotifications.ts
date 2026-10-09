// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/hooks/shared/useNotifications.ts
// ═══════════════════════════════════════════════════════════════

// src/hooks/shared/useNotifications.ts
import { useCallback, useEffect, useRef, useState } from 'react'

import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'
import { getPushState, enablePush, disablePush, type PushState } from '#/lib/push-subscription'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  data: Record<string, unknown>
  createdAt: string
  readAt: string | null
}

/**
 * فاز-۲ — هوک نوتیفیکیشن: لیست + خوانده‌نشده + SSE زنده + اشتراک پوش.
 *
 *  • SSE با fetch + هدر Authorization (رارد H5 — توکن در URL نمی‌رود)
 *    روی کانال notify:{userId} — فقط مالک (گارد سرور).
 *  • رویداد notification → ریفچِ سبک لیست + خوانده‌نشده.
 *  • همه‌ی فراخوانی‌ها fail-soft: خطا = بی‌نوتیف، نه کرش صفحه.
 *  • userId از پروفایل سبک می‌آید (هدر/داشبورد) — بدون آن، هوک خاموش است.
 */
export function useNotifications(userId: string | null | undefined) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [pushState, setPushState] = useState<PushState>({ state: 'default' })
  const [sseConnected, setSseConnected] = useState(false)
  const itemsRef = useRef<NotificationItem[]>([])
  itemsRef.current = items

  // ── واکشی اولیه + وضعیت پوش ──
  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch(`${apiBase()}/notifications`)
      if (!res.ok) return
      const body = (await res.json()) as { items?: NotificationItem[]; unread?: number }
      if (Array.isArray(body.items)) setItems(body.items)
      if (typeof body.unread === 'number') setUnread(body.unread)
    } catch {
      /* آفلاین/نشست منقضی — سکوت */
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    void refresh()
    void getPushState().then(setPushState)
  }, [userId, refresh])

  // ── SSE زنده — fetch-محور (H5) ──
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return
    if (typeof AbortController === 'undefined') return

    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const connect = async (): Promise<void> => {
      if (disposed) return
      const token = getAccessToken()
      if (!token) {
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
          }, 3_000)
        }
        return
      }
      abort = new AbortController()
      try {
        const res = await fetch(
          `${apiBase()}/realtime/stream?channel=notify:${encodeURIComponent(userId)}`,
          {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: abort.signal,
          },
        )
        if (!res.ok || !res.body) throw new Error(`SSE failed (${res.status})`)
        setSseConnected(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            let eventName = ''
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim()
            }
            if (eventName === 'notification') void refresh()
          }
        }
        throw new Error('SSE stream closed')
      } catch {
        setSseConnected(false)
        abort?.abort()
        abort = null
        if (!disposed && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
          }, 30_000)
        }
      }
    }
    void connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      abort?.abort()
      setSseConnected(false)
    }
  }, [userId, refresh])

  // ── علامت‌گذاری خوانده‌شده ──
  const markRead = useCallback(
    async (id: string) => {
      // بهینه‌بینی محلی فوری — سرور بعداً تأیید می‌کند
      setItems((prev) =>
        prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
      )
      setUnread((u) => Math.max(0, u - 1))
      try {
        await authedFetch(`${apiBase()}/notifications/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        })
      } catch {
        /* بعداً sync می‌شود */
      }
    },
    [],
  )

  const markAllRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    )
    setUnread(0)
    try {
      await authedFetch(`${apiBase()}/notifications/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
    } catch {
      /* بعداً sync می‌شود */
    }
  }, [])

  // ── اشتراک پوش ──
  const onEnablePush = useCallback(async () => {
    const st = await enablePush()
    setPushState(st)
    return st
  }, [])

  const onDisablePush = useCallback(async () => {
    const st = await disablePush()
    setPushState(st)
    return st
  }, [])

  return {
    items,
    unread,
    pushState,
    sseConnected,
    refresh,
    markRead,
    markAllRead,
    enablePush: onEnablePush,
    disablePush: onDisablePush,
  }
}

// ── helper محلی (بدون رفرش‌لوپ auth-session — این مسیر حیاتی نیست) ──
async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  return fetch(url, { ...init, headers, credentials: 'include' })
}
