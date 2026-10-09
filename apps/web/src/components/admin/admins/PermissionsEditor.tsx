// src/components/admin/admins/PermissionsEditor.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateSubAdminPermissions } from '#/server/admin'
import { qk } from '#/utils/queryKeys'
import { Toggle } from '#/components/shared/Toggle'
import { useToastStore } from '#/stores/toastStore'
import { Shield } from 'reicon-react'
import type { SubAdminPermissionsDto, SubAdminRecordDto } from '@sinshin/shared'

interface PermissionsEditorProps {
	admin: SubAdminRecordDto
}

// لیبل‌ها — ثابت بیرون کامپوننت
// round-29 — ①canToggleTemporaryClose اضافه شد (قبلاً در UI غایب بود ولی ستون/گارد بک‌اند از round-13 موجود بود)
// ②حوزه (hall/takeaway) بخش جداگانه‌ی «حوزه» شد — پایین‌تر
// stage-48 — ۴ کلید جدید: canEditPackagingFee (بالاخره UI هم گرفت)،
// notificationsRead/notificationsSend (پنل نوتیف) و productsAvailability (ناموجود کردن)
const PERMISSION_LABELS: {
	key: keyof SubAdminPermissionsDto
	label: string
}[] = [
	{ key: 'productsRead', label: 'مشاهده محصولات' },
	{ key: 'productsWrite', label: 'افزودن/ویرایش محصولات' },
	{ key: 'productsAvailability', label: 'موجود/ناموجود کردن محصولات' },
	{ key: 'usersRead', label: 'مشاهده کاربران' },
	{ key: 'usersWrite', label: 'ویرایش کاربران' },
	{ key: 'couriersRead', label: 'مشاهده پیک‌ها' },
	{ key: 'couriersWrite', label: 'افزودن پیک' },
	{ key: 'mainCategoriesRead', label: 'مشاهده دسته‌های اصلی' },
	{ key: 'mainCategoriesWrite', label: 'مدیریت دسته‌های اصلی' },
	{ key: 'orderDetailsRead', label: 'مشاهده ریز فاکتور سفارش' },
	{ key: 'canToggleTemporaryClose', label: 'اعلام بسته/باز موقت رستوران' },
	{ key: 'canEditPackagingFee', label: 'ویرایش هزینه بسته‌بندی' },
	{ key: 'notificationsRead', label: 'مشاهده تاریخچه نوتیفیکیشن‌ها' },
	{ key: 'notificationsSend', label: 'ارسال نوتیفیکیشن' },
]
// ویرایش دسترسی‌های ادمین۲ — توسط ادمین اصلی
export const PermissionsEditor = memo(function PermissionsEditor({
	admin,
}: PermissionsEditorProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const [perms, setPerms] = useState<SubAdminPermissionsDto>(admin.permissions)

	const mutation = useMutation({
		// رارد ۴۷ — بدنه‌ی PATCH حالا قراردادی است (SubAdminPermissionsPatch)؛
		// ارسال نسخه‌ی کامل معتبر است و تبدیل نوعِ قبلی حذف شد
		mutationFn: (data: { id: string; permissions: SubAdminPermissionsDto }) =>
			updateSubAdminPermissions(data),

		onSuccess: () => {
			// ⬅ NEW: کلیدها از فکتوری مرکزی —
			// پریفکس: هر صفحه‌ی جزئیات ادمین۲ که باز است رفرش می‌شود
			queryClient.invalidateQueries({ queryKey: qk.subAdminDetailsAll })
			// لیست ادمین‌ها (خلاصه‌ی دسترسی‌ها ممکنه نمایش داده شه)
			queryClient.invalidateQueries({ queryKey: qk.subAdmins })
			// سشن سایدبار ادمین۲ هم ریفرش شه — دسترسی فوری اعمال می‌شه
			queryClient.invalidateQueries({ queryKey: qk.admin2Session })
			showToast('دسترسی‌ها ذخیره شد')
		},
	})

	const handleToggle = useCallback((key: keyof SubAdminPermissionsDto) => {
		setPerms((prev) => ({ ...prev, [key]: !prev[key] }))
	}, [])

	// round-29 — تغییر وضعیت حوزه: حداقل یکی باید فعال بماند؛ ادمین۲ بدون حوزه هیچ سفارشی نمی‌بیند
	// (گارد بیرون از updater — updater باید pure بماند؛ setState حین رندر ممنوع)
	const handleScopeToggle = useCallback(
		(key: 'hall' | 'takeaway') => {
			const other = key === 'hall' ? 'takeaway' : 'hall'
			if (perms[key] && !perms[other]) {
				showToast('حداقل یک حوزه باید فعال بماند', 'error')
				return
			}
			setPerms((prev) => ({ ...prev, [key]: !prev[key] }))
		},
		[perms, showToast],
	)

	const handleSave = useCallback(() => {
		mutation.mutate({ id: admin.userId, permissions: perms })
	}, [admin.userId, perms, mutation])

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
				<Shield size={20} className="text-primary dark:text-dark-primary" />
				دسترسی‌ها
			</h2>
			<p className="text-xs text-gray-400 font-DanaMedium mb-6">
				دسترسی‌های این ادمین سطح ۲ — تغییرات فوراً پس از ذخیره اعمال می‌شوند
			</p>

			{/* round-29 — حوزه (حوزه): تعیین اینکه این ادمین۲ سفارشات کدام حوزه را در پنل زنده می‌بیند.
          قبلاً هیچ راهی برای تغییرش وجود نداشت (روت، کلیدهای اشتباه می‌پذیرفت) */}
			<div className="mb-6 p-4 rounded-2xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]">
				<p className="text-xs font-DanaDemiBold text-gray-600 dark:text-gray-300 mb-3">
					حوزه‌ی سفارشات (پنل زنده)
				</p>
				<div className="space-y-3">
					<div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#2a1015]">
						<span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
							سفارشات سالن (سرو در محل)
						</span>
						<Toggle
							isOn={perms.hall}
							onToggle={() => handleScopeToggle('hall')}
						/>
					</div>
					<div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#2a1015]">
						<span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
							سفارشات بیرون‌بر (ارسال + تحویل حضوری)
						</span>
						<Toggle
							isOn={perms.takeaway}
							onToggle={() => handleScopeToggle('takeaway')}
						/>
					</div>
				</div>
				<p className="text-[11px] text-gray-400 font-DanaMedium leading-relaxed mt-3">
					حداقل یک حوزه باید فعال بماند — ادمین سطح ۲ فقط سفارشات حوزه‌های فعال
					خود را در پنل زنده می‌بیند و تایید می‌کند.
				</p>
			</div>

			<div className="space-y-3">
				{PERMISSION_LABELS.map(({ key, label }) => (
					<div
						key={key}
						className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e]"
					>
						<span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
							{label}
						</span>
						<Toggle isOn={perms[key]} onToggle={() => handleToggle(key)} />
					</div>
				))}
			</div>
			<button
				type="button"
				onClick={handleSave}
				disabled={mutation.isPending}
				className="mt-6 w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
			>
				{mutation.isPending ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
			</button>
		</div>
	)
})