import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReferralRowDto, WalletTransactionDto } from '@sinshin/shared'
import { qk } from '../src/utils/queryKeys'

let search = { txSort: 'newest', txPage: 2, txLimit: 5, refPage: 3, refLimit: 5 }
const toasts: string[] = []
let retryCalls = 0
let retry: () => Promise<{ paymentUrl: string; displayId: string }>
let pay: () => Promise<{ paymentStatus: 'SUCCESS' | 'FAILED'; orderDisplayId: string }> = async () => ({ paymentStatus: 'SUCCESS', orderDisplayId: 'order-a' })

mock.module('@tanstack/react-router', () => ({
  useSearch: () => search,
  useNavigate: () => () => {},
  Link: ({ children }: { children: React.ReactNode }) => createElement('a', null, children),
}))
const i18n = {
  t: new Proxy({}, { get: (_target, key) => String(key) }),
  fmt: { num: String, price: String, date: String },
  apiError: (message: string) => message,
}
mock.module('#/i18n', () => ({
  useI18n: () => i18n, useI18nSafe: () => i18n,
  tpl: (value: string, fields: Record<string, string>) => `${value} ${fields.n ?? ''}`,
}))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast: (message: string) => toasts.push(message) }) }))
mock.module('#/server/checkout', () => ({
  retryOrderPayment: async ({ orderId }: { orderId: string }) => {
    assert.equal(orderId, 'order-a')
    retryCalls++
    return retry()
  },
  mockPay: async () => pay(),
}))
const location = { href: 'https://sinshin.test/dashboard/orders/order-a' }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })

const { useWalletPage } = await import('../src/hooks/dashboard/useWalletPage')
const { TransactionsList } = await import('../src/components/dashboard/wallet/TransactionsList')
const { ReferralsList } = await import('../src/components/dashboard/wallet/ReferralsList')
const { useOrderPaymentRetry } = await import('../src/hooks/dashboard/useOrderPaymentRetry')

const transactions: WalletTransactionDto[] = Array.from({ length: 12 }, (_, i) => ({
  id: `tx-${i}`, amount: i + 1, date: new Date(2026, 0, i + 1),
  type: i % 2 ? 'WITHDRAW' : 'DEPOSIT', description: `Transaction ${i}`,
}))
const referrals = Array.from({ length: 12 }, (_, i) => ({
  id: `user-${i}`, registerDate: new Date(2026, 0, i + 1), phone: '09123456789',
  totalOrders: i, totalSpent: i * 100, myProfit: i * 10,
})) as ReferralRowDto[]
function renderWallet() {
  let page!: ReturnType<typeof useWalletPage>
  function Probe() { page = useWalletPage(transactions, referrals); return null }
  renderToStaticMarkup(createElement(Probe))
  return page
}
let wallet = renderWallet()
assert.equal(wallet.txTotalItems, 12)
assert.equal(wallet.refTotalItems, 12)
assert.equal(wallet.visibleTransactions.length, 5)
assert.equal(wallet.visibleReferrals.length, 2)
assert.equal(transactions[0]!.id, 'tx-0', 'sorting must not mutate cached ledger')
const txMarkup = renderToStaticMarkup(createElement(TransactionsList, {
  transactions: wallet.visibleTransactions, currentSort: 'newest',
  currentPage: wallet.txCurrentPage, totalPages: wallet.txTotalPages,
  totalItems: wallet.txTotalItems, itemsPerPage: 5,
  onSortChange() {}, onPageChange() {}, onItemsPerPageChange() {},
}))
assert(txMarkup.includes('pagination.showing 6 pagination.to 10 pagination.of 12'), 'page range uses full filtered history')
const refMarkup = renderToStaticMarkup(createElement(ReferralsList, {
  referrals: wallet.visibleReferrals, currentPage: wallet.refCurrentPage,
  totalPages: wallet.refTotalPages, totalItems: wallet.refTotalItems, allReferralsCount: 205,
  itemsPerPage: 5, onPageChange() {}, onItemsPerPageChange() {},
}))
assert(refMarkup.includes('pagination.showing 11 pagination.to 12 pagination.of 12'))
assert(refMarkup.includes('dash.wallet.recentReferralsHint 12'), 'bounded referral detail is explicit')
search = { ...search, txSort: 'income', txPage: 9, txLimit: 10 }
wallet = renderWallet()
assert.equal(wallet.txTotalItems, 6)
assert.equal(wallet.txCurrentPage, 1)
const onePage = renderToStaticMarkup(createElement(TransactionsList, {
  transactions: wallet.visibleTransactions, currentSort: 'income',
  currentPage: wallet.txCurrentPage, totalPages: wallet.txTotalPages,
  totalItems: wallet.txTotalItems, itemsPerPage: 10,
  onSortChange() {}, onPageChange() {}, onItemsPerPageChange() {},
}))
assert(onePage.includes('value="5"'), 'page-size control remains available after choosing a larger size')

// Exercise the actual React Query mutation callbacks and ref guard, with only
// HTTP/payment boundaries mocked. No gateway or database request is made.
const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } })
let payment!: ReturnType<typeof useOrderPaymentRetry>
function RetryProbe() { payment = useOrderPaymentRetry('order-a'); return null }
renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(RetryProbe)))
function awaitSettlement() {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Mutation did not settle')) }, 2_000)
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && ['success', 'error'].includes(event.mutation.state.status)) {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
}
function prepare() {
  client.setQueryData(qk.orderDetails('order-a'), { status: 'PENDING_PAYMENT' })
  return awaitSettlement()
}
let complete!: (value: { paymentUrl: string; displayId: string }) => void
retry = () => new Promise((resolve) => { complete = resolve })
let settled = prepare()
payment.handleRetry()
payment.handleRetry()
await Bun.sleep(0)
assert.equal(retryCalls, 1, 'same-frame retry clicks issue only one request')
complete({ paymentUrl: '/api/payments/mock/id', displayId: 'order-a' })
await settled
assert(toasts.includes('checkout.paySuccess'))
assert.equal(client.getQueryState(qk.orderDetails('order-a'))?.isInvalidated, true)

for (const outcome of ['conflict', 'lost-mock-response', 'missing-url', 'gateway'] as const) {
  retry = async () => {
    if (outcome === 'conflict') throw new Error('Payment already settled')
    return { paymentUrl: outcome === 'missing-url' ? '' : outcome === 'gateway' ? 'https://gateway.test/pay/a' : '/api/payments/mock/id', displayId: 'order-a' }
  }
  pay = async () => { throw new Error('Mock response lost') }
  settled = prepare()
  const priorCalls: number = retryCalls
  payment.handleRetry()
  await settled
  assert.equal(retryCalls, priorCalls + 1, 'settlement releases the retry guard')
  assert.equal(client.getQueryState(qk.orderDetails('order-a'))?.isInvalidated, true, `${outcome} immediately refreshes order state`)
}
assert(toasts.includes('Payment already settled'))
assert(toasts.includes('Mock response lost'))
assert(toasts.includes('dash.orderDetail.pendingRetryNoUrl'))
assert.equal(location.href, 'https://gateway.test/pay/a')
client.clear()
console.log('Wallet browser regressions passed: filtered pagination totals, page-size recovery, bounded referrals, retry double-click guard, conflict/lost-response refresh and gateway redirect.')
