// src/components/admin/ProductForm.tsx
import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminCategoriesOptions } from '#/utils/queryOptions'
import { ImageField } from '#/components/shared/ImageField'
import { ProductCard } from '#/components/ProductCard'
import { Toggle } from '#/components/shared/Toggle'
import { formatPrice } from '#/utils/format'
import { useToastStore } from '#/stores/toastStore'
import { Link } from '@tanstack/react-router'
import type { ProductFormProps, ProductFormData } from '#/types/forms'
import { X, Plus } from 'reicon-react'

export function ProductForm({ initialData, onSubmit, isSubmitting }: ProductFormProps) {
  // کتگوری‌ها از فکتوری مشترک (qk.categories) — همون کش فرم کوپن و فیلتر لیست‌ها
  const { data: categories } = useQuery(adminCategoriesOptions)
  const showToast = useToastStore((s) => s.showToast)

  const [formData, setFormData] = useState<ProductFormData>({
    name: '',
    description: '',
    originalPrice: 0,
    discountPercentage: 0,
    prepTime: 15,
    categoryId: '',
    profileImage: '',
    galleryImages: [],
    ingredients: [],
    sizes: [],
    sizesEnabled: false,   // ⬅ پیش‌فرض خاموش (پرسش ۱)
  })

  const [ingredientInput, setIngredientInput] = useState('')


  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        description: initialData.description || '',
        originalPrice: initialData.originalPrice || 0,
        discountPercentage: initialData.discountPercentage || 0,
        prepTime: initialData.prepTime || 15,
        categoryId: initialData.categoryId || '',
        profileImage: initialData.profileImage || '',
        galleryImages: initialData.galleryImages || [],
        ingredients: initialData.ingredients || [],
        sizes: initialData.sizes?.map((s) => ({ name: s.name, price: s.price })) || [],
        sizesEnabled: initialData.sizesEnabled ?? false,
      })
    }
  }, [initialData])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    setFormData(prev => ({ ...prev, [name]: type === 'number' ? Number(value) : value }))
  }

  // دسته‌ی انتخابی + قالب نام سایزها
  const selectedCategory = categories?.find(c => c.id === formData.categoryId)
  const sizeTemplate = selectedCategory?.hasSizes ? (selectedCategory.sizeNames ?? []) : []

  // --- سایزها ---
  const handleSizeChange = (index: number, field: 'name' | 'price', value: string) => {
    const newSizes = [...(formData.sizes || [])]
    if (field === 'price') newSizes[index].price = Number(value)
    else newSizes[index].name = value
    setFormData(prev => ({ ...prev, sizes: newSizes }))
  }
  const addSize = () => setFormData(prev => ({ ...prev, sizes: [...(prev.sizes || []), { name: '', price: 0 }] }))
  const removeSize = (index: number) => setFormData(prev => ({ ...prev, sizes: prev.sizes?.filter((_, i) => i !== index) || [] }))

  // روشن کردن → اگه لیست خالیه و قالبی داریم، خودکار از قالب پر می‌کنیم
  const handleToggleSizes = useCallback(() => {
    setFormData(prev => {
      const next = !prev.sizesEnabled
      if (next && (prev.sizes?.length ?? 0) === 0 && sizeTemplate.length > 0) {
        return { ...prev, sizesEnabled: next, sizes: sizeTemplate.map(name => ({ name, price: 0 })) }
      }
      return { ...prev, sizesEnabled: next }
    })
  }, [sizeTemplate])

  // --- مواد اولیه ---
  const handleAddIngredient = () => {
    if (ingredientInput.trim()) {
      setFormData(prev => ({ ...prev, ingredients: [...(prev.ingredients || []), ingredientInput.trim()] }))
      setIngredientInput('')
    }
  }

  // --- عکس‌ها ---

  // --- اعتبارسنجی و ارسال ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.categoryId) {
      showToast('دسته‌بندی محصول را انتخاب کنید.', 'error')
      return
    }

    if (!formData.ingredients || formData.ingredients.length < 2) {
      showToast('حداقل باید ۲ ماده اولیه برای محصول وارد کنید.', 'error')
      return
    }
    if (!formData.galleryImages || formData.galleryImages.length === 0) {
      showToast('افزودن حداقل یک عکس برای گالری محصول اجباری است.', 'error')
      return
    }

    if (formData.sizesEnabled) {
      const sizes = formData.sizes ?? []
      if (sizes.length === 0) { showToast('حداقل یک سایز تعریف کنید یا سایزبندی را خاموش کنید.', 'error'); return }
      if (sizes.some(s => !s.name.trim())) { showToast('نام همه‌ی سایزها را تعیین کنید.', 'error'); return }
      if (sizes.some(s => s.price <= 0)) { showToast('قیمت همه‌ی سایزها باید بیشتر از صفر باشد.', 'error'); return }
      const names = sizes.map(s => s.name.trim())
      if (new Set(names).size !== names.length) { showToast('نام سایزها نباید تکراری باشد.', 'error'); return }
    } else {
      if (!formData.originalPrice || formData.originalPrice <= 0) {
        showToast('قیمت پایه محصول را وارد کنید.', 'error')
        return
      }
    }

    onSubmit(formData)
  }

  // قیمت نمایشی پیش‌نمایش
  const previewFinalPrice = formData.sizesEnabled
    ? (formData.sizes?.[0]?.price ?? 0)
    : Math.round((formData.originalPrice || 0) * (1 - (formData.discountPercentage || 0) / 100))

  // پیش‌نمایش کاملاً تایپ‌دار (قبلاً as any بود) —
  // دقیقاً همون ساختار ProductCardProps.product؛ سایزها id موقت می‌گیرن
  const previewProduct = {
    id: 'preview',
    name: formData.name,
    description: formData.description,
    originalPrice: formData.originalPrice,
    finalPrice: previewFinalPrice,
    discountPercentage: formData.sizesEnabled ? 0 : formData.discountPercentage,
    profileImage: formData.profileImage || null,
    sizesEnabled: formData.sizesEnabled,
    sizes: formData.sizes.map((s, i) => ({ id: `preview-${i}`, name: s.name, price: s.price })),
  }

  const isSizesOn = !!formData.sizesEnabled

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">

      {/* ستون اصلی */}
      <div className="lg:col-span-2 space-y-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">

        {/* ۱. عکس پروفایل */}
        <ImageField
          label="عکس پروفایل محصول (PNG)"
          accept="image/png"
          fileTypeText="PNG"
          images={formData.profileImage ? [formData.profileImage] : []}
          onAdd={(url) => setFormData(prev => ({ ...prev, profileImage: url }))}
          onRemove={() => setFormData(prev => ({ ...prev, profileImage: '' }))}
        />

        {/* ۲. گالری */}
        <ImageField
          label="عکس‌های گالری (جهت اسلایدر - اجباری)"
          accept="image/webp"
          fileTypeText="افزودن WebP"
          multiple
          images={formData.galleryImages ?? []}
          onAdd={(url) => setFormData(prev => ({ ...prev, galleryImages: [...(prev.galleryImages || []), url] }))}
          onRemove={(index) => setFormData(prev => ({ ...prev, galleryImages: prev.galleryImages?.filter((_, i) => i !== index) || [] }))}
        />

        {/* نام و دسته */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">نام محصول</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">دسته‌بندی</label>
            <select name="categoryId" value={formData.categoryId} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none cursor-pointer">
              {categories?.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">توضیحات</label>
          <textarea name="description" value={formData.description} onChange={handleChange} rows={3} className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-none"></textarea>
        </div>

        {/* ⬅ سوئیچ سایزبندی — کلید اصلی (پرسش ۱) */}
        <div className={`flex items-center justify-between p-4 rounded-xl border-2 transition ${isSizesOn ? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5' : 'border-gray-200 dark:border-[#3a151c]'}`}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center font-DanaDemiBold">S</span>
            <div>
              <p className="font-DanaDemiBold text-gray-800 dark:text-white">قیمت‌گذاری با سایز</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                {isSizesOn
                  ? 'هر سایز قیمت مستقل خودش را دارد — قیمت پایه و تخفیف اعمال نمی‌شوند.'
                  : 'خاموش: قیمت پایه + درصد تخفیف (رفتار فعلی). روشن: قیمت‌های مستقل برای هر سایز.'}
              </p>
            </div>
          </div>
          <Toggle isOn={isSizesOn} onToggle={handleToggleSizes} />
        </div>

        {/* قیمت‌ها — با روشن بودن سایز، قفل */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
              قیمت پایه (تومان) {isSizesOn && <span className="text-xs text-gray-400">(قفل — سایز مبناست)</span>}
            </label>
            <input type="number" name="originalPrice" value={formData.originalPrice} onChange={handleChange} required={!isSizesOn} disabled={isSizesOn}
              className={`w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none ${isSizesOn ? 'opacity-50 cursor-not-allowed' : ''}`} />
          </div>
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
              تخفیف (%) {isSizesOn && <span className="text-xs text-gray-400">(قفل)</span>}
            </label>
            <input type="number" name="discountPercentage" value={formData.discountPercentage} onChange={handleChange} min="0" max="100" disabled={isSizesOn}
              className={`w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none ${isSizesOn ? 'opacity-50 cursor-not-allowed' : ''}`} />
          </div>
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">زمان آماده‌سازی</label>
            <input type="number" name="prepTime" value={formData.prepTime} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none" />
          </div>
        </div>

        {/* ⬅ ویرایشگر سایزها — فقط وقتی فعال */}
        {isSizesOn && (
          <div className="border-t border-gray-100 dark:border-white/5 pt-6">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
                سایزها و قیمت‌ها
                {sizeTemplate.length > 0 && <span className="text-xs text-gray-400 mr-2">(قالب دسته: {sizeTemplate.length} سایز)</span>}
              </label>
              <button type="button" onClick={addSize} className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer flex items-center gap-1">
                <Plus size={14} /> افزودن سایز
              </button>
            </div>
            <div className="space-y-3">
              {formData.sizes?.map((size, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  {sizeTemplate.length > 0 ? (
                    <select
                      value={size.name}
                      onChange={(e) => handleSizeChange(index, 'name', e.target.value)}
                      className="col-span-5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
                    >
                      <option value="">انتخاب سایز...</option>
                      {sizeTemplate.map(sn => <option key={sn} value={sn}>{sn}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={size.name}
                      onChange={(e) => handleSizeChange(index, 'name', e.target.value)}
                      placeholder="نام سایز (مثلاً: کوچک)"
                      className="col-span-5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
                    />
                  )}
                  <input
                    type="number"
                    placeholder="قیمت (تومان)"
                    value={size.price}
                    onChange={(e) => handleSizeChange(index, 'price', e.target.value)}
                    className="col-span-6 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
                  />
                  <button type="button" onClick={() => removeSize(index)} className="col-span-1 p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg cursor-pointer flex justify-center">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {formData.sizes?.length === 0 && <p className="text-xs text-gray-400 text-center py-2">هیچ سایزی تعریف نشده است — حداقل یک سایز لازم است.</p>}
            </div>
          </div>
        )}

        {/* مواد اولیه */}
        <div className="border-t border-gray-100 dark:border-white/5 pt-6">
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-1">محتویات محصول (اجباری)</label>
          <p className="text-[11px] text-red-400 mb-2 font-DanaMedium">حداقل باید نام ۲ ماده اولیه وارد شود.</p>

          <div className="flex flex-wrap gap-2 mb-3">
            {formData.ingredients?.map((ing, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary text-xs">
                {ing}
                <button type="button" onClick={() => setFormData(prev => ({ ...prev, ingredients: prev.ingredients?.filter((_, idx) => idx !== i) || [] }))} className="hover:opacity-70">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={ingredientInput}
              onChange={(e) => setIngredientInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              placeholder="نام مواد اولیه را تایپ کنید..."
              className="flex-1 px-4 py-2 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-sm"
            />
            <button
              type="button"
              onClick={handleAddIngredient}
              className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-1"
            >
              <Plus size={16} /> افزودن
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Link to="/admin/products" className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium text-center cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition">انصراف</Link>
          <button type="submit" disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50">
            {isSubmitting ? 'در حال ذخیره...' : 'ذخیره محصول'}
          </button>
        </div>
      </div>

      {/* پیش‌نمایش زنده */}
      <div className="lg:col-span-1">
        <div className="sticky top-6 space-y-4">
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white text-center">پیش‌نمایش زنده</h3>
          <div className="p-4 bg-gray-100 dark:bg-[#1a0a0e] rounded-2xl">
            <ProductCard product={previewProduct} />
          </div>
          <div className="bg-white dark:bg-[#2a1015] p-4 rounded-xl border border-gray-200 dark:border-[#3a151c] text-center">
            <p className="text-xs text-gray-400 mb-1">{isSizesOn ? 'قیمت اولین سایز:' : 'قیمت نهایی پایه:'}</p>
            <p className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">{formatPrice(previewFinalPrice)} تومان</p>
          </div>
        </div>
      </div>

    </form>
  )
}