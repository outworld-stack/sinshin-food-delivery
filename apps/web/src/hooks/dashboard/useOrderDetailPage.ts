// src/hooks/dashboard/useOrderDetailPage.ts
import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { confirmOrderDelivery, submitOrderFeedback } from '#/server/user'
import { qk } from '#/utils/queryKeys'

// --- هوک: تایید تحویل + ارسال نظر (نظر به‌ازای هر محصول) ---
export function useOrderDetailPage(orderId: string) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)

  // آیتم ۱۶: تایید تحویل
  const confirmDeliveryMutation = useMutation({
    mutationFn: () => confirmOrderDelivery({ data: { orderId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.orderDetails(orderId) })
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      setActiveOrderId(null)
      showToast('تحویل سفارش ثبت شد')
    },
  })

  // آیتم ۹: ارسال نظر — محصول + متن
  const submitFeedbackMutation = useMutation({
    mutationFn: (data: { productId: string; feedback: string }) =>
      submitOrderFeedback({ data: { orderId, ...data } }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.orderReviewed(orderId) })
      // پریفکس — بازخورد سفارش به نظرات محصول تبدیل می‌شه → همه‌ی product-reviews رفرش
      queryClient.invalidateQueries({ queryKey: qk.productReviewsPrefix })
      showToast('از اینکه نظرتان را با ما به اشتراک گذاشتید ممنونیم')
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