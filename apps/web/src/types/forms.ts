// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 41 از 49
// مسیر مقصد: apps/web/src/types/forms.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/forms.ts

// فیلدهای الزامی — فرم‌ها همیشه مقدار اولیه‌ی کامل می‌سازن؛
// اختیاری بودن تاریخی بود و مانع تایپ‌شدن میوتیشن‌ها (data: any) می‌شد.
// نتیجه: createArticle/createAdminProduct الان ورودی کاملاً تایپ‌دار می‌گیرن.
import type { Product } from '@sinshin/shared'

export interface ArticleFormData {
  title: string;
  author?: string; // اختیاری — سرور/فرم پیش‌فرض «سین شین» می‌ذارن (به سرور ارسال نمی‌شه)
  excerpt: string;
  content: string;
  profileImage: string;
  galleryImages: string[];
  categoryId: string;
  // تایپ Article این فیلد رو اختیاری داره؛ فرم همیشه null می‌ذاره —
  // مسیرها موقع ارسال با ?? null نرمال می‌کنن (اسکیمای سرور null می‌خواد)
  subCategoryId?: string | null;
  processes: { title: string, items: string[] }[];
  // ═══ round-34 — محتوای عربی (خالی = حذف ترجمه = بازگشت به فارسی) ═══
  titleAr: string;
  excerptAr: string;
  contentAr: string;
  processesAr: { title: string, items: string[] }[];
  /** پرچم «ترجمه‌ی خودکار» رکورد (بج فرم — رارد ۳۵) */
  arAuto?: boolean;
}

export interface ArticleFormProps {
  initialData?: ArticleFormData;
  onSubmit: (data: ArticleFormData) => void;
  isSubmitting: boolean;
}

export interface ProductFormData {
  name: string;
  description: string;
  originalPrice: number;
  discountPercentage: number;
  prepTime: number;
  // stage-10: هزینه بسته‌بندی هر واحد — پیک و بیرون‌بر؛ سرو در محل ندارد
  packagingCost: number;
  categoryId: string;
  profileImage: string;
  galleryImages: string[];
  sizesEnabled: boolean;
  ingredients: string[];
  sizes: { name: string, nameAr: string, price: number }[];
  // ═══ round-34 — محتوای عربی (خالی = حذف ترجمه = بازگشت به فارسی) ═══
  nameAr: string;
  descriptionAr: string;
  /** هر خط = یک ماده اولیه (مثل ادیتور قوانین) — خالی = بازگشت به فارسی */
  ingredientsArText: string;
}

export interface ProductFormProps {
  initialData?: Product | null
  onSubmit: (data: ProductFormData) => void;
  isSubmitting: boolean;
}