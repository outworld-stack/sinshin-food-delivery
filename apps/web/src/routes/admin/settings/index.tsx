// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 16 از 17
// مسیر مقصد: apps/web/src/routes/admin/settings/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/routes/admin/settings/index.tsx
// ⬅ NEW: پیش‌واکشی نقش‌محور در loader — هر دو نقش: ناحیه‌های ارسال؛
// ادمین اصلی: پرچم‌های تنظیمات + محتوای درباره‌ما/گالری (مهم‌ترین کوئری‌های صفحه)
import { createFileRoute } from '@tanstack/react-router'
import { memo, useCallback, useState } from 'react'
import { Discover2, Pin } from 'reicon-react'
import { AboutContentForm } from '#/components/admin/settings/AboutContentForm'
import { DeliveryZonesManager } from '#/components/admin/settings/DeliveryZonesManager'
// stage-100 — کارت انتخاب انیمیشن صفحه‌ی محصول ویژه (فقط ادمین اصلی)
import { FeaturedAnimationCard } from '#/components/admin/settings/FeaturedAnimationCard'
import { GalleryManager } from '#/components/admin/settings/GalleryManager'
// رارد ۳۷ — کارت کامل دسترسی جغرافیایی (ایران + عراق) — جانشین کارت ساده‌ی «فقط ایران»
import { GeoAccessCard } from '#/components/admin/settings/GeoAccessCard'
import { PaymentGatewaysCard } from '#/components/admin/settings/PaymentGatewaysCard'
// stage-79 — کارت مجوز ثبت‌نام ویژه (فقط ادمین اصلی — بک هم requireAdmin)
import { RegistrationPermitCard } from '#/components/admin/settings/RegistrationPermitCard'
// stage-84 — باکس واحدِ وضعیت رستوران (ساعتی + شلوغی + موقت) + سوئیچ درگاه‌ها
import { RestaurantStatusCard } from '#/components/admin/settings/RestaurantStatusCard'
import { TermsEditor } from '#/components/admin/settings/TermsEditor'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { Toggle } from '#/components/shared/Toggle'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { useSiteContentSettings } from '#/hooks/admin/useSiteContentSettings'
import { setLiveTrackingEnabled, setRestaurantOpen } from '#/server/admin'
import { ensureAuthHydrated, useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import type { UpdateGalleryImageInput } from '#/types/site/gallery'
import { qk } from '#/utils/queryKeys'
import {
	aboutContentOptions,
	adminGalleryImagesOptions,
	deliveryZonesOptions,
	// stage-100 — انیمیشن صفحه‌ی محصول ویژه (کارت جدید)
	settingsFeaturedAnimationOptions,
	settingsIranOnlyOptions,
	settingsOutsideScopeOptions,
	settingsRegistrationPermitsOptions,
	settingsRestaurantOptions,
	settingsRestaurantStatusOptions,
	settingsTrackingOptions,
} from '#/utils/queryOptions'

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
	const { data: tracking } = useQuery({
		...settingsTrackingOptions,
		enabled: isMainAdmin,
	})
	const { data: restaurant } = useQuery({
		...settingsRestaurantOptions,
		enabled: isMainAdmin,
	})
	// stage-84 — وضعیت کامل (بج‌های باکس وضعیت: موقت/شلوغ) — هر دو نقش
	const { data: statusFull } = useQuery(settingsRestaurantStatusOptions)
	// رارد ۳۷ — پرچم «فقط ایران» + دامنه‌ی عراق به GeoAccessCard منتقل شد
	// (کوئری/موتیشن/هندلر همه داخل همان کامپوننت)؛ اینجا فقط لودر پری‌فچ می‌کند

	const trackingMutation = useMutation({
		mutationFn: (enabled: boolean) =>
			setLiveTrackingEnabled({ data: { enabled } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: qk.settingsTracking })
			// پرچم ردیابی همه‌ی سفارش‌های باز رفرش می‌شه
			queryClient.invalidateQueries({ queryKey: qk.liveTrackingPrefix })
			showToast('تنظیم ردیابی زنده ذخیره شد')
		},
	})

	const restaurantMutation = useMutation({
		mutationFn: (isOpen: boolean) =>
			setRestaurantOpen({ data: { isOpen, nextOpenTime } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: qk.settingsRestaurant })
			queryClient.invalidateQueries({ queryKey: qk.settingsRestaurantStatus })
			queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
			// وضعیت رستوران در چک‌اوت هم از همین دیتا می‌آد — بلافاصله تازه شه
			queryClient.invalidateQueries({ queryKey: qk.restaurantStatus })
			showToast('وضعیت رستوران ذخیره شد')
		},
	})

	// رارد ۳۷ — سوییچ «فقط ایران» + انتخاب دامنه عراق → GeoAccessCard

	const handleTrackingToggle = useCallback(() => {
		if (tracking !== undefined && !trackingMutation.isPending)
			trackingMutation.mutate(!tracking)
	}, [tracking, trackingMutation])

	const handleRestaurantToggle = useCallback(() => {
		if (statusFull && !restaurantMutation.isPending)
			restaurantMutation.mutate(!statusFull.isOpen)
	}, [statusFull, restaurantMutation])

	// stage-84 — ساعت باز شدن از طریق onNextOpenTimeChange باکس وضعیت آپدیت می‌شود

	const handlePatchImage = useCallback(
		(id: string, fields: Omit<UpdateGalleryImageInput, 'id'>) =>
			content.patchImage({ id, ...fields }),
		[content.patchImage],
	)
	const handleMoveImage = useCallback(
		(id: string, direction: 'up' | 'down') =>
			content.moveImage({ id, direction }),
		[content.moveImage],
	)

	return (
		// round-29 — قبلاً max-w-2xl تک‌ستونه بود؛ round-30 دوسطونه شد.
		//
		// stage-101 — بازگشت به تک‌ستونه‌ی تمام‌عرض به خواسته‌ی کارفرما:
		// در چیدمانِ دوستونه باکسِ «ناحیه‌های ارسال» کوتاه‌تر از ستونِ کناری
		// می‌ماند و زیرش فضای خالی می‌افتاد. حالا همه‌ی باکس‌ها مرتب،
		// تمام‌عرض و «زیر هم» چیده می‌شوند — نه فضای خالی سمت چپ، نه راست.
		<div className="space-y-6 max-w-6xl">
			<div>
				<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
					تنظیمات
				</h1>
				<p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
					مدیریت وضعیت سیستم
				</p>
			</div>

			{/* بخش ۱ — تنظیمات عملیاتی: تک‌ستونه‌ی تمام‌عرض، زیر هم (stage-101) */}
			<div className="space-y-6">
				{/* ⬅ ناحیه‌های ارسال — مشترک بین ادمین اصلی و ادمین۲ */}
				<DeliveryZonesManager canManage={isMainAdmin} />

				{/* stage-84 — باکس واحدِ «وضعیت رستوران»: ① باز/بسته دائم (ادمین اصلی)
              ② اعلام شلوغی (ادمین اصلی + canAnnounceBusy) ③ بسته موقت (موجود) */}
				<RestaurantStatusCard
					isMainAdmin={isMainAdmin}
					canAnnounceBusy={permissions.canAnnounceBusy === true}
					canToggleTemporaryClose={permissions.canToggleTemporaryClose === true}
					hourlyOpen={statusFull?.isOpen ?? restaurant?.isOpen ?? false}
					busy={statusFull?.isBusy === true}
					temporarilyClosed={statusFull?.temporarilyClosed === true}
					onToggleHourly={handleRestaurantToggle}
					nextOpenTime={nextOpenTime}
					onNextOpenTimeChange={setNextOpenTime}
				/>

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
										<p className="font-DanaDemiBold text-gray-800 dark:text-white">
											نمایش آنلاین مسیر پیک
										</p>
										<p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-xs">
											با فعال‌سازی، مشتریان می‌توانند مسیر زنده پیک را در صفحه
											سفارش خود ببینند.
										</p>
									</div>
								</div>
								<Toggle
									isOn={tracking ?? false}
									onToggle={handleTrackingToggle}
									label="نمایش آنلاین مسیر پیک"
								/>
							</div>
							<div className="mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-start gap-2">
								<Discover2
									size={16}
									className="text-blue-500 shrink-0 mt-0.5"
								/>
								<p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium">
									پیش‌فرض غیرفعال است و فقط برای سفارشات بعد از فعال‌سازی اعمال
									می‌شود.
								</p>
							</div>
						</div>

						{/* stage-84 — سوئیچ درگاه‌های پرداخت (فقط ادمین اصلی) */}
						<PaymentGatewaysCard visible={isMainAdmin} />

						{/* stage-100 — انیمیشن پیش‌فرضِ محصولات ویژه (shader پیش‌فرض /
								    sonar / sparks) — فقط ادمین اصلی؛ stage-101 — انتخابِ اختصاصیِ هر محصول در فرمِ خودش است */}
						<FeaturedAnimationCard visible={isMainAdmin} />

						{/* رارد ۳۷ — کارت کامل دسترسی جغرافیایی: سوییچ ایران + باکس مجوز عراق +
                  انتخاب دامنه (فقط عراق / همه کشورها) + وضعیت زنده‌ی رنج‌ها */}
						<GeoAccessCard />

						{/* stage-79 — مجوز ثبت‌نام ویژه: شماره → یک‌بار ثبت‌نام (حتی از
                  دستگاه سوخته/مسدود) → بلاکِ دستگاه پس از ثبت‌نام */}
						<RegistrationPermitCard />
					</>
				)}
			</div>

			{/* بخش ۲ — مدیریت محتوای سایت (تمام‌عرض): این فرم‌ها در ستونِ نیم‌عرض چند برابر
          بلند می‌شوند (قوانین: ~۱۸۰۰px در ۵۶۴px!) — پهن و مرتب زیر هم */}
			{isMainAdmin && (
				<div className="space-y-6">
					<div>
						<h2 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">
							مدیریت محتوای سایت
						</h2>
						<p className="text-gray-500 dark:text-gray-400 mt-1 font-DanaMedium text-sm">
							ویرایش صفحات «درباره ما» و «گالری» — تغییرات بلافاصله روی سایت
							اعمال می‌شود.
						</p>
					</div>

					{content.isLoading ? (
						<div className="h-48 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
					) : (
						<>
							{content.about && (
								<AboutContentForm
									initialData={{
										...content.about,
										// round-34 — نرمال‌سازی فیلدهای عربی (null → '' = پشتیبان فارسی)
										heroTitleAr: content.about.heroTitleAr ?? '',
										heroTextAr: content.about.heroTextAr ?? '',
										teamTitleAr: content.about.teamTitleAr ?? '',
										teamAltAr: content.about.teamAltAr ?? '',
										updatedAt: new Date(content.about.updatedAt),
									}}
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

					{/* قوانین سایت — نسخه‌دار (هر ذخیره = نسخه جدید) */}
					<TermsEditor />
				</div>
			)}
		</div>
	)
})

export const Route = createFileRoute('/admin/settings/')({
	ssr: false,
	component: SettingsPage,

	// ⬅ NEW: پیش‌واکشی نقش‌محور — هاور روی «تنظیمات» در سایدبار:
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
			// رارد ۳۷ — هر دو پرچم کارت جغرافیایی (وضعیت زنده‌ی رنج‌ها خودش داخل
			// GeoAccessCard لود می‌شود — refetchInterval دارد، پری‌فچ لازم نیست)
			context.queryClient.query(settingsIranOnlyOptions),
			context.queryClient.query(settingsOutsideScopeOptions),
			// stage-79 — فهرست مجوزهای ثبت‌نام (کارت زیرِ کارت جغرافیایی)
			context.queryClient.query(settingsRegistrationPermitsOptions),
			// stage-100 — انیمیشن صفحه‌ی محصول ویژه (کارت جدید)
			context.queryClient.query(settingsFeaturedAnimationOptions),
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
