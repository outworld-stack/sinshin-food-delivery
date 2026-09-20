// src/components/site/product-detail/ProductIngredients.tsx
import { memo } from 'react'

interface ProductIngredientsProps {
  ingredients: string[]
}

export const ProductIngredients = memo(function ProductIngredients({ ingredients }: ProductIngredientsProps) {
  if (ingredients.length === 0) return null

  return (
    <div className="mt-8 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-300 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4 pb-4 border-b border-gray-100 dark:border-white/5">
        محتویات محصول
      </h3>
      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {ingredients.map((ing) => (
          <li key={ing} className="flex items-center gap-2 text-gray-600 dark:text-gray-300 font-DanaMedium text-sm">
            <span className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary shrink-0"></span>
            {ing}
          </li>
        ))}
      </ul>
    </div>
  )
})