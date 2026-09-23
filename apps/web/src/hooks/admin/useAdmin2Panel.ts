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

// --- State ---
interface Admin2State {
  noteModalOrder: { orderId: string; note: string } | null
  confirmOrder: { orderId: string; courierId: string | null; isReassign: boolean } | null
  soundEnabled: boolean
}

type Admin2Action =
  | { type: 'OPEN_NOTE_MODAL'; payload: { orderId: string; note: string } }
  | { type: 'CLOSE_NOTE_MODAL' }
  | { type: 'SET_CONFIRM'; payload: { orderId: string; courierId: string | null; isReassign: boolean } }
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

  // ⬅ NEW: polling تطبیقی — فاصله‌ی ریفچ بر اساس دیتای آخرین poll:
  //   * سفارش PAID در صف → هر ۲.۵ ثانیه (جهت تایید سریع)
  //   * صف بدون PAID → هر ۱۰ ثانیه (آرام)
  // قبلاً ثابت ۵s بود؛ این حالت هم پاسخ‌گوتره هم کم‌هزینه‌تر.
  // ux-۱: refetchIntervalInBackground روشن شد — این پنل «قلب رستوران» است؛
  // تب مخفی هم باید سفارشِ پول‌خورده را ببیند (قبلاً در تب مخفی polling
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

  // ⬅ round-16 — اتصال SSE به کانال orders:new (توکن در query — EventSource
  // هدر نمی‌تواند بفرستد؛ requireAuth سمت سرور ?token= را می‌پذیرد)
  useEffect(() => {
    if (!session?.isAdmin2LoggedIn) return
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    let es: EventSource | null = null
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

    const connect = () => {
      if (disposed) return
      const token = getAccessToken()
      if (!token) return // لاگین نیست/توکن در دسترس نیست → پول تطبیقی کافی است
      es = new EventSource(
        `${apiBase()}/realtime/stream?channel=orders:new&token=${encodeURIComponent(token)}`,
      )
      es.addEventListener('open', () => setSseConnected(true))
      for (const ev of SSE_EVENTS) es.addEventListener(ev, requestRefetch)
      es.addEventListener('error', () => {
        // قطع/خطا: پول تطبیقی فوراً برمی‌گردد؛ ۶۰s بعد با توکن تازه دوباره
        setSseConnected(false)
        es?.close()
        es = null
        if (!disposed && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            connect()
          }, SSE_RETRY_MS)
        }
      })
    }
    connect()

    return () => {
      disposed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (retryTimer) clearTimeout(retryTimer)
      es?.close()
      setSseConnected(false)
    }
  }, [session?.isAdmin2LoggedIn, refetchLive])

  // دینگ سفارش جدید
  const prevCountRef = useRef(0)
  const orders = liveData?.orders ?? []
  useEffect(() => {
    if (orders.length > prevCountRef.current && prevCountRef.current > 0) {
      if (state.soundEnabled) playDing()
      showToast('🔔 سفارش جدید ثبت شد!')
    }
    prevCountRef.current = orders.length
  }, [orders.length, state.soundEnabled, showToast])

  // --- لاگ‌اوت: revoke سرور + پاک‌سازی کامل (phase-3) ---
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
  const viewNoteMutation = useMutation({
    mutationFn: (orderId: string) => viewOrderNote({ data: { orderId } }),
    onSuccess: (res, orderId) => {
      dispatch({ type: 'OPEN_NOTE_MODAL', payload: { orderId, note: res.note ?? '' } })
      queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrders(adminId) })
    },
  })

  const handleOpenNote = useCallback((orderId: string) => {
    viewNoteMutation.mutate(orderId)
  }, [viewNoteMutation])

  const handleCloseNote = useCallback(() => dispatch({ type: 'CLOSE_NOTE_MODAL' }), [])

  // --- تایید / تغییر پیک ---
  const handleRequestConfirm = useCallback((orderId: string, courierId: string | null, isReassign: boolean) => {
    dispatch({ type: 'SET_CONFIRM', payload: { orderId, courierId, isReassign } })
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