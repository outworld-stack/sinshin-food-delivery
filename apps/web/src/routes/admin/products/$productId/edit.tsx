// src/routes/admin/products/$productId/edit.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAdminProduct } from '#/server/products'
import { adminProductDetailsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { ProductForm } from '#/components/admin/ProductForm'
import { AdminProductFormSkeleton } from '#/components/LoadingSkeletons'
import { useToastStore } from '#/stores/toastStore'
import type { ProductFormData } from '#/types/forms'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'

export const Route = createFileRoute('/admin/products/$productId/edit')({
  component: EditProductPage,
})

function EditProductPage() {
  const { productId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  const { permissions } = usePermissions()

  const { data: product, isLoading } = useQuery(adminProductDetailsOptions(productId))

  // ورودی کاملاً تایپ‌دار (قبلاً data: any بود) —
  // categoryId از اسکیمای update حذف شده — از طریق spread پاس می‌شه و سرور نادیده می‌گیره
  const mutation = useMutation({
    mutationFn: (data: ProductFormData) => updateAdminProduct({ data: { id: productId, ...data } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminProductsAll })
      queryClient.invalidateQueries({ queryKey: qk.adminProductDetails(productId) })
      showToast('محصول با موفقیت ویرایش شد')
      navigate({ to: '/admin/products' })
    }
  })

  // گارد — فقط productsWrite اجازه ویرایش دارد
  if (!permissions.productsWrite) {
    return <PermissionGate hasAccess={false} pageName="ویرایش محصول" />
  }

  if (isLoading || !product) {
    return <AdminProductFormSkeleton />
  }

  return (
    <div className="space-y-6">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">ویرایش محصول: {product.name}</h1>
      <ProductForm initialData={product} onSubmit={mutation.mutate} isSubmitting={mutation.isPending} />
    </div>
  )
}