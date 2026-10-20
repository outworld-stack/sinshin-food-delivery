import { useMemo } from 'react'
import { validMapPoint, type MapPoint } from '#/utils/mapGeometry'

/** Stable point identity keeps map/GPS effects tied to coordinates, not API object allocation. */
export function useMapPoint(
	point: MapPoint | null | undefined,
): MapPoint | null {
	const lat = point?.lat
	const lng = point?.lng
	return useMemo(
		() =>
			lat === undefined || lng === undefined
				? null
				: validMapPoint({ lat, lng }),
		[lat, lng],
	)
}
