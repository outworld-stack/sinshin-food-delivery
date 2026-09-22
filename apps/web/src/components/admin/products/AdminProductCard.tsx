// src/components/admin/products/AdminProductCard.tsx
// round-13 — ستون عکس حذف شد (درخواست صریح): زیر «محصول» نام محصول،
// زیر «دسته‌بندی» دسته‌بندی. عکس فقط در فرم/جزئیات دیده می‌شود.
import { memo, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { formatPrice } from '#/utils/format'
import { Can } from '#/components/shared/PermissionGate'
import { Pen, Ban, Check } from 'reicon-react'

interface AdminProductCardProps {
  product: {
    id: string
    name: string
    prepTime: number
    finalPrice: number
    status: string
    categoryId: string
  }
  categoryName: string | undefined
  canWrite: boolean
  onToggle: (id: string, status: string) => void
}

// کارت محصول ادمین — دسکتاپ تک‌ردیف + موبایل، اکشن‌ها فقط با write
export const AdminProductCard = memo(function AdminProductCard({
  product, categoryName, canWrite, onToggle,
}: AdminProductCardProps) {
  const handleToggle = useCallback(() => onToggle(product.id, product.status), [onToggle, product.id, product.status])

  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">

      {/* موبایل */}
      <div className="lg:hidden flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{product.name}</p>
          <p className="text-xs text-gray-400 mt-1">{categoryName} | {product.prepTime} دقیقه</p>
          <span className="text-sm font-DanaDemiBold text-primary dark:text-dark-primary mt-1 block">{formatPrice(product.finalPrice)} ت</span>
        </div>
        <div className="flex flex-col gap-2">
          <Can allowed={canWrite}>
            <Link to="/admin/products/$productId/edit" params={{ productId: product.id }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer">
              <Pen size={18} />
            </Link>
            <button onClick={handleToggle} className={`p-2 rounded-lg transition cursor-pointer ${product.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`}>
              {product.status === 'ACTIVE' ? <Ban size={18} /> : <Check size={18} />}
            </button>
          </Can>
        </div>
      </div>

      {/* دسکتاپ */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-4 items-center text-right">
        <div className="flex flex-col">
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{product.name}</p>
          <p className="text-xs text-gray-400">{product.prepTime} دقیقه</p>
        </div>
        <div className="font-DanaMedium text-gray-600 dark:text-gray-300 text-sm">{categoryName || '-'}</div>
        <div className="font-DanaDemiBold text-gray-900 dark:text-white text-sm">{formatPrice(product.finalPrice)} ت</div>
        <div>
          <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${product.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-500/10 dark:text-gray-400'}`}>
            {product.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Can allowed={canWrite}>
            <Link to="/admin/products/$productId/edit" params={{ productId: product.id }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer" title="ویرایش">
              <Pen size={18} />
            </Link>
            <button onClick={handleToggle} className={`p-2 rounded-lg transition cursor-pointer ${product.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`} title={product.status === 'ACTIVE' ? 'غیرفعال' : 'فعال'}>
              {product.status === 'ACTIVE' ? <Ban size={18} /> : <Check size={18} />}
            </button>
          </Can>
        </div>
      </div>

    </div>
  )
})
