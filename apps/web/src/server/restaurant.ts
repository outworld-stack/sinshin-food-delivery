import type { RestaurantHoursDto } from '@sinshin/shared'
import { getJson } from '#/lib/api-fetch'

export function getRestaurantHours(): Promise<RestaurantHoursDto> {
	return getJson<RestaurantHoursDto>('/menu/restaurant-hours')
}
