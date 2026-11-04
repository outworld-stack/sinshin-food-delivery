import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { CouponWithConditionsDto, StaffInvoice } from '@sinshin/shared'

// Execute the actual form handlers with persistent hook state, as the other
// client regression scripts do, without a browser or a live API.
const react = { ...await import('react') }
let cells: unknown[] = []
let cursor = 0
mock.module('react', () => ({
  ...react,
  memo: (component: unknown) => component,
  useCallback: (callback: unknown) => callback,
  useState<T>(initial: T | (() => T)) {
    const index = cursor++
    if (!(index in cells)) cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
    return [cells[index], (next: T | ((previous: T) => T)) => {
      cells[index] = typeof next === 'function' ? (next as (previous: T) => T)(cells[index] as T) : next
    }]
  },
}))
const productId = '00000000-0000-4000-8000-000000000001'
const categoryId = '00000000-0000-4000-8000-000000000002'
mock.module('#/utils/queryOptions', () => ({
  adminCategoriesOptions: { category: true },
  adminProductsOptions: (input: unknown) => ({ input }),
}))
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: { category?: boolean }) => ({
    data: options.category ? [{ id: categoryId, name: 'پیتزا' }] : { products: [{ id: productId, name: 'پیتزا قارچ' }] },
  }),
}))
mock.module('#/components/shared/PersianDatePicker', () => ({ PersianDatePicker: () => null }))
const toasts: string[] = []
mock.module('#/stores/toastStore', () => ({
  useToastStore: (select: (state: { showToast: (message: string) => void }) => unknown) => select({ showToast: (message) => toasts.push(message) }),
}))
const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
mock.module('#/lib/api-fetch', () => ({
  authJson: async (path: string, method: string, body: Record<string, unknown>) => {
    requests.push({ path, method, body })
    return { success: true }
  },
}))
const { CouponForm } = await import('../src/components/admin/coupons/CouponForm')
const { createCoupon, updateCoupon } = await import('../src/server/coupons')
type Payload = Parameters<Parameters<typeof CouponForm>[0]['onSubmit']>[0]
type Element = { type: unknown; props: Record<string, any> }
let tree: unknown
let initialData: CouponWithConditionsDto | undefined
const saves: Payload[] = []
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as Element
  return [node, ...nodes(node.props.children)]
}
function render() {
  cursor = 0
  tree = CouponForm({ initialData, onSubmit: (data) => saves.push(data), onCancel() {}, isSubmitting: false, submitLabel: 'ذخیره' })
}
function reset(data?: CouponWithConditionsDto) {
  cells = []
  initialData = data
  render()
}
function find(predicate: (node: Element) => boolean) {
  const node = nodes(tree).find(predicate)
  assert(node, 'expected form control exists')
  return node
}
const control = (label: string) => find((node) => node.props['aria-label'] === label)
function change(node: Element, value: string) {
  node.props.onChange({ target: { value } })
  render()
}
function submit() { find((node) => node.type === 'button' && node.props.children === 'ذخیره').props.onClick() }
function addRule() {
  find((node) => node.type === 'button' && String(node.props.children).includes('افزودن شرط')).props.onClick()
  render()
}

reset()
change(find((node) => node.props.id === 'coupon-code'), 'WELCOME')
assert.equal(control('محدوده اعمال تخفیف').props.value, 'ALL_PRODUCTS')
submit()
assert.equal(saves.at(-1)?.conditionMode, 'AND')
assert.equal(saves.at(-1)?.discountScope, 'ALL_PRODUCTS')
assert.equal(saves.at(-1)?.discountCategoryId, null)
assert.equal(saves.at(-1)?.discountProductId, null)
await createCoupon(saves.at(-1)!)
assert.equal(requests.at(-1)?.body.conditionMode, 'AND')
assert.equal(requests.at(-1)?.body.discountScope, 'ALL_PRODUCTS')

change(control('محدوده اعمال تخفیف'), 'CATEGORY')
const beforeInvalid = saves.length
submit()
assert.equal(saves.length, beforeInvalid, 'a category scope cannot be saved without its target')
assert(toasts.at(-1)?.includes('انتخاب کنید'))
change(control('دسته‌بندی مشمول تخفیف'), categoryId)
submit()
assert.equal(saves.at(-1)?.discountCategoryId, categoryId)
assert.equal(saves.at(-1)?.discountProductId, null)

