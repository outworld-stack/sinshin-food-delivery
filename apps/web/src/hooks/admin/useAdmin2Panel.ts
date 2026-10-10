// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/hooks/admin/useAdmin2Panel.ts
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: ریفچ فوری روی رویداد connected — بستن شکاف قطعی SSE
// ═══════════════════════════════════════════════════════════════

// src/hooks/admin/useAdmin2Panel.ts
import { useReducer, useCallback, useRef, useEffect, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  subAdminLogout, viewOrderNote,
} from '#/server/admin'
import { useNavigate } from '@tanstack/react-router'
import { onUnauthorized, getAccessToken } from '#/lib/auth-session'
import { apiBase } from '#/lib/api'
import { admin2SessionOptions, admin2LiveOrdersOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import type { LiveOrderDto } from '@sinshin/shared'

// ── وضعیت ──
interface Admin2State {
  noteModalOrder: { orderId: string; note: string; deliveryType: LiveOrderDto['deliveryType'] } | null
  confirmOrder: { orderId: string; courierId: string | null; isReassign: boolean; deliveryType: LiveOrderDto['deliveryType'] } | null
  soundEnabled: boolean
}

type Admin2Action =
  | { type: 'OPEN_NOTE_MODAL'; payload: { orderId: string; note: string; deliveryType: LiveOrderDto['deliveryType'] } }
  | { type: 'CLOSE_NOTE_MODAL' }
  | { type: 'SET_CONFIRM'; payload: { orderId: string; courierId: string | null; isReassign: boolean; deliveryType: LiveOrderDto['deliveryType'] } }
  | { type: 'CLEAR_CONFIRM' }
  | { type: 'TOGGLE_SOUND' }

const initialState: Admin2State = {
  noteModalOrder: null,
  confirmOrder: null,
  soundEnabled: true,
}

function admin2Reducer(state: Admin2State, action: Admin2Action): Admin2State {
  switch (action.type) {
    case 'OPEN_NOTE_MODAL':
      return { ...state, noteModalOrder: action.payload }
    case 'CLOSE_NOTE_MODAL':
      return { ...state, noteModalOrder: null }
    case 'SET_CONFIRM':
      return { ...state, confirmOrder: action.payload }
    case 'CLEAR_CONFIRM':
      return { ...state, confirmOrder: null }
    case 'TOGGLE_SOUND':
      return { ...state, soundEnabled: !state.soundEnabled }
    default:
      return state
  }
}

const POLL_ACTIVE_MS = 2_500   // سفارش در صف انتظار (PAID) → پول تند
const POLL_IDLE_MS = 10_000    // صف خالی → پول آرام (سرور و باتری راحته)
const ORDERS_PER_PAGE = 20

// round-16 — SSE: زیرساختش از قبل کامل بود ولی مصرف‌کننده‌ای نداشت؛
// حالا رویدادهای سرور (سفارش جدید/تأیید/تغییر پیک) ریفچ فوری می‌دهند و
// پول فقط «تور ایمنی» می‌ماند — بار دیتابیس پنل زنده به کسری از قبل می‌رسد.
// هر خطا → بازگشت بی‌درنگ به پول تطبیقی قبلی + تلاش دوبارهٔ SSE پس از ۶۰s.
const SSE_SAFETY_POLL_MS = 60_000
const SSE_RETRY_MS = 60_000
// round-29 — توکن احراز ممکن است کمی دیرتر از سشن برسد (هیدریشن);
// قبل از تسلیم‌شدن به پولِ آرام، چند بار با فاصله‌ی کوتاه دوباره می‌خواهیم
const SSE_TOKEN_WAIT_MS = 5_000
const SSE_EVENTS = ['order-created', 'order-updated', 'order-confirmed'] as const

// --- هوک ---
export function useAdmin2Panel() {
  const [state, dispatch] = useReducer(admin2Reducer, initialState)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  // ⬅ NEW: سشن از فکتوری مشترک — با usePermissions/AdminLayout/داشبورد یک کش
  // (staleTime ۱۵s داخل فکتوری متمرکز شده)
  const { data: session, isLoading } = useQuery(admin2SessionOptions)

  const adminId = session?.admin?.userId ?? '';

  // ⬅ NEW: پول تطبیقی — فاصله‌ی ریفچ بر اساس دیتای آخرین پول:
  //   * سفارش PAID در صف → هر ۲.۵ ثانیه (جهت تایید سریع)
  //   * صف بدون PAID → هر ۱۰ ثانیه (آرام)
  // قبلاً ثابت ۵s بود؛ این حالت هم پاسخ‌گوتره هم کم‌هزینه‌تر.
  // ux-۱: refetchIntervalInBackground روشن شد — این پنل «قلب رستوران» است؛
  // تب مخفی هم باید سفارشِ پول‌خورده را ببیند (قبلاً در تب مخفی پول
  // می‌ایستاد و سفارش جدید دیده نمی‌شد تا بازگشت به تب)
  // ⬅ round-16 — وضعیت SSE (قبل از کوئری تعریف می‌شود تا closure پول به آن دسترسی داشته باشد)
  const [sseConnected, setSseConnected] = useState(false)
  const { data: liveData, refetch: refetchLive } = useQuery({
    ...admin2LiveOrdersOptions(adminId),
    enabled: session?.isAdmin2LoggedIn === true,
    refetchInterval: (query) => {
      // SSE وصل است → فقط تور ایمنی ۶۰s؛ وگرنه پول تطبیقی (۲.۵s/۱۰s)
      if (sseConnected) return SSE_SAFETY_POLL_MS
      const orders = query.state.data?.orders ?? []
      return orders.some(o => o.status === 'PAID') ? POLL_ACTIVE_MS : POLL_IDLE_MS
    },
    refetchIntervalInBackground: true,
  })

  // ⬅ round-16 → رارد H5 — SSE با fetch + هدر Authorization: توکن دیگر در
  // URL نمی‌سفرد (هیستوری مرورگر/لاگ پروکسی‌ها). EventSource هدر نمی‌گرفت؛
  // استریم را خودمان با ReadableStream می‌خوانیم. پول تطبیقی تور ایمنی است.
  useEffect(() => {
    if (!session?.isAdmin2LoggedIn) return
    if (typeof window === 'undefined' || typeof AbortController === 'undefined') return

    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    // انباشت رویدادها (مثلاً ۵ سفارش هم‌زمان) → فقط یک ریفچ
    const requestRefetch = () => {
      if (debounceTimer) return
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void refetchLive()
      }, 400)
    }

    // فریم SSE: «event: <name>\ndata: <json>» — فریم‌های heartbeat (: ping) نامیده نمی‌شوند
    const parseFrame = (frame: string): void => {
      let eventName = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
      }
      if (eventName === 'connected') {
        setSseConnected(true)
        // stage-55 — resync بعد از هر (re)connect: یک ریفچ فوری (debounce شده)
        // شکاف قطعی را می‌بندد — پولِ تطبیقی فقط تور ایمنی است
        requestRefetch()
      }
      if ((SSE_EVENTS as readonly string[]).includes(eventName)) requestRefetch()
    }

    const connect = async (): Promise<void> => {
      if (disposed) return
      const token = getAccessToken()
      if (!token) {
        // round-29 — تلاش مجدد کوتاه‌مدت تا توکن هیدریشن‌شده برسد
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
          }, SSE_TOKEN_WAIT_MS)
        }
        return
      }
      abort = new AbortController()
      try {
        const res = await fetch(`${apiBase()}/realtime/stream?channel=orders:new`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: abort.signal,
        })
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
          for (const f of frames) parseFrame(f)
        }
        // استریم از سمت سرور بسته شد → مثل خطا: پول برمی‌گردد، تلاش مجدد
        throw new Error('SSE stream closed')
      } catch {
        setSseConnected(false)
        abort?.abort()
        abort = null
        if (!disposed && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            void connect()
          }, SSE_RETRY_MS)
        }
      }
    }
    void connect()

    return () => {
      disposed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (retryTimer) clearTimeout(retryTimer)
      abort?.abort()
      setSseConnected(false)
    }
  }, [session?.isAdmin2LoggedIn, refetchLive])

  // دینگ سفارش جدید
  // round-29 — قبلاً شرط prevCountRef.current > 0 یعنی پنلِ خالی هرگز برای
  // «اولین» سفارش دینگ/توست نمی‌زد. حالا فقط اولین لودِ داده بی‌صدا مبنای شمارش
  // می‌شود (چه خالی چه پُر) و هر رشد بعدی — حتی از صفر — اعلان می‌دهد.
  const prevCountRef = useRef(0)
  const firstLoadRef = useRef(true)
  const orders = liveData?.orders ?? []
  useEffect(() => {
    if (firstLoadRef.current) {
      // اولین پاسخ موفق → فقط مبنای شمارش؛ دینگِ لود اولیه نمی‌خواهیم
      if (liveData !== undefined) {
        firstLoadRef.current = false
        prevCountRef.current = orders.length
      }
      return
    }
    if (orders.length > prevCountRef.current) {
      if (state.soundEnabled) playDing()
      showToast('🔔 سفارش جدید ثبت شد!')
    }
    prevCountRef.current = orders.length
  }, [liveData, orders.length, state.soundEnabled, showToast])

  // --- لاگ‌اوت: ابطال سشن سمت سرور + پاک‌سازی کامل (phase-3) ---
  // subAdminLogout → POST /auth/logout (برای admin2 سشن + لاگ فعالیت هم بسته می‌شود)
  const navigate = useNavigate()
  const logoutMutation = useMutation({
    mutationFn: (input: string) => subAdminLogout({ data: { adminId: input } }),
    onSuccess: () => {
      // قبلاً فقط کش رفرش می‌شد؛ توکن ماژول-گلوبال و استور پاک نمی‌شد →
      // «خارج‌شده» همچنان توکن زنده داشت. حالا: پاک‌سازی کامل + خروج
      onUnauthorized()
      queryClient.clear()
      showToast('از پنل خارج شدید')
      navigate({ to: '/', replace: true })
    },
  })

  const handleLogout = useCallback(() => {
    if (!session?.admin) return
    logoutMutation.mutate(session.admin.userId)
  }, [session, logoutMutation])

  // --- نکته مشتری: میوتیشن + باز شدن مودال در onSuccess ---
  // round-26 — deliveryType همراه سفارش می‌آید تا بعد از تیک نکته، مودال تایید
  // بداند پیک دارد یا نه (سرو در محل / تحویل حضوری)
  const viewNoteMutation = useMutation({
    mutationFn: (input: { orderId: string; deliveryType: LiveOrderDto['deliveryType'] }) =>
      viewOrderNote({ data: { orderId: input.orderId } }),
    onSuccess: (res, input) => {
      dispatch({ type: 'OPEN_NOTE_MODAL', payload: { orderId: input.orderId, note: res.note ?? '', deliveryType: input.deliveryType } })
      queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrders(adminId) })
    },
  })

  const handleOpenNote = useCallback((orderId: string, deliveryType: LiveOrderDto['deliveryType']) => {
    viewNoteMutation.mutate({ orderId, deliveryType })
  }, [viewNoteMutation])

  const handleCloseNote = useCallback(() => dispatch({ type: 'CLOSE_NOTE_MODAL' }), [])

  // --- تایید / تغییر پیک ---
  const handleRequestConfirm = useCallback((orderId: string, courierId: string | null, isReassign: boolean, deliveryType: LiveOrderDto['deliveryType']) => {
    dispatch({ type: 'SET_CONFIRM', payload: { orderId, courierId, isReassign, deliveryType } })
  }, [])

  const handleCancelConfirm = useCallback(() => dispatch({ type: 'CLEAR_CONFIRM' }), [])
  const handleConfirmDone = useCallback(() => dispatch({ type: 'CLEAR_CONFIRM' }), [])

  // --- صدا ---
  const handleToggleSound = useCallback(() => dispatch({ type: 'TOGGLE_SOUND' }), [])

  return {
    state,
    session,
    isLoading,
    orders,
    isLoggingOut: logoutMutation.isPending,
    handleLogout,
    handleOpenNote,
    handleCloseNote,
    handleRequestConfirm,
    handleCancelConfirm,
    handleConfirmDone,
    handleToggleSound,
    ordersPerPage: ORDERS_PER_PAGE,
  }
}

// --- صدا: کانتکست تک‌نمونه (مرورگر محدودیت تعداد داره) ---
let _audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext()
    // مرورگرها تا اولین تعامل کاربر، صدا رو معلق نگه می‌دارن
    if (_audioCtx.state === 'suspended') void _audioCtx.resume()
    return _audioCtx
  } catch {
    return null
  }
}

function playDing() {
  const ctx = getAudioCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
  osc.start()
  osc.stop(ctx.currentTime + 0.5)
}