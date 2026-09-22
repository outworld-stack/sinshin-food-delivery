// src/routes/admin/settings/index.tsx
// ⬅ NEW: loader پری‌فچ نقش‌محور — هر دو نقش: ناحیه‌های ارسال؛
// ادمین اصلی: پرچم‌های تنظیمات + محتوای درباره‌ما/گالری (مهم‌ترین کوئری‌های صفحه)
import { createFileRoute } from '@tanstack/react-router'
import { memo, useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { setIranOnlyAccess, setLiveTrackingEnabled, setRestaurantOpen } from '#/server/admin'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import {
  settingsTrackingOptions, settingsRestaurantOptions,
  aboutContentOptions, adminGalleryImagesOptions, deliveryZonesOptions,
  settingsIranOnlyOptions, settingsRestaurantStatusOptions,
} from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { Toggle } from '#/components/shared/Toggle'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { useSiteContentSettings } from '#/hooks/admin/useSiteContentSettings'
import { AboutContentForm } from '#/components/admin/settings/AboutContentForm'
import { GalleryManager } from '#/components/admin/settings/GalleryManager'
import { DeliveryZonesManager } from '#/components/admin/settings/DeliveryZonesManager'
import { TemporaryCloseCard } from '#/components/admin/settings/TemporaryCloseCard'
import { Pin, Store, Discover2, Shield } from 'reicon-react'
import type { UpdateGalleryImageInput } from '#/types/site/gallery'
import { TermsEditor } from '#/components/admin/settings/TermsEditor'

// هر دو نقش وارد می‌شوند — ناحیه‌های ارسال مشترک؛ بقیه فقط ادمین اصلی
const SettingsPage = memo(function SettingsPage() {
  const { isMainAdmin, isAdmin2 } = usePermissions()

  return (
    <PermissionGate hasAccess={isMainAdmin || isAdmin2} pageName="تنظیمات">
      <SettingsContent />
    </PermissionGate>
  )
})

const SettingsContent = memo(function SettingsContent() {
  const { isMainAdmin, permissions } = usePermissions()
  const content = useSiteContentSettings({ enabled: isMainAdmin })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const [nextOpenTime, setNextOpenTime] = useState('۱۱:۰۰ صبح')

  // پرچم‌های تنظیمات از فکتوری — staleTime داخل فکتوری متمرکزه
  const { data: tracking } = useQuery({ ...settingsTrackingOptions, enabled: isMainAdmin })
  const { data: restaurant } = useQuery({ ...settingsRestaurantOptions, enabled: isMainAdmin })
  const { data: iranOnly } = useQuery({ ...settingsIranOnlyOptions, enabled: isMainAdmin })

  const trackingMutation = useMutation({
    mutationFn: (enabled: boolean) => setLiveTrackingEnabled({ data: { enabled } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settingsTracking })
      // پرچم ردیابی همه‌ی سفارش‌های باز رفرش می‌شه
      queryClient.invalidateQueries({ queryKey: qk.liveTrackingPrefix })
      showToast('تنظیم ردیابی زنده ذخیره شد')
    },
  })

  const restaurantMutation = useMutation({
    mutationFn: (isOpen: boolean) => setRestaurantOpen({ data: { isOpen, nextOpenTime } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settingsRestaurant })
      // وضعیت رستوران در چک‌اوت هم از همین دیتا می‌آد — بلافاصله تازه شه
      queryClient.invalidateQueries({ queryKey: qk.restaurantStatus })
      showToast('وضعیت رستوران ذخیره شد')
    },
  })

  // phase-fix — سوییچ «فقط ایران»
  const iranOnlyMutation = useMutation({
    mutationFn: (enabled: boolean) => setIranOnlyAccess({ data: { enabled } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settingsIranOnly })
      showToast('تنظیم دسترسی ذخیره شد — حداکثر تا ۱۵ ثانیه دیگر اعمال می‌شود')
    },
  })

  const handleIranOnlyToggle = useCallback(() => {
    if (iranOnly !== undefined) iranOnlyMutation.mutate(!iranOnly)
  }, [iranOnly, iranOnlyMutation])

  const handleTrackingToggle = useCallback(() => {
    if (tracking) trackingMutation.mutate(!tracking)
  }, [tracking, trackingMutation])

  const handleRestaurantToggle = useCallback(() => {
    if (restaurant) restaurantMutation.mutate(!restaurant.isOpen)
  }, [restaurant, restaurantMutation])

  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setNextOpenTime(e.target.value)
  }, [])

  const handlePatchImage = useCallback(
    (id: string, fields: Omit<UpdateGalleryImageInput, 'id'>) =>
      content.patchImage({ id, ...fields }),
    [content.patchImage],
  )
  const handleMoveImage = useCallback(
    (id: string, direction: 'up' | 'down') => content.moveImage({ id, direction }),
    [content.moveImage],
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">تنظیمات</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">مدیریت وضعیت سیستم</p>
      </div>

      {/* ⬅ ناحیه‌های ارسال — مشترک بین ادمین اصلی و ادمین۲ */}
      <DeliveryZonesManager />

      {/* round-13 — بسته/باز موقت با علت: ادمین اصلی همیشه + ادمین۲ با پرمیشن */}
      <TemporaryCloseCard visible={isMainAdmin || permissions.canToggleTemporaryClose === true} />

      {isMainAdmin && (
        <>
          {/* آیتم ۱۸: ردیابی زنده پیک */}
          <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-500/10 text-blue-500 flex items-center justify-center">
                  <Pin size={22} />
                </span>
                <div>
                  <p className="font-DanaDemiBold text-gray-800 dark:text-white">نمایش آنلاین مسیر پیک</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-xs">
                    با فعال‌سازی، مشتریان می‌توانند مسیر زنده پیک را در صفحه سفارش خود ببینند.
                  </p>
                </div>
              </div>
              <Toggle isOn={tracking ?? false} onToggle={handleTrackingToggle} />
            </div>
            <div className="mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-start gap-2">
              <Discover2 size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium">
                پیش‌فرض غیرفعال است و فقط برای سفارشات بعد از فعال‌سازی اعمال می‌شود.
              </p>
            </div>
          </div>

          {/* آیتم ۲۲: باز/بسته بودن رستوران */}
          <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${restaurant?.isOpen
                  ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
                  : 'bg-red-100 dark:bg-red-500/10 text-red-500'
                  }`}>
                  <Store size={22} />
                </span>
                <div>
                  <p className="font-DanaDemiBold text-gray-800 dark:text-white">
                    {restaurant?.isOpen ? 'رستوران باز است' : 'رستوران بسته است'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">
                    در حالت بسته، مشتری می‌تواند سفارش دهد اما ارسال بعد از باز شدن انجام می‌شود.
                  </p>
                </div>
              </div>
              <Toggle isOn={restaurant?.isOpen ?? true} onToggle={handleRestaurantToggle} />
            </div>

            {!restaurant?.isOpen && (
              <div className="mt-4">
                <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
                  ساعت باز شدن بعدی (به مشتریان نمایش داده می‌شود)
                </label>
                <input
                  type="text"
                  value={nextOpenTime}
                  onChange={handleTimeChange}
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm"
                  placeholder="مثلاً: ۱۱:۰۰ صبح"
                />
              </div>
            )}
          </div>

          {/* phase-fix: محدودیت دسترسی فقط ایران */}
          <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${iranOnly === false
                  ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-500'
                  : 'bg-green-100 dark:bg-green-500/10 text-green-500'
                  }`}>
                  <Shield size={22} />
                </span>
                <div>
                  <p className="font-DanaDemiBold text-gray-800 dark:text-white">دسترسی فقط از ایران</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-xs">
                    وقتی روشن است، بازدید از IP های خارج از ایران با صفحه‌ای که پیدا نشد (404) مواجه می‌شود.
                  </p>
                </div>
              </div>
              <Toggle isOn={iranOnly ?? true} onToggle={handleIranOnlyToggle} />
            </div>
            <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2">
              <Discover2 size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 font-DanaMedium leading-relaxed">
                اگر خودتان از خارج از ایران یا با VPN وارد می‌شوید، قبل از فعال‌سازی، IP خود را در متغیر
                محیطی عبور قرار دهید وگرنه از پنل خارج می‌شوید. پیش‌فرض این گزینه روشن است.
              </p>
            </div>
          </div>

          {/* مدیریت محتوای سایت */}
          <div className="space-y-6">
            <div>
              <h2 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">مدیریت محتوای سایت</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1 font-DanaMedium text-sm">
                ویرایش صفحات «درباره ما» و «گالری» — تغییرات بلافاصله روی سایت اعمال می‌شود.
              </p>
            </div>

            {content.isLoading ? (
              <div className="h-48 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
            ) : (
              <>
                {content.about && (
                  <AboutContentForm
                    initialData={{ ...content.about, updatedAt: new Date(content.about.updatedAt) }}
                    isSaving={content.isSavingAbout}
                    onSave={content.saveAbout}
                  />
                )}
                <GalleryManager
                  images={content.gallery}
                  isBusy={content.isGalleryBusy}
                  onAdd={content.addImage}
                  onPatch={handlePatchImage}
                  onRemove={content.removeImage}
                  onMove={handleMoveImage}
                />
              </>
            )}
          </div>

          {/* قوانین سایت — نسخه‌دار (هر ذخیره = نسخه جدید) */}
          <TermsEditor />
        </>
      )}
    </div>
  )
})

