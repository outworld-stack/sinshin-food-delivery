import { isNeshanCoord } from './neshanLinks'

export interface MapPoint {
	lat: number
	lng: number
}

export function validMapPoint(
	point: MapPoint | null | undefined,
): MapPoint | null {
	return point && isNeshanCoord(point.lat, point.lng) ? point : null
}

/** MapLibre allows wrapped world copies; persist their canonical longitude. */
export function normalizeMapPoint(point: MapPoint): MapPoint | null {
	if (!Number.isFinite(point.lng)) return null
	const lng = ((((point.lng + 180) % 360) + 360) % 360) - 180
	return validMapPoint({ lat: point.lat, lng })
}

/** Reject truncated, overflowing and out-of-range provider polylines. */
export function decodePolyline(encoded: string): Array<[number, number]> {
	if (encoded.length > 200_000) return []
	const points: Array<[number, number]> = []
	let index = 0
	let lat = 0
	let lng = 0
	function delta(): number | null {
		let result = 0
		let shift = 0
		while (index < encoded.length && shift <= 30) {
			const byte = encoded.charCodeAt(index++) - 63
			if (byte < 0 || byte > 63) return null
			result += (byte & 31) * 2 ** shift
			if (byte < 32) return result % 2 ? -(result + 1) / 2 : result / 2
			shift += 5
		}
		return null
	}
	while (index < encoded.length) {
		const dLat = delta()
		const dLng = delta()
		if (dLat === null || dLng === null) return []
		lat += dLat
		lng += dLng
		if (!isNeshanCoord(lat / 1e5, lng / 1e5)) return []
		points.push([lat / 1e5, lng / 1e5])
	}
	return points
}

export function lineFeature(points: Array<[number, number]>) {
	return {
		type: 'Feature',
		properties: {},
		geometry: {
			type: 'LineString',
			coordinates: points.map(([lat, lng]) => [lng, lat]),
		},
	}
}

export function mapBounds(
	points: Array<[number, number]>,
): [[number, number], [number, number]] {
	let minLat = Infinity,
		minLng = Infinity,
		maxLat = -Infinity,
		maxLng = -Infinity
	for (const [lat, lng] of points) {
		minLat = Math.min(minLat, lat)
		minLng = Math.min(minLng, lng)
		maxLat = Math.max(maxLat, lat)
		maxLng = Math.max(maxLng, lng)
	}
	return [
		[minLng, minLat],
		[maxLng, maxLat],
	]
}
