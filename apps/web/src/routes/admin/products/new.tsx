// src/routes/admin/products/new.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createAdminProduct } from '#/server/products'
import { ProductForm } from '#/components/admin/ProductForm'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import type { ProductFormData } from '#/types/forms'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'

export const Route = createFileRoute('/admin/products/new')({
	component: NewProductPage,
})

function NewProductPage() {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const showToast = useToastStore((state) => state.showToast)
	const { permissions } = usePermissions()

	// ورودی کاملاً تایپ‌دار (قبلاً data: any بود) —
	// ProductFormData دقیقاً با اسکیمای createAdminProduct مپ می‌شه
	const mutation = useMutation({
		mutationFn: (data: ProductFormData) => createAdminProduct({ data }),
		onSuccess: (res) => {
			// stage-56 — HTTP 200 با success=false (مثل slug تکراری): پیام سرور
			// نمایش داده شود؛ بدون invalidate/ناوبری — کاربر روی فرم اصلاح می‌کند
			if (!res.success) {
				showToast(res.message ?? 'افزودن محصول ناموفق بود.', 'error')
				return
			}
			queryClient.invalidateQueries({ queryKey: qk.adminProductsAll })
			// phase-3: منوی عمومی هم تازه شود — محصول جدید باید در /products دیده شود
			queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
			queryClient.invalidateQueries({ queryKey: qk.categories })
			queryClient.invalidateQueries({ queryKey: qk.productByIdAll })
			showToast('محصول جدید با موفقیت افزوده شد')
			navigate({ to: '/admin/products' })
		},
		// stage-56 — خطای شبکه/اعتبارسنجی (استثنا) هم پیام‌دار دیده شود
		onError: (err) => showToast(err.message, 'error'),
	})

	// گارد — فقط productsWrite اجازه ساخت دارد
	if (!permissions.productsWrite) {
		return <PermissionGate hasAccess={false} pageName="افزودن محصول جدید" />
	}

	return (
		<div className="space-y-6">
			<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
				افزودن محصول جدید
			</h1>
			<ProductForm
				onSubmit={mutation.mutate}
				isSubmitting={mutation.isPending}
				canToggleAvailability={permissions.productsAvailability}
			/>
		</div>
	)
}