export const Route = createFileRoute('/admin/settings/')({
  ssr: false,
  component: SettingsPage,

  // ⬅ NEW: prefetch نقش‌محور — هاور روی «تنظیمات» در سایدبار:
  //   * هر دو نقش: ناحیه‌های ارسال (مشترک — بالای صفحه)
  //   * ادمین اصلی: پرچم‌ها + محتوا (درباره ما/گالری) به‌صورت موازی
  // گارد والد (/admin) قبل از این loader اجرا شده و ریدایرکت لازم را انجام داده
  loader: async ({ context }) => {
    await ensureAuthHydrated()
    const role = useAuthStore.getState().role
    if (role !== 'admin' && role !== 'admin2') return

    await context.queryClient.query(deliveryZonesOptions)
    // round-13 — وضعیت کامل (بسته موقت + علت) برای کارت مشترک بسته/باز موقت
    await context.queryClient.query(settingsRestaurantStatusOptions)

    if (role !== 'admin') return
    await Promise.all([
      context.queryClient.query(settingsTrackingOptions),
      context.queryClient.query(settingsRestaurantOptions),
      context.queryClient.query(aboutContentOptions),
      context.queryClient.query(adminGalleryImagesOptions),
      context.queryClient.query(settingsIranOnlyOptions),
    ])
  },

  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'تنظیمات | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})