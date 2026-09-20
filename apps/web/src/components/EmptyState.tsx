// src/components/EmptyState.tsx
import type { EmptyStateProps } from '#/types/shared/ui'
import { Box } from 'reicon-react' // آیکون جعبه خالی

export function EmptyState({ 
  title = "محصولی یافت نشد", 
  description = "در حال حاضر محصولی در این دسته‌بندی وجود ندارد. بعداً دوباره بررسی کنید." 
}: EmptyStateProps) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 px-4 text-center bg-gray-50 dark:bg-[#2a1015] rounded-2xl border border-dashed border-gray-300 dark:border-[#3a151c]">
      <Box size={64} className="text-gray-300 dark:text-gray-600 mb-4" />
      <h3 className="font-DanaDemiBold text-xl text-gray-700 dark:text-gray-300 mb-2">{title}</h3>
      <p className="font-DanaRegular text-sm text-gray-500 dark:text-gray-400 max-w-sm">{description}</p>
    </div>
  );
}