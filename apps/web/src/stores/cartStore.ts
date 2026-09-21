// src/stores/cartStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// آیتم سبد فقط آیدی محصول + سایز و تعداد داره (امنیت قیمت تضمین می‌شه)
// هویت هر ردیف = (محصول، سایز) — سایزِ خالی = محصول بدون سایزبندی
export interface CartItem {
	productId: string
	sizeId: string | null
	quantity: number
}

// round-12 — سقف quantity سرور = 99 (menu.routes)؛ کلاینت هم همان را clamp
// می‌کنه وگرنه رسیدن به 100 یعنی 422 خاموشِ کل درخواست سبد (۱ عدد / ۰ تومان)
export const CART_MAX_QTY = 99

const clampQty = (q: number): number =>
	Math.min(CART_MAX_QTY, Math.max(1, Math.floor(q) || 1))

// round-12 — sanitize ردیف‌های persist شده: productId باید UUID باشد
// (ردیف‌های legacy/زباله با 422 کل سبد را می‌کشتند) و quantity در بازه
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function sanitizeItems(items: unknown): CartItem[] {
	if (!Array.isArray(items)) return []
	const seen = new Set<string>()
	const out: CartItem[] = []
	for (const raw of items) {
		if (!raw || typeof raw !== 'object') continue
		const it = raw as {
			productId?: unknown
			sizeId?: unknown
			quantity?: unknown
		}
		if (typeof it.productId !== 'string' || !UUID_RE.test(it.productId))
			continue
		const sizeId =
			typeof it.sizeId === 'string' && UUID_RE.test(it.sizeId)
				? it.sizeId
				: null
		const key = `${it.productId}|${sizeId ?? ''}`
		if (seen.has(key)) continue // ادغام دوتایی‌های legacy
		seen.add(key)
		out.push({
			productId: it.productId,
			sizeId,
			quantity: clampQty(Number(it.quantity)),
		})
	}
	return out.slice(0, 100) // همان سقف سرور
}

// کلید یکتای هر ردیف
export const cartItemKey = (productId: string, sizeId: string | null): string =>
	`${productId}|${sizeId ?? ''}`

interface CartState {
	items: CartItem[]
	addItem: (
		productId: string,
		quantity?: number,
		sizeId?: string | null,
	) => void
	updateQuantity: (key: string, quantity: number) => void
	removeItem: (key: string) => void
	removeItems: (keys: string[]) => void
	clearCart: () => void
	getTotalItems: () => number
}

export const useCartStore = create<CartState>()(
	persist(
		(set, get) => ({
			items: [],

			// افزودن — ادغام فقط وقتی محصول و سایز هر دو یکسان باشن
			addItem: (productId, quantity = 1, sizeId = null) =>
				set((state) => {
					const key = cartItemKey(productId, sizeId)
					const existing = state.items.find(
						(i) => cartItemKey(i.productId, i.sizeId) === key,
					)
					if (existing) {
						return {
							items: state.items.map((i) =>
								cartItemKey(i.productId, i.sizeId) === key
									? { ...i, quantity: clampQty(i.quantity + quantity) }
									: i,
							),
						}
					}
					return {
						items: [
							...state.items,
							{ productId, sizeId, quantity: clampQty(quantity) },
						],
					}
				}),

			// آپدیت تعداد بر اساس کلید ردیف
			updateQuantity: (key, quantity) =>
				set((state) => ({
					items: state.items.map((i) =>
						cartItemKey(i.productId, i.sizeId) === key
							? { ...i, quantity: clampQty(quantity) }
							: i,
					),
				})),

			removeItem: (key) =>
				set((state) => ({
					items: state.items.filter(
						(i) => cartItemKey(i.productId, i.sizeId) !== key,
					),
				})),

			// round-12 — حذف دسته‌ای (پاک‌سازی اقلام نامعتبر در یک ترنزکشن استور)
			removeItems: (keys) =>
				set((state) => ({
					items: state.items.filter(
						(i) => !keys.includes(cartItemKey(i.productId, i.sizeId)),
					),
				})),

			clearCart: () => set({ items: [] }),

			getTotalItems: () => {
				return get().items.reduce((total, item) => total + item.quantity, 0)
			},
		}),
		{
			name: 'sinshin-cart-storage',
			skipHydration: true,
			// round-12 — نسخهٔ ۱ بدون migrate بود؛ ردیف‌های مرده (محصول حذف‌شده /
			// id غیر-UUID / quantity خارج بازه) برای همیشه می‌ماندند چون مسیر
			// سفارشِ مهمان هرگز سبد را نمی‌شوید. migrate = همان sanitize
			version: 2,
			migrate: (persisted) => {
				const state = persisted as { items?: unknown } | undefined
				return { items: sanitizeItems(state?.items) }
			},
		},
	),
)

if (typeof window !== 'undefined') {
	useCartStore.persist.rehydrate()
}
