import type { RestaurantHoursDto } from './contracts'

export const RESTAURANT_TIME_PATTERN = '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
const timePattern = new RegExp(RESTAURANT_TIME_PATTERN)

export const DEFAULT_RESTAURANT_HOURS: Readonly<RestaurantHoursDto> = Object.freeze({
  openingTime: '11:00',
  closingTime: '00:00',
})

/** Overnight ranges are valid; equal times have no unambiguous duration. */
export function isRestaurantHours(value: unknown): value is RestaurantHoursDto {
  if (!value || typeof value !== 'object') return false
  const { openingTime, closingTime } = value as Partial<RestaurantHoursDto>
  return typeof openingTime === 'string' && openingTime.length === 5 && timePattern.test(openingTime)
    && typeof closingTime === 'string' && closingTime.length === 5 && timePattern.test(closingTime)
    && openingTime !== closingTime
}
