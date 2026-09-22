// src/hooks/admin/usePermissions.ts
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '#/stores/authStore'
import type { SubAdminPermissions } from '#/server/admin'
import { admin2SessionOptions } from '#/utils/queryOptions'

const FULL_PERMISSIONS: SubAdminPermissions = {
  productsRead: true, productsWrite: true,
  usersRead: true, usersWrite: true,
  couriersRead: true, couriersWrite: true,
  mainCategoriesRead: true, mainCategoriesWrite: true,
  orderDetailsRead: true,
  // round-13 — ادمین اصلی همیشه می‌تواند بسته/باز موقت را toggle کند
  canToggleTemporaryClose: true,
}

const EMPTY_PERMISSIONS: SubAdminPermissions = {
  productsRead: false, productsWrite: false,
  usersRead: false, usersWrite: false,
  couriersRead: false, couriersWrite: false,
  mainCategoriesRead: false, mainCategoriesWrite: false,
  orderDetailsRead: false,
}

export function usePermissions() {
  const role = useAuthStore((s) => s.role)

  // سشن ادمین۲ — فکتوری مشترک با AdminLayout و داشبورد (یک کش)
  const { data: session, isLoading: sessionLoading } = useQuery({
    ...admin2SessionOptions,
    enabled: role === 'admin2',
  })

  const permissions: SubAdminPermissions = role === 'admin'
    ? FULL_PERMISSIONS
    : role === 'admin2'
      ? (session?.admin?.permissions ?? EMPTY_PERMISSIONS)
      : EMPTY_PERMISSIONS

  const isMainAdmin = role === 'admin'
  const isAdmin2 = role === 'admin2'
  const isChecking = role === 'admin2' && sessionLoading

  return { permissions, isMainAdmin, isAdmin2, isChecking }
}