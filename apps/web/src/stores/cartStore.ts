// src/stores/cartStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// آیتم سبد فقط آیدی محصول + سایز و تعداد داره (امنیت قیمت تضمین می‌شه)
// هویت هر ردیف = (محصول، سایز) — سایزِ خالی = محصول بدون سایزبندی
export interface CartItem {
  productId: string;
  sizeId: string | null;
  quantity: number;
}

// کلید یکتای هر ردیف
export const cartItemKey = (productId: string, sizeId: string | null): string =>
  `${productId}|${sizeId ?? ''}`;

interface CartState {
  items: CartItem[];
  addItem: (productId: string, quantity?: number, sizeId?: string | null) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
  getTotalItems: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      // افزودن — ادغام فقط وقتی محصول و سایز هر دو یکسان باشن
      addItem: (productId, quantity = 1, sizeId = null) =>
        set((state) => {
          const key = cartItemKey(productId, sizeId);
          const existing = state.items.find(i => cartItemKey(i.productId, i.sizeId) === key);
          if (existing) {
            return {
              items: state.items.map(i =>
                cartItemKey(i.productId, i.sizeId) === key
                  ? { ...i, quantity: i.quantity + quantity }
                  : i
              ),
            };
          }
          return { items: [...state.items, { productId, sizeId, quantity }] };
        }),

      // آپدیت تعداد بر اساس کلید ردیف
      updateQuantity: (key, quantity) =>
        set((state) => ({
          items: state.items.map(i =>
            cartItemKey(i.productId, i.sizeId) === key
              ? { ...i, quantity: Math.max(1, quantity) }
              : i
          ),
        })),

      removeItem: (key) =>
        set((state) => ({
          items: state.items.filter(i => cartItemKey(i.productId, i.sizeId) !== key),
        })),

      clearCart: () => set({ items: [] }),

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },
    }),
    {
      name: 'sinshin-cart-storage',
      skipHydration: true,
    }
  )
);

if (typeof window !== 'undefined') {
  useCartStore.persist.rehydrate()
}