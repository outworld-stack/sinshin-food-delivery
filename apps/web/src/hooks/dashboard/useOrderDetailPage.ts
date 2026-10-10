// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/hooks/dashboard/useOrderDetailPage.ts
// تغییر: بعد از تایید تحویل، پریفکس my-orders هم نامعتبر شود
// ═══════════════════════════════════════════════════════════════

// src/hooks/dashboard/useOrderDetailPage.ts
import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { confirmOrderDelivery, submitOrderFeedback } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useI18n } from '#/i18n'

// --- هوک: تایید تحویل + ارسال نظر (نظر به‌ازای هر محصول) ---
export function useOrderDetailPage(orderId: string) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const { t, apiError } = useI18n()
  const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)

  // آیتم ۱۶: تایید تحویل
  const confirmDeliveryMutation = useMutation({
    mutationFn: () => confirmOrderDelivery({ data: { orderId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.orderDetails(orderId) })
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      // stage-56 — آمار/ردیف‌های «سفارشات من» از سرور → پریفکس my-orders
      queryClient.invalidateQueries({ queryKey: qk.myOrdersPrefix })
      setActiveOrderId(null)
      showToast(t['dash.orders.deliverToast'])
    },
  })

  // آیتم ۹: ارسال نظر — محصول + متن
  const submitFeedbackMutation = useMutation({
    mutationFn: (data: { productId: string; feedback: string }) =>
      submitOrderFeedback({ data: { orderId, ...data } }),
    onSuccess: (res) => {
      if (!res.success) { showToast(apiError(res.message ?? t['common.error']), 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.orderReviewed(orderId) })
      // پریفکس — بازخورد سفارش به نظرات محصول تبدیل می‌شه → همه‌ی product-reviews رفرش
      queryClient.invalidateQueries({ queryKey: qk.productReviewsPrefix })
      showToast(t['dash.feedback.thanksToast'])
    },
  })

  const handleConfirmDelivery = useCallback(() => {
    confirmDeliveryMutation.mutate()
  }, [confirmDeliveryMutation])

  const handleSubmitFeedback = useCallback((productId: string, feedback: string) => {
    submitFeedbackMutation.mutate({ productId, feedback })
  }, [submitFeedbackMutation])

  return {
    confirmDeliveryMutation,
    handleConfirmDelivery,
    submitFeedbackMutation,
    handleSubmitFeedback,
  }
}