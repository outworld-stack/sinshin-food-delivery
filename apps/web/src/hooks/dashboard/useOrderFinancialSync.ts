import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { UserOrder } from '@sinshin/shared'
import { qk } from '#/utils/queryKeys'

/** Callback/poll results can settle or refund money after checkout has left. */
export function useOrderFinancialSync(
  orderId: string,
  status: UserOrder['status'] | undefined,
  paymentStatus: UserOrder['paymentStatus'] | undefined,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!status || !paymentStatus) return
    // Depend on the state snapshot, not the polling response object: repeated
    // reads of the same order must not repeatedly refetch the whole profile.
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: qk.userProfile }),
      queryClient.invalidateQueries({ queryKey: qk.myOrdersPrefix }),
      queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix }),
    ])
  }, [queryClient, orderId, status, paymentStatus])
}
