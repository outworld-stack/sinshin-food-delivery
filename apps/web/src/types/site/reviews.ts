// src/types/site/reviews.ts

// نظر تأییدشده محصول که در سایت نمایش داده می‌شه
export interface ProductReview {
  id: string
  orderId: string
  productId: string
  productName: string
  firstName?: string | null
  lastName?: string | null
  phone: string
  comment: string
  date: Date | string
  status: 'pending' | 'approved' | 'rejected'
}