change(control('محدوده اعمال تخفیف'), 'PRODUCT')
submit()
assert.equal(saves.length, beforeInvalid + 1, 'a product scope cannot be saved without its target')
change(control('محصول مشمول تخفیف'), productId)
submit()
assert.equal(saves.at(-1)?.discountProductId, productId)
assert.equal(saves.at(-1)?.discountCategoryId, null, 'switching scopes clears irrelevant targets on the wire')

find((node) => node.props.label === 'کوپن عمومی (برای همه)').props.onToggle()
render()
assert.equal(control('روش ترکیب شرط‌ها').props.value, 'AND')
addRule()
change(control('نوع شرط'), 'FIRST_PURCHASE')
submit()
assert.equal(saves.at(-1)?.rules[0]?.type, 'FIRST_PURCHASE')
assert.equal(saves.at(-1)?.rules[0]?.value, 0, 'first purchase requires no invented numeric input')
addRule()
const countInput = find((node) => node.type === 'input' && node.props.placeholder === 'مثلا: 5')
change(countInput, '2')
const beforeContradiction = saves.length
submit()
assert.equal(saves.length, beforeContradiction, 'contradictory first-purchase AND previous-purchase conditions are rejected')
assert(toasts.at(-1)?.includes('سازگار نیست'))
change(control('روش ترکیب شرط‌ها'), 'OR')
submit()
assert.equal(saves.length, beforeContradiction + 1)
assert.equal(saves.at(-1)?.conditionMode, 'OR')
await updateCoupon({ id: 'campaign', ...saves.at(-1)! })
assert.equal(requests.at(-1)?.body.conditionMode, 'OR')
assert.equal(requests.at(-1)?.body.discountScope, 'PRODUCT')
assert.equal(requests.at(-1)?.body.discountProductId, productId)
assert.deepEqual(requests.at(-1)?.body.rules, [
  { type: 'FIRST_PURCHASE', value: '0', quantity: undefined },
  { type: 'MIN_ORDERS_COUNT', value: '2', quantity: undefined },
])

const legacy = {
  coupon: { code: 'LEGACY', discountPercentage: 15, maxUses: 0, maxPerUser: 0, isPublic: false, endsAt: null },
  conditions: [{ id: 'condition', type: 'FIRST_PURCHASE', params: {} }],
} as CouponWithConditionsDto
reset(legacy)
assert.equal(control('روش ترکیب شرط‌ها').props.value, 'AND')
assert.equal(control('محدوده اعمال تخفیف').props.value, 'ALL_PRODUCTS')
reset({ ...legacy, coupon: { ...legacy.coupon, conditionMode: 'OR', discountScope: 'CATEGORY', discountCategoryId: categoryId } })
assert.equal(control('روش ترکیب شرط‌ها').props.value, 'OR')
assert.equal(control('دسته‌بندی مشمول تخفیف').props.value, categoryId)

// Printing keeps historical rows unchanged and shows persisted coupon allocation
// for new invoices without subtracting the discount twice from the total.
mock.module('#/lib/receiptCanvas', () => ({ renderSpecToReceiptBitmap: () => { throw new Error('unused') } }))
const { buildInvoicePrintSpecs } = await import('../src/utils/invoicePrint')
const invoice = {
  orderId: 'ord-coupon', date: new Date('2026-11-05T12:00:00Z'), deliveryType: 'DINE_IN',
  items: [
    { name: 'discounted', sizeName: null, quantity: 2, price: 10000, couponDiscountAmount: 3000 },
    { name: 'ordinary', sizeName: null, quantity: 1, price: 5000, couponDiscountAmount: 0 },
  ],
  breakdown: { foodTotal: 25000, discount: 3000, walletDeduction: 2000, deliveryFee: 0, packagingFee: 0, totalAmount: 22000, amountPaidOnline: 20000 },
} as StaffInvoice
const spec = (await buildInvoicePrintSpecs(invoice, ['sales']))[0].spec.sections[0]
assert.deepEqual(spec.tables?.[0].head, ['محصول', 'تعداد', 'جمع (تومان)', 'تخفیف کوپن'])
assert.equal(spec.tables?.[0].rows[0].length, 4)
const historical = { ...invoice, items: invoice.items.map(({ couponDiscountAmount: _, ...item }) => item) }
const legacySpec = (await buildInvoicePrintSpecs(historical, ['sales']))[0].spec.sections[0]
assert.equal(legacySpec.tables?.[0].head.length, 3)

console.log('PASS coupon admin defaults, selectors, validation, API payloads and invoice compatibility')
