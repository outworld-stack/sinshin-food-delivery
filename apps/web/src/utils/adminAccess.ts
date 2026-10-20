import type { SubAdminPermissionsDto } from '@sinshin/shared'
import type { QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '#/stores/authStore'
import { admin2SessionOptions } from '#/utils/queryOptions'

const ADMIN2_SECTIONS = [
	'/admin/admin2', '/admin/orders', '/admin/couriers', '/admin/products',
	'/admin/users', '/admin/settings', '/admin/notifications', '/admin/articles',
]

function inSection(path: string, section: string): boolean {
	return path === section || path.startsWith(`${section}/`)
}

export function isAdminPathAllowed(role: string | null, path: string): boolean {
	if (role === 'admin') {
		return !inSection(path, '/admin/admin2') || inSection(path, '/admin/admin2/live-orders')
	}
	return role === 'admin2' && ADMIN2_SECTIONS.some(section => inSection(path, section))
}

/** Load permissions before protected route prefetches, so denied pages can render their access message. */
export async function hasAdminPermission(queryClient: QueryClient, permission: keyof SubAdminPermissionsDto): Promise<boolean> {
	const { role } = useAuthStore.getState()
	if (role === 'admin') return true
	if (role !== 'admin2') return false
	const session = await queryClient.query(admin2SessionOptions)
	return session.isAdmin2LoggedIn && session.admin?.permissions[permission] === true
}
