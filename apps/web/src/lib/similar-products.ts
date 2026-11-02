import type { Product, SimilarProductsDto } from '@sinshin/shared'

export interface SimilarProductsOptions {
	context?: 'detail' | 'cart'
	exclude?: readonly string[]
}

/** Match the API bound and canonicalize both request URLs and query keys. */
export function similarProductExclusions(ids: readonly string[] = []): string[] {
	return [...new Set(ids)].sort().slice(0, 50)
}

// Each anchor returns up to eight candidates. This offset prevents a single
// first-place result from overwhelming agreement between independent anchors.
const RRF_OFFSET = 8

/** Fuse eligible cart complements; loading/failed anchors contribute no votes. */
export function mergeSimilarCandidates(
	results: ReadonlyArray<SimilarProductsDto | null | undefined>,
	opts: { excludeIds: ReadonlySet<string>; limit: number },
): Product[] {
	const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 0
	if (limit === 0) return []
	const candidates = new Map<string, { product: Product; ranks: number[] }>()
	for (const result of results) {
		if (!result) continue
		const seen = new Set<string>()
		let rank = 0
		for (const product of result.products) {
			if (seen.has(product.id)) continue
			seen.add(product.id)
			if (
				opts.excludeIds.has(product.id) ||
				product.status !== 'ACTIVE' ||
				product.isAvailable === false ||
				product.purchasable === false
			) continue
			// Rank after filtering: cart contents and unavailable products do not
			// penalize the remaining useful candidates from this anchor.
			rank++
			const entry = candidates.get(product.id)
			if (entry) entry.ranks.push(rank)
			else candidates.set(product.id, { product, ranks: [rank] })
		}
	}
	return [...candidates.values()]
		.map(({ product, ranks }) => ({
			product,
			// Canonical addition order also avoids floating-point tie drift when
			// the same anchors are supplied in a different order.
			score: ranks
				.sort((a, b) => a - b)
				.reduce((sum, rank) => sum + 1 / (RRF_OFFSET + rank), 0),
		}))
		.sort((a, b) =>
			b.score - a.score ||
			(a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0),
		)
		.slice(0, limit)
		.map(({ product }) => product)
}
