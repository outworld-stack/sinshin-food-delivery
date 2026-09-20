// src/types/forms.ts

// فیلدهای الزامی — فرم‌ها همیشه مقدار اولیه‌ی کامل می‌سازن؛
// optional بودن تاریخی بود و مانع تایپ‌شدن mutation ها (data: any) می‌شد.
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
  // تایپ Article این فیلد رو optional داره؛ فرم همیشه null می‌ذاره —
  // مسیرها موقع ارسال با ?? null نرمال می‌کنن (اسکیمای سرور null می‌خواد)
  subCategoryId?: string | null;
  processes: { title: string, items: string[] }[];
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
  categoryId: string;
  profileImage: string;
  galleryImages: string[];
  sizesEnabled: boolean;
  ingredients: string[];
  sizes: { name: string, price: number }[];
}

export interface ProductFormProps {
  initialData?: Product | null
  onSubmit: (data: ProductFormData) => void;
  isSubmitting: boolean;
}