// src/hooks/shared/useActiveOrder.ts
import { useEffect } from 'react'
import { useAuthStore } from '#/stores/authStore'
import type { UserOrder } from '@sinshin/shared'

// سفارش فعال کاربر — یک‌جا (قبلاً تو هدر و لایوت داشبورد کپی بود)
export function useActiveOrder(orders: UserOrder[] | undefined) {
  const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)

  useEffect(() => {
    if (orders) {
      const active = orders.find(o => o.status === 'PAID' || o.status === 'CONFIRMED' || o.status === 'ON_THE_WAY')
      setActiveOrderId(active?.id ?? null)
    }
  }, [orders, setActiveOrderId])
}