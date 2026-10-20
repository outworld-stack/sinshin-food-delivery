import { useCallback, useRef } from 'react'
import { parsePaymentTarget } from '@sinshin/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '#/i18n'
import { mockPay, retryOrderPayment } from '#/server/checkout'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { navigateToPayment } from '#/lib/payment-navigation'

export function useOrderPaymentRetry(orderId: string) {
  const { t, apiError } = useI18n()
  const showToast = useToastStore((s) => s.showToast)
  const queryClient = useQueryClient()
  const retryInFlight = useRef(false)

  const retryMutation = useMutation({
    mutationFn: () => retryOrderPayment({ orderId }),
    onSuccess: async (res) => {
      const target = res.paymentUrl ? parsePaymentTarget(res.paymentUrl) : null
      if (!target) {
        showToast(apiError(t['dash.orderDetail.pendingRetryNoUrl']), 'error')
        return
      }
      try {
        if (target.method !== 'MOCK') {
          navigateToPayment(res.paymentUrl)
          return
        }
        const result = await mockPay(res.paymentUrl, true)
        showToast(
          result.paymentStatus === 'SUCCESS' ? t['checkout.paySuccess'] : t['checkout.payFailed'],
          result.paymentStatus === 'SUCCESS' ? 'success' : 'error',
        )
      } catch (error) {
        showToast(apiError(error instanceof Error ? error.message : t['common.error']), 'error')
      }
    },
    onError: (error) => {
      showToast(apiError(error.message || t['common.error']), 'error')
    },
    onSettled: () => {
      retryInFlight.current = false
      // A conflict or lost response can mean settlement already committed.
      void queryClient.invalidateQueries({ queryKey: qk.orderDetails(orderId) })
    },
  })

  const handleRetry = useCallback(() => {
    // Close the same-frame double-click window before React renders pending.
    if (retryInFlight.current || retryMutation.isPending) return
    retryInFlight.current = true
    retryMutation.mutate()
  }, [retryMutation])

  return { retryMutation, handleRetry }
}
