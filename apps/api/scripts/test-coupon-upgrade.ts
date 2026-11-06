/** Real PostgreSQL in an isolated scratch database. Only the PSP and notification
 * transports are stubbed; pricing, delivery, settings, ledger and refunds are real. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import type { CheckoutInput } from '@sinshin/shared'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { DeliveryZoneService } from '../src/domain/delivery/delivery-zone.service'
import { OrderService } from '../src/domain/order/order.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import type { PaymentGateway } from '../src/domain/payment/gateway.types'
import { signState } from '../src/domain/payment/state'
import { SettingsService } from '../src/domain/settings/settings.service'
import { CouponScanJob } from '../src/workers/jobs/coupon-scan.job'
import { CouponNudgeJob } from '../src/workers/jobs/coupon-nudge-notification.job'
import { AppError } from '../src/domain/shared/errors'
import { asCampaignId } from '../src/domain/shared/brand'
import {
  addresses, categories, couponConditions, couponGrants, couponNudges, couponRedemptions,
  coupons, deliveryZones, firstPurchaseReservations, mainCategories, orderItems, orders,
  packagingItems, payments, productCategories, productPackagingItems, products, productSizes, reconcileFindings,
  settings, SETTING_KEYS, users, walletTransactions,
} from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_coupon_upgrade_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let created = false
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }
const validation = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'
const firstCouponUnavailable = (error: unknown) => error instanceof AppError && error.code === 'CONFLICT'
const originalFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in coupon integration tests') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(target.toString(), { max: 12 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(),
    GATEWAY_MODE: 'direct', JWT_SECRET: 'coupon-upgrade-regression-'.repeat(3),
    SITE_URL: 'https://sinshin.example', REFERRAL_PERCENT: '10' })
  const couponService = new CouponService({ db })
  const settingService = new SettingsService({ db, config })
  const zoneService = new DeliveryZoneService({ db, settings: settingService, neshan: {
    distanceMatrix: async () => [[{ status: 'Ok', distanceMeters: 1000, durationSeconds: 60 }]],
  } })
  const service = new OrderService({ db, config, coupons: couponService, settings: settingService,
    zones: zoneService, notifications: { notifyUser: async () => undefined } as never })
  const paymentService = new PaymentService({ db, config, orders: service,
    hub: { publish: () => undefined } as never,
    notifications: { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never })
  let verdict: 'success' | 'failed' | 'indeterminate' = 'indeterminate'
  const verifyCalls = new Map<string, number>()
  const gateway: PaymentGateway = {
    id: 'ZARINPAL', mode: 'direct',
    resumeUrl: input => typeof input.paymentUrl === 'string' ? input.paymentUrl : null,
    init: async input => ({ gatewayRef: `coupon-${input.paymentId}`, paymentUrl: `https://example.test/pay/${input.paymentId}` }),
    verify: async input => {
      verifyCalls.set(input.paymentId!, (verifyCalls.get(input.paymentId!) ?? 0) + 1)
      return { success: verdict === 'success', indeterminate: verdict === 'indeterminate', gatewayRef: input.gatewayRef }
    },
  }
  ;(paymentService as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('ZARINPAL', gateway)
  let serial = 0
  const makeUser = async (age = 10) => (await db.insert(users).values({
    phone: `0933${String(++serial).padStart(7, '0')}`, createdAt: new Date(Date.now() - age * 86_400_000),
  }).returning())[0]!
  const fund = (userId: string, amount: number) => db.insert(walletTransactions).values({
    userId, amount, type: 'DEPOSIT', description: 'Isolated coupon regression funding',
  })
  const balance = (userId: string) => service.walletBalance(db, userId)
  const order = async (displayId: string) => (await db.select().from(orders).where(eq(orders.displayId, displayId)))[0]!
  const campaign = async (id: typeof coupons.$inferSelect.id) => (await db.select().from(coupons).where(eq(coupons.id, id)))[0]!
  const reservation = (userId: string) => db.select().from(firstPurchaseReservations).where(eq(firstPurchaseReservations.userId, userId))
  const ledger = (orderId: typeof orders.$inferSelect.id) => db.select().from(walletTransactions).where(eq(walletTransactions.orderId, orderId)).orderBy(walletTransactions.id)
  const grant = async (couponId: typeof coupons.$inferSelect.id, userId: string) =>
    (await db.select().from(couponGrants).where(and(eq(couponGrants.couponId, couponId), eq(couponGrants.userId, userId))))[0]
  const makeCoupon = async (overrides: Partial<Parameters<CouponService['create']>[0]> = {}) => {
    const result = await couponService.create({ code: `UP${++serial}`, discountPercentage: 20,
      maxUses: 0, maxPerUser: 0, isPublic: !overrides.rules?.length, expiryDate: null, rules: [], ...overrides })
    return campaign(asCampaignId(result.id!))
  }
  const firstRule = { type: 'FIRST_PURCHASE', params: {} }
  const startPayment = async (checkout: Awaited<ReturnType<OrderService['checkout']>>) => {
    assert(checkout.paymentId)
    await paymentService.initiate(checkout.paymentId, 'ZARINPAL', { displayId: checkout.displayId, amount: checkout.amountPaidOnline })
    return () => paymentService.handleCallback('ZARINPAL', { state: signState(checkout.paymentId!, config.jwtSecret) })
  }
  const successful = async (checkout: Awaited<ReturnType<OrderService['checkout']>>) => {
    const callback = await startPayment(checkout)
    verdict = 'success'
    await Promise.all([callback(), callback()])
    assert.equal((await order(checkout.displayId)).paymentStatus, 'SUCCESS')
  }

  const [main] = await db.insert(mainCategories).values({ name: 'Coupon menu', slug: 'coupon-menu' }).returning()
  const [primary, other] = await db.insert(categories).values([
    { mainCategoryId: main!.id, name: 'Eligible category', slug: 'eligible' },
    { mainCategoryId: main!.id, name: 'Other category', slug: 'other' },
  ]).returning()
  const [plain, sized, excluded, cheap] = await db.insert(products).values([
    { categoryId: primary!.id, name: 'Primary discounted', originalPrice: 100_001, discountPercentage: 20, packagingCost: 1000 },
    { categoryId: other!.id, name: 'Secondary sized', originalPrice: 999_999, discountPercentage: 99, sizesEnabled: true, packagingCost: 90_000 },
    { categoryId: other!.id, name: 'Excluded discounted', originalPrice: 50_001, discountPercentage: 10, packagingCost: 500 },
    { categoryId: other!.id, name: 'Rounding fixture', originalPrice: 3 },
  ]).returning()
  const [size] = await db.insert(productSizes).values({ productId: sized!.id, name: 'Large', price: 250_003, discountPercentage: 25 }).returning()
  await db.insert(productCategories).values([
    { productId: sized!.id, categoryId: primary!.id },
    // Historical duplicate primary membership must never duplicate a line.
    { productId: plain!.id, categoryId: primary!.id },
  ])
  const [activePackage, inactivePackage] = await db.insert(packagingItems).values([
    { title: 'Active package', price: 2000, isActive: true },
    { title: 'Inactive package', price: 9999, isActive: false },
  ]).returning()
  await db.insert(productPackagingItems).values([
    { productId: sized!.id, packagingItemId: activePackage!.id },
    { productId: sized!.id, packagingItemId: inactivePackage!.id },
  ])
  await db.insert(settings).values([
    { key: SETTING_KEYS.restaurantLocation, value: { lat: 35.7, lng: 51.4 } },
    { key: SETTING_KEYS.restaurantOpen, value: true },
  ])
  await db.insert(deliveryZones).values({ radiusKm: 2, fee: 20_000 })
  // Bun 1.3.14 can stall parallel settings reads on a reserved transaction connection.
  // Read the unchanged fixture status outside transactions; keep all pricing/payment settings real.
  const readRestaurantStatus = settingService.restaurantStatus.bind(settingService)
  const fixtureRestaurantStatus = await readRestaurantStatus()
  settingService.restaurantStatus = (lang = 'fa', readDb) => readDb
    ? Promise.resolve(fixtureRestaurantStatus) : readRestaurantStatus(lang)
  const simple: CheckoutInput = { items: [{ productId: plain!.id, quantity: 1 }],
    deliveryType: 'DINE_IN', useWallet: true, gatewayId: 'ZARINPAL' }
  const mixed: CheckoutInput = { ...simple, items: [
    { productId: plain!.id, quantity: 2 }, { productId: sized!.id, sizeId: size!.id, quantity: 3 },
    { productId: excluded!.id, quantity: 1 },
  ] }
  const withAddress = async (userId: string, input: CheckoutInput) => {
    const [address] = await db.insert(addresses).values({ userId, title: 'Home', address: 'Scratch address', lat: 35.7, lng: 51.4 }).returning()
    return { ...input, deliveryType: 'DELIVERY' as const, addressId: address!.id }
  }
  const snapshot = async () => {
    const [row] = await db.execute(sql`select
      (select coalesce(jsonb_agg(to_jsonb(c) order by id), '[]'::jsonb) from coupons c) as coupons,
      (select coalesce(jsonb_agg(to_jsonb(g) order by id), '[]'::jsonb) from coupon_grants g) as grants,
      (select count(*) from orders) as orders, (select count(*) from payments) as payments,
      (select count(*) from wallet_transactions) as ledger,
      (select count(*) from first_purchase_reservations) as reservations`)
    return row
  }

  // B: independently computed expected values, full shared breakdown and stored lines.
  for (const scope of ['ALL_PRODUCTS', 'CATEGORY', 'PRODUCT'] as const) {
    for (const deliveryType of ['DELIVERY', 'PICKUP', 'DINE_IN'] as const) {
      const buyer = await makeUser()
      await fund(buyer.id, deliveryType === 'DINE_IN' ? 1_000_000 : 30_000)
      const coupon = await makeCoupon({ discountPercentage: 17, discountScope: scope,
        ...(scope === 'CATEGORY' ? { discountCategoryId: primary!.id } : {}),
        ...(scope === 'PRODUCT' ? { discountProductId: sized!.id } : {}),
      })
      let input: CheckoutInput = { ...mixed, couponCode: coupon.code, deliveryType }
      if (deliveryType === 'DELIVERY') input = await withAddress(buyer.id, input)
      const before = await snapshot()
      const preview = await service.preview(buyer.id, input)
      const previewAgain = await service.preview(buyer.id, input)
      assert.deepEqual(await snapshot(), before, 'preview must not create grants, holds, orders or payments')
      assert.deepEqual(previewAgain.breakdown, preview.breakdown)
      const eligible = scope === 'ALL_PRODUCTS' ? 767_509 : scope === 'CATEGORY' ? 722_508 : 562_506
      const discount = Math.round(eligible * 17 / 100)
      const fees = deliveryType === 'DINE_IN' ? 0 : 8500
      const deliveryFee = deliveryType === 'DELIVERY' ? 20_000 : 0
      const walletDeduction = deliveryType === 'DINE_IN' ? 767_509 - discount : 30_000
      assert.equal(preview.breakdown.foodTotal, 767_509)
      assert.equal(preview.breakdown.discount, discount)
      assert.equal(preview.breakdown.walletDeduction, walletDeduction)
      assert.equal(preview.breakdown.packagingFee, fees)
      assert.equal(preview.breakdown.deliveryFee, deliveryFee)
      assert.equal(preview.breakdown.totalAmount, 767_509 - discount + fees + deliveryFee)
      assert.equal(preview.breakdown.amountPaidOnline, 767_509 - discount - walletDeduction + fees + deliveryFee)
      assert.deepEqual(preview.items.map(item => item.unitPrice), [80_001, 187_502, 45_001])
      const checkout = await service.checkout(buyer.id, input)
      assert.deepEqual(checkout.breakdown, preview.breakdown)
      assert.equal(checkout.amountPaidOnline, preview.breakdown.amountPaidOnline)
      const saved = await order(checkout.displayId)
      assert.equal((await reservation(buyer.id)).length, checkout.requiresPayment ? 1 : 0,
        'every first pending order reserves the user, including public coupons')
      assert.equal(saved.couponEligibleSubtotal, eligible)
      const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, saved.id))
      assert.equal(lines.length, 3)
      assert.equal(lines.reduce((sum, line) => sum + line.couponDiscountAmount, 0), discount)
      for (const line of lines) {
        assert(line.couponDiscountAmount >= 0 && line.couponDiscountAmount <= line.unitPrice * line.quantity)
        if (scope !== 'ALL_PRODUCTS' && line.productId === excluded!.id) assert.equal(line.couponDiscountAmount, 0)
        if (scope === 'PRODUCT' && line.productId === plain!.id) assert.equal(line.couponDiscountAmount, 0)
      }
      const invoice = await service.invoiceForStaff(checkout.displayId)
      assert.equal(invoice.items.reduce((sum, item) => sum + (item.couponDiscountAmount ?? 0), 0), discount)
      assert.equal((await service.byDisplayId(buyer.id, checkout.displayId)).items.reduce((sum, item) => sum + (item.couponDiscountAmount ?? 0), 0), discount)
      passed(`B ${scope}/${deliveryType}: read-only preview equals checkout, exact effective prices, scope, wallet, fees and invoice`)
    }
  }
  const feeBuyer = await makeUser()
  await fund(feeBuyer.id, 1_000_000)
  const feeCoupon = await makeCoupon({ discountPercentage: 25 })
  const feeInput = await withAddress(feeBuyer.id, { ...simple, couponCode: feeCoupon.code })
  const feePreview = await service.preview(feeBuyer.id, feeInput)
  const feeCheckout = await service.checkout(feeBuyer.id, feeInput)
  assert.deepEqual(feeCheckout.breakdown, feePreview.breakdown)
  assert.equal(feeCheckout.breakdown.walletDeduction, 60_001)
  assert.equal(feeCheckout.amountPaidOnline, 21_000)
  passed('B an oversized wallet pays only food after coupon; delivery and packaging remain online')

  for (const discountScope of ['CATEGORY', 'PRODUCT'] as const) {
    const buyer = await makeUser()
    const coupon = await makeCoupon({ discountScope,
      ...(discountScope === 'CATEGORY' ? { discountCategoryId: primary!.id } : { discountProductId: sized!.id }) })
    const input = { ...simple, items: [{ productId: excluded!.id, quantity: 1 }], couponCode: coupon.code }
    const preview = await service.preview(buyer.id, input)
    assert.equal(preview.coupon?.valid, false)
    assert.match(preview.coupon?.message ?? '', /محصول|سبد/)
    await assert.rejects(() => service.checkout(buyer.id, input), /محصول|سبد/)
    assert.equal((await campaign(coupon.id)).usedCount, 0)
  }
  passed('unmatched category and product scopes reject clearly in Persian without capacity changes')

  const roundBuyer = await makeUser()
  const roundCoupon = await makeCoupon({ discountPercentage: 17 })
  const rounded = await service.checkout(roundBuyer.id, { ...simple, couponCode: roundCoupon.code,
    items: [{ productId: cheap!.id, quantity: 1 }, { productId: cheap!.id, quantity: 1 }, { productId: cheap!.id, quantity: 1 }] })
  const roundedLines = await db.select().from(orderItems).where(eq(orderItems.orderId, (await order(rounded.displayId)).id))
  assert.equal(rounded.breakdown.discount, 2)
  assert.equal(roundedLines.reduce((sum, line) => sum + line.couponDiscountAmount, 0), 2)
  passed('fractional per-line savings allocate exactly the aggregate discount without money drift')

  // A: an ordinary first order owns the same user entitlement as a coupon order.
  const normalBuyer = await makeUser()
  await fund(normalBuyer.id, 30_000)
  const normalFirstCoupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
  const normalPending = await service.checkout(normalBuyer.id, simple)
  const normalRow = await order(normalPending.displayId)
  assert.equal((await reservation(normalBuyer.id)).length, 1)
  assert.equal((await reservation(normalBuyer.id))[0]!.orderId, normalRow.id)
  assert.equal(normalRow.couponId, null)
  const normalSecondInput = { ...simple, couponCode: normalFirstCoupon.code }
  assert.equal((await couponService.findUsableCoupon(db, normalBuyer.id, normalFirstCoupon.code)).ok, false)
  const beforeBlockedPreview = await snapshot()
  assert.equal((await service.preview(normalBuyer.id, normalSecondInput)).coupon?.valid, false)
  await service.preview(normalBuyer.id, simple)
  assert.deepEqual(await snapshot(), beforeBlockedPreview, 'ordinary preview remains read-only while FIRST is unavailable')
  await assert.rejects(() => service.checkout(normalBuyer.id, normalSecondInput), firstCouponUnavailable)
  assert.equal((await campaign(normalFirstCoupon.id)).usedCount, 0)
  assert.equal(await grant(normalFirstCoupon.id, normalBuyer.id), undefined)
  const normalCallback = await startPayment(normalPending)
  const independentNormal = await service.checkout(normalBuyer.id, simple)
  assert.equal(independentNormal.breakdown.walletDeduction, 0, 'new order cannot spend the original wallet hold')
  assert.equal((await reservation(normalBuyer.id))[0]!.orderId, normalRow.id)
  const independentCallback = await startPayment(independentNormal)
  verdict = 'indeterminate'
  await normalCallback()
  assert.equal((await order(normalPending.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await reservation(normalBuyer.id)).length, 1)
  assert.equal(await balance(normalBuyer.id), 0)
  assert.equal((await ledger(normalRow.id)).length, 1)
  verdict = 'failed'
  await independentCallback()
  assert.equal((await reservation(normalBuyer.id))[0]!.orderId, normalRow.id, 'independent failure does not release original FIRST entitlement')
  assert.equal(await balance(normalBuyer.id), 0, 'independent failure does not release the original wallet hold')
  verdict = 'failed'
  await Promise.all([normalCallback(), normalCallback(), normalCallback()])
  assert.equal((await order(normalPending.displayId)).paymentStatus, 'FAILED')
  assert.equal((await reservation(normalBuyer.id)).length, 0)
  assert.equal(await balance(normalBuyer.id), 30_000)
  const normalFailedLedger = await ledger(normalRow.id)
  assert.equal(normalFailedLedger.length, 2)
  assert.equal(normalFailedLedger.filter(row => row.type === 'DEPOSIT').length, 1)
  await normalCallback()
  assert.deepEqual(await ledger(normalRow.id), normalFailedLedger)
  assert.equal((await service.preview(normalBuyer.id, normalSecondInput)).coupon?.valid, true)
  const normalRecovered = await service.checkout(normalBuyer.id, normalSecondInput)
  assert.equal((await reservation(normalBuyer.id))[0]!.orderId, (await order(normalRecovered.displayId)).id)
  assert.equal((await campaign(normalFirstCoupon.id)).usedCount, 1)
  assert((await grant(normalFirstCoupon.id, normalBuyer.id))?.consumedAt)
  await successful(normalRecovered)
  passed('A pending ordinary first order permits independent checkout, keeps FIRST and wallet holds scoped, then restores FIRST after definitive failures')

  // B: an independent ordinary purchase can pay before the reserved first-purchase order.
  const reverseBuyer = await makeUser()
  const reverseFirst = await makeCoupon({ rules: [firstRule] })
  const reverseOther = await makeCoupon({ rules: [firstRule] })
  const reversePending = await service.checkout(reverseBuyer.id, { ...simple, couponCode: reverseFirst.code })
  const reverseCallback = await startPayment(reversePending)
  const reverseIndependent = await service.checkout(reverseBuyer.id, simple)
  await assert.rejects(() => service.checkout(reverseBuyer.id, { ...simple, couponCode: reverseOther.code }), firstCouponUnavailable)
  await service.preview(reverseBuyer.id, simple)
  assert.equal((await reservation(reverseBuyer.id)).length, 1)
  await successful(reverseIndependent)
  assert.equal((await order(reversePending.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await reservation(reverseBuyer.id))[0]!.orderId, (await order(reversePending.displayId)).id)
  assert.equal((await campaign(reverseFirst.id)).usedCount, 1)
  assert((await grant(reverseFirst.id, reverseBuyer.id))?.consumedAt)
  await Promise.all([reverseCallback(), reverseCallback()])
  assert.equal((await order(reversePending.displayId)).status, 'PAID')
  assert.equal((await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, (await order(reversePending.displayId)).id))).length, 1)
  assert.equal((await reservation(reverseBuyer.id)).length, 0)
  assert.equal((await service.preview(reverseBuyer.id, { ...simple, couponCode: reverseOther.code })).coupon?.valid, false)
  await assert.rejects(() => service.checkout(reverseBuyer.id, { ...simple, couponCode: reverseOther.code }))
  const laterNormal = await service.checkout(reverseBuyer.id, simple)
  assert(laterNormal.requiresPayment)
  assert.equal((await reservation(reverseBuyer.id)).length, 0, 'returning customers never create first-order reservations')
  await service.preview(reverseBuyer.id, simple)
  const anotherNormal = await service.checkout(reverseBuyer.id, simple)
  assert.notEqual(anotherNormal.displayId, laterNormal.displayId)
  assert.equal((await reservation(reverseBuyer.id)).length, 0)
  passed('B new ordinary purchase pays first and original FIRST settles late once; further independent purchases need no extra entitlement')

  // D: competing normal/coupon requests share the existing database user lock.
  for (const couponFirst of [false, true, false, true]) {
    const racer = await makeUser()
    await fund(racer.id, 20_000)
    const raceCoupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
    const raceInputs = [simple, { ...simple, couponCode: raceCoupon.code }]
    if (couponFirst) raceInputs.reverse()
    const attempts = await Promise.allSettled(raceInputs.map(input => service.checkout(racer.id, input)))
    const winners = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<OrderService['checkout']>>> => attempt.status === 'fulfilled')
    assert(winners.length >= 1 && winners.length <= 2)
    const raceOrders = await db.select().from(orders).where(eq(orders.userId, racer.id))
    assert.equal(raceOrders.length, winners.length)
    assert.equal(raceOrders.filter(row => row.couponId === null).length, 1, 'the independent ordinary purchase always proceeds')
    const discountedRace = raceOrders.find(row => row.couponId === raceCoupon.id)
    assert.equal((await reservation(racer.id)).length, 1)
    const reservationOrderId = (await reservation(racer.id))[0]!.orderId
    assert(raceOrders.some(row => row.id === reservationOrderId))
    const raceLedger = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, racer.id))
    assert.equal(raceLedger.filter(row => row.type === 'WITHDRAW').length, 1)
    assert.equal(await balance(racer.id), 0)
    assert.equal((await campaign(raceCoupon.id)).usedCount, discountedRace ? 1 : 0)
    assert.equal(Boolean((await grant(raceCoupon.id, racer.id))?.consumedAt), !!discountedRace)
    assert.equal((await db.select().from(couponRedemptions).where(eq(couponRedemptions.userId, racer.id))).length, 0)
    if (discountedRace) assert.equal(reservationOrderId, discountedRace.id)
  }
  passed('D concurrent independent normal and FIRST purchases keep one user entitlement, one wallet withdrawal and at most one first discount')

  const unrelatedBuyer = await makeUser()
  const unrelatedCoupon = await makeCoupon({ rules: [{ type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
  const unrelatedOrder = await service.checkout(unrelatedBuyer.id, { ...simple, couponCode: unrelatedCoupon.code })
  assert.equal((await reservation(unrelatedBuyer.id)).length, 1)
  assert.equal((await reservation(unrelatedBuyer.id))[0]!.orderId, (await order(unrelatedOrder.displayId)).id)
  const unrelatedIndependent = await service.checkout(unrelatedBuyer.id, simple)
  assert.notEqual(unrelatedIndependent.displayId, unrelatedOrder.displayId)
  assert.equal((await reservation(unrelatedBuyer.id))[0]!.orderId, (await order(unrelatedOrder.displayId)).id)
  passed('an unrelated private coupon still reserves the customer actual first pending order')

  // FIRST_PURCHASE works before any grant/settlement; reservation spans campaigns.
  const firstA = await makeCoupon({ isPublic: false, maxUses: 1, rules: [firstRule] })
  const firstB = await makeCoupon({ isPublic: false, maxUses: 1, rules: [firstRule] })
  const fresh = await makeUser()
  await fund(fresh.id, 40_000)
  const firstInput = { ...simple, couponCode: firstA.code }
  const beforeFirstPreview = await snapshot()
  assert.equal((await service.preview(fresh.id, firstInput)).coupon?.valid, true)
  assert.deepEqual(await snapshot(), beforeFirstPreview)
  assert.equal(await grant(firstA.id, fresh.id), undefined)
  const simultaneous = await Promise.allSettled([firstA, firstB].map(coupon => service.checkout(fresh.id, { ...simple, couponCode: coupon.code })))
  const wins = simultaneous.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<OrderService['checkout']>>> => result.status === 'fulfilled')
  assert.equal(wins.length, 1)
  const won = wins[0]!.value
  const wonOrder = await order(won.displayId)
  const wonCoupon = await campaign(wonOrder.couponId!)
  const lostCoupon = wonCoupon.id === firstA.id ? firstB : firstA
  assert.equal((await reservation(fresh.id)).length, 1)
  assert.equal((await reservation(fresh.id))[0]!.orderId, wonOrder.id)
  assert.equal((await campaign(wonCoupon.id)).usedCount, 1)
  assert.equal((await campaign(lostCoupon.id)).usedCount, 0)
  assert((await grant(wonCoupon.id, fresh.id))?.consumedAt)
  assert(!(await couponService.grantedRecently(fresh.id, 100)).some(row => row.code === wonCoupon.code || row.code === lostCoupon.code))
  await assert.rejects(() => service.checkout(fresh.id, { ...simple, couponCode: lostCoupon.code }))
  assert.equal(await balance(fresh.id), 0)
  passed('A simultaneous and pending checkouts across private campaigns reserve one user entitlement and wallet atomically')

  const firstCallback = await startPayment(won)
  verdict = 'indeterminate'
  await firstCallback()
  assert.equal((await order(won.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await reservation(fresh.id)).length, 1)
  assert.equal((await campaign(wonCoupon.id)).usedCount, 1)
  assert((await grant(wonCoupon.id, fresh.id))?.consumedAt)
  assert.equal(await balance(fresh.id), 0)
  assert.equal((await ledger(wonOrder.id)).length, 1)
  passed('A uncertain gateway verification retains first-purchase, private-grant, coupon and wallet reservations')

  verdict = 'failed'
  await Promise.all([firstCallback(), firstCallback(), firstCallback()])
  assert.equal((await order(won.displayId)).status, 'CANCELED')
  assert.equal((await reservation(fresh.id)).length, 0)
  assert.equal((await campaign(wonCoupon.id)).usedCount, 0)
  assert.equal((await grant(wonCoupon.id, fresh.id))?.consumedAt, null)
  assert.equal(await balance(fresh.id), 40_000)
  const failedLedger = await ledger(wonOrder.id)
  assert.equal(failedLedger.length, 2)
  assert.equal(failedLedger.filter(row => row.type === 'DEPOSIT').length, 1)
  assert.equal(failedLedger.find(row => row.type === 'DEPOSIT')!.amount, 40_000)
  await firstCallback()
  assert.deepEqual(await ledger(wonOrder.id), failedLedger)
  assert.equal((await campaign(wonCoupon.id)).usedCount, 0)
  passed('C duplicate definitive failures refund wallet and release capacity/private grant/first-purchase exactly once')

  const retried = await service.checkout(fresh.id, { ...simple, couponCode: lostCoupon.code })
  await successful(retried)
  assert.equal((await reservation(fresh.id)).length, 0)
  assert.equal((await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, (await order(retried.displayId)).id))).length, 1)
  assert.equal((await service.preview(fresh.id, { ...simple, couponCode: wonCoupon.code })).coupon?.valid, false)
  assert(!(await couponService.grantedRecently(fresh.id, 100)).some(row => row.code === wonCoupon.code || row.code === lostCoupon.code))
  await assert.rejects(() => service.checkout(fresh.id, { ...simple, couponCode: wonCoupon.code }))
  passed('A successful payment settles once, consumes entitlement and prevents later first-purchase use')
  const refunds = await Promise.allSettled([1, 2].map(() => service.refund(retried.displayId, 'First purchase regression refund')))
  assert.equal(refunds.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await service.preview(fresh.id, { ...simple, couponCode: wonCoupon.code })).coupon?.valid, true)
  assert.equal((await ledger((await order(retried.displayId)).id)).filter(row => row.type === 'DEPOSIT').length, 1)
  passed('refund restores eligibility when the only successful purchase is canceled and credits once')

  const multiple = await makeUser()
  const multipleFirst = await makeCoupon({ rules: [firstRule] })
  const discounted = await service.checkout(multiple.id, { ...simple, useWallet: false, couponCode: multipleFirst.code })
  await successful(discounted)
  const ordinary = await service.checkout(multiple.id, { ...simple, useWallet: false })
  await successful(ordinary)
  await service.refund(discounted.displayId, 'Another successful order remains')
  assert.equal((await service.preview(multiple.id, { ...simple, couponCode: multipleFirst.code })).coupon?.valid, false)
  await service.refund(ordinary.displayId, 'All successful orders refunded')
  assert.equal((await service.preview(multiple.id, { ...simple, couponCode: multipleFirst.code })).coupon?.valid, true)
  passed('refund restores first purchase only after every successful non-canceled order is gone')

  const historical = await makeUser()
  const historicalCoupon = await makeCoupon({ rules: [firstRule] })
  const [legacyPending] = await db.insert(orders).values([
    { userId: historical.id, displayId: `hist-${++serial}`, deliveryType: 'DINE_IN', totalAmount: 1,
      status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', breakdown: won.breakdown },
    { userId: historical.id, displayId: `hist-${++serial}`, deliveryType: 'DINE_IN', totalAmount: 1,
      status: 'CANCELED', paymentStatus: 'FAILED', breakdown: won.breakdown },
    { userId: historical.id, displayId: `hist-${++serial}`, deliveryType: 'DINE_IN', totalAmount: 1,
      status: 'CANCELED', paymentStatus: 'SUCCESS', breakdown: won.breakdown },
  ]).returning()
  assert.equal((await reservation(historical.id)).length, 0)
  assert.equal((await couponService.findUsableCoupon(db, historical.id, historicalCoupon.code)).ok, false)
  const beforeLegacyPreview = await snapshot()
  assert.equal((await service.preview(historical.id, { ...simple, couponCode: historicalCoupon.code })).coupon?.valid, false)
  await service.preview(historical.id, simple)
  assert.deepEqual(await snapshot(), beforeLegacyPreview)
  await assert.rejects(() => service.checkout(historical.id, { ...simple, couponCode: historicalCoupon.code }), firstCouponUnavailable)
  const legacyIndependent = await service.checkout(historical.id, simple)
  assert.equal((await reservation(historical.id)).length, 0, 'independent checkout cannot backfill or take the legacy entitlement')
  const legacyIndependentCallback = await startPayment(legacyIndependent)
  verdict = 'failed'
  await legacyIndependentCallback()
  await db.update(orders).set({ status: 'CANCELED', paymentStatus: 'FAILED' }).where(eq(orders.id, legacyPending!.id))
  passed('C legacy pending orders without reservation rows withhold only FIRST and permit independent normal preview/checkout')
  assert.equal((await service.preview(historical.id, { ...simple, couponCode: historicalCoupon.code })).coupon?.valid, true)
  const [pastSuccess] = await db.insert(orders).values({ userId: historical.id, displayId: `hist-${++serial}`,
    deliveryType: 'DINE_IN', totalAmount: 1, status: 'PAID', paymentStatus: 'SUCCESS', breakdown: won.breakdown }).returning()
  assert.equal((await service.preview(historical.id, { ...simple, couponCode: historicalCoupon.code })).coupon?.valid, false)
  await assert.rejects(() => service.checkout(historical.id, { ...simple, couponCode: historicalCoupon.code }))
  passed('only SUCCESS plus non-CANCELED orders count, and checkout independently revalidates after a preview')

  const andCoupon = await makeCoupon({ conditionMode: 'AND', rules: [firstRule, { type: 'REGISTERED_DAYS_AGO', params: { days: 5 } }] })
  const young = await makeUser(1), old = await makeUser(10)
  assert.equal((await service.preview(young.id, { ...simple, couponCode: andCoupon.code })).coupon?.valid, false)
  assert.equal((await service.preview(old.id, { ...simple, couponCode: andCoupon.code })).coupon?.valid, true)
  const orCoupon = await makeCoupon({ conditionMode: 'OR', rules: [firstRule, { type: 'MIN_ORDERS_COUNT', params: { count: 1 } }] })
  assert.equal((await service.preview(young.id, { ...simple, couponCode: orCoupon.code })).coupon?.valid, true)
  const veteran = await service.checkout(historical.id, { ...simple, couponCode: orCoupon.code })
  assert.equal((await reservation(historical.id)).length, 0)
  assert.equal(veteran.breakdown.discount, 16_000)
  await successful(veteran)
  const alternative = await makeCoupon({ conditionMode: 'OR', rules: [firstRule, { type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
  const alternativeEligibility = await couponService.findUsableCoupon(db, old.id, alternative.code)
  assert(alternativeEligibility.ok && !alternativeEligibility.requiresFirstPurchase, 'independent OR eligibility must not require the FIRST branch')
  await service.checkout(old.id, { ...simple, couponCode: alternative.code })
  assert.equal((await reservation(old.id)).length, 1, 'the actual first pending order reserves the user independently of the satisfied OR branch')
  passed('AND/OR eligibility is preserved while general first-order reservations depend on purchase history, not coupon branches')
  await assert.rejects(() => makeCoupon({ conditionMode: 'AND', rules: [firstRule, { type: 'MIN_ORDERS_COUNT', params: { count: 1 } }] }), validation)
  await assert.rejects(() => makeCoupon({ conditionMode: 'AND', rules: [firstRule, { type: 'MIN_TOTAL_SPEND', params: { amount: 1 } }] }), validation)
  const zeroRule = await makeCoupon({ rules: [firstRule, { type: 'MIN_PRODUCT_ORDERS', params: { productId: plain!.id, count: 0 } }] })
  assert.equal((await service.preview(young.id, { ...simple, couponCode: zeroRule.code })).coupon?.valid, true)
  passed('contradictory first-purchase AND rules reject safely while zero purchase thresholds remain compatible')

  const categoryBuyer = await makeUser()
  const categoryOrder = await service.checkout(categoryBuyer.id, { ...mixed, useWallet: false })
  await successful(categoryOrder)
  const boughtCategory = await makeCoupon({ rules: [{ type: 'MIN_CATEGORY_ORDERS', params: { categoryId: primary!.id, count: 5 } }] })
  const overCount = await makeCoupon({ rules: [{ type: 'MIN_CATEGORY_ORDERS', params: { categoryId: primary!.id, count: 6 } }] })
  assert.equal((await service.preview(categoryBuyer.id, { ...simple, couponCode: boughtCategory.code })).coupon?.valid, true)
  assert.equal((await service.preview(categoryBuyer.id, { ...simple, couponCode: overCount.code })).coupon?.valid, false)
  passed('category eligibility counts primary plus secondary purchases without duplicate primary membership')
  const independent = await makeCoupon({ discountPercentage: 17, discountScope: 'PRODUCT', discountProductId: excluded!.id,
    rules: [{ type: 'MIN_PRODUCT_ORDERS', params: { productId: plain!.id, count: 2 } }] })
  const independentInput = { ...mixed, couponCode: independent.code }
  const independentPreview = await service.preview(categoryBuyer.id, independentInput)
  assert.equal(independentPreview.coupon?.valid, true)
  assert.equal(independentPreview.breakdown.couponEligibleSubtotal, 45_001)
  assert.equal(independentPreview.breakdown.discount, 7650)
  const independentCheckout = await service.checkout(categoryBuyer.id, independentInput)
  assert.deepEqual(independentCheckout.breakdown, independentPreview.breakdown)
  passed('purchase-history eligibility and discounted product scope stay independent in a mixed cart')

  const scanAnd = await makeCoupon({ isPublic: false, cronEnabled: true, rules: [firstRule, { type: 'REGISTERED_DAYS_AGO', params: { days: 5 } }] })
  const scanOr = await makeCoupon({ isPublic: false, cronEnabled: true, conditionMode: 'OR',
    rules: [firstRule, { type: 'REGISTERED_DAYS_AGO', params: { days: 5 } }] })
  const andCandidates = await couponService.findNudgeCandidates(scanAnd.id)
  assert(andCandidates.some(row => row.userId === young.id))
  assert(!andCandidates.some(row => row.userId === historical.id), 'a prior buyer can never satisfy FIRST in AND')
  assert(!andCandidates.some(row => row.userId === old.id), 'already eligible users need no reminder')
  const orCandidates = await couponService.findNudgeCandidates(scanOr.id)
  assert(!orCandidates.some(row => row.userId === young.id), 'FIRST already satisfies OR for a fresh user')
  assert(!orCandidates.some(row => row.userId === historical.id), 'registration already satisfies OR')
  const youngBuyer = await makeUser(1)
  await db.insert(orders).values({ userId: youngBuyer.id, displayId: `scan-${++serial}`, deliveryType: 'DINE_IN',
    status: 'PAID', paymentStatus: 'SUCCESS', totalAmount: 1, breakdown: won.breakdown })
  const actionable = (await couponService.findNudgeCandidates(scanOr.id)).find(row => row.userId === youngBuyer.id)
  assert(actionable)
  const [missingRule] = await db.select().from(couponConditions).where(eq(couponConditions.id, actionable.missingConditionId as never))
  assert.equal(missingRule!.type, 'REGISTERED_DAYS_AGO')
  await db.insert(couponNudges).values([
    { userId: youngBuyer.id, couponId: scanOr.id, missingConditionId: actionable.missingConditionId as never, scanDate: '2020-01-01', smsSentAt: new Date() },
    { userId: youngBuyer.id, couponId: scanOr.id, missingConditionId: null, scanDate: '2020-01-02', smsSentAt: new Date() },
  ])
  assert(!(await couponService.findNudgeCandidates(scanOr.id)).some(row => row.userId === youngBuyer.id))
  passed('AND/OR reminders skip eligible/impossible FIRST users, choose actionable rules, and preserve lifetime limits')

  const nowEligible = await makeUser(1), nowImpossible = await makeUser(1)
  await db.insert(orders).values({ userId: nowEligible.id, displayId: `scan-${++serial}`, deliveryType: 'DINE_IN',
    status: 'PAID', paymentStatus: 'SUCCESS', totalAmount: 1, breakdown: won.breakdown })
  const scanDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const scan = new CouponScanJob({ db, coupons: couponService, config,
    now: () => new Date(`${scanDate}T00:30:00.000Z`) })
  await scan.run()
  const afterScan = await db.select().from(couponNudges).orderBy(couponNudges.id)
  await scan.run()
  assert.deepEqual(await db.select().from(couponNudges).orderBy(couponNudges.id), afterScan)
  assert(afterScan.some(row => row.userId === nowEligible.id && row.couponId === scanOr.id))
  assert(afterScan.some(row => row.userId === nowImpossible.id && row.couponId === scanAnd.id))
  await db.update(users).set({ createdAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(users.id, nowEligible.id))
  await db.insert(orders).values({ userId: nowImpossible.id, displayId: `scan-${++serial}`, deliveryType: 'DINE_IN',
    status: 'PAID', paymentStatus: 'SUCCESS', totalAmount: 1, breakdown: won.breakdown })
  const notices: { userId: string; id: string; data: { couponCode: string } }[] = []
  const nudge = new CouponNudgeJob({ db, config, now: () => new Date(`${scanDate}T07:30:00.000Z`), notifications: {
    notifyUser: async (userId: string, notice: { data: { couponCode: string } }, options: { notificationId: string }) => {
      notices.push({ userId, id: options.notificationId, data: notice.data })
      return { id: options.notificationId }
    },
  } as never })
  await nudge.run()
  assert(!notices.some(row => row.userId === nowEligible.id && row.data.couponCode === scanOr.code))
  assert(!notices.some(row => row.userId === nowImpossible.id && row.data.couponCode === scanAnd.code))
  assert(notices.some(row => row.userId === young.id && row.data.couponCode === scanAnd.code))
  const sentCount = notices.length
  await nudge.run()
  assert.equal(notices.length, sentCount)
  passed('real scan jobs prevent duplicate daily rows; send-time rechecks suppress stale eligibility and impossible FIRST reminders')

  const staleGrant = await makeCoupon({ isPublic: false, rules: [firstRule] })
  await db.insert(couponGrants).values({ couponId: staleGrant.id, userId: historical.id })
  assert.equal((await service.preview(historical.id, { ...simple, couponCode: staleGrant.code })).coupon?.valid, false)
  await assert.rejects(() => service.checkout(historical.id, { ...simple, couponCode: staleGrant.code }))
  assert.equal((await campaign(staleGrant.id)).usedCount, 0)
  assert.equal((await grant(staleGrant.id, historical.id))?.consumedAt, null)
  passed('historical private grants cannot bypass live first-purchase eligibility')

  const windowBuyer = await makeUser()
  const windowRule = { type: 'ORDERS_IN_LAST_DAYS', params: { days: 1, count: 1 } }
  const earnedWindow = await makeCoupon({ rules: [windowRule] })
  const windowPurchase = await service.checkout(windowBuyer.id, { ...simple, useWallet: false })
  await successful(windowPurchase)
  assert.equal((await grant(earnedWindow.id, windowBuyer.id))?.consumedAt, null)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
    .where(eq(orders.id, (await order(windowPurchase.displayId)).id))
  const unearnedWindow = await makeCoupon({ rules: [windowRule] })
  const earnedInput = { ...simple, useWallet: false, couponCode: earnedWindow.code }
  const earnedPreview = await service.preview(windowBuyer.id, earnedInput)
  assert.equal(earnedPreview.coupon?.valid, true)
  assert.equal((await service.preview(windowBuyer.id, { ...earnedInput, couponCode: unearnedWindow.code })).coupon?.valid, false)
  assert.equal(await grant(unearnedWindow.id, windowBuyer.id), undefined)
  const earnedCheckout = await service.checkout(windowBuyer.id, earnedInput)
  assert.deepEqual(earnedCheckout.breakdown, earnedPreview.breakdown)
  assert.equal(earnedCheckout.breakdown.discount, 16_000)
  assert((await grant(earnedWindow.id, windowBuyer.id))?.consumedAt)
  passed('earned ordinary time-window grants remain redeemable after history ages out; unearned coupons still require live eligibility')

  const rollbackBuyer = await makeUser()
  await fund(rollbackBuyer.id, 30_000)
  const rollbackCoupon = await makeCoupon({ isPublic: false, maxUses: 1, rules: [firstRule] })
  const beforeRollback = await snapshot()
  const tracking = settingService.liveTrackingEnabled.bind(settingService)
  settingService.liveTrackingEnabled = async () => { throw new Error('Injected rollback after coupon reservation') }
  try {
    await assert.rejects(() => service.checkout(rollbackBuyer.id, { ...simple, couponCode: rollbackCoupon.code }), /Injected rollback/)
  } finally { settingService.liveTrackingEnabled = tracking }
  assert.deepEqual(await snapshot(), beforeRollback)
  assert.equal(await balance(rollbackBuyer.id), 30_000)
  assert.equal((await reservation(rollbackBuyer.id)).length, 0)
  passed('failed checkout rolls back grant issuance, coupon capacity, first-purchase reservation and wallet together')

  const expiredBuyer = await makeUser()
  await fund(expiredBuyer.id, 20_000)
  const expiredCoupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
  const expiredCheckout = await service.checkout(expiredBuyer.id, { ...simple, couponCode: expiredCoupon.code })
  const expiredCallback = await startPayment(expiredCheckout)
  const expiredOrder = await order(expiredCheckout.displayId)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, expiredOrder.id))
  verdict = 'indeterminate'
  await paymentService.expirePendingOrders()
  assert.equal((await order(expiredCheckout.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await reservation(expiredBuyer.id)).length, 1)
  assert.equal((await campaign(expiredCoupon.id)).usedCount, 1)
  assert((await grant(expiredCoupon.id, expiredBuyer.id))?.consumedAt)
  assert.equal(await balance(expiredBuyer.id), 0)
  verdict = 'failed'
  await expiredCallback()
  assert.equal((await order(expiredCheckout.displayId)).status, 'CANCELED')
  assert.equal((await reservation(expiredBuyer.id)).length, 0)
  assert.equal((await campaign(expiredCoupon.id)).usedCount, 0)
  assert.equal((await grant(expiredCoupon.id, expiredBuyer.id))?.consumedAt, null)
  assert.equal(await balance(expiredBuyer.id), 20_000)
  const expiredLedger = await ledger(expiredOrder.id)
  assert.equal(expiredLedger.length, 2)
  await paymentService.expirePendingOrders()
  assert.deepEqual(await ledger(expiredOrder.id), expiredLedger)
  passed('A/C expiry keeps uncertain first-purchase and financial reservations, then releases once on verified failure')

  // Explicit owner audit releases stale financial holds; independent entry points never query the PSP.
  for (const entry of ['preview', 'checkout'] as const) {
    const buyer = await makeUser()
    await fund(buyer.id, 20_000)
    const coupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
    const input = { ...simple, couponCode: coupon.code }
    const stale = await service.checkout(buyer.id, input)
    const staleCallback = await startPayment(stale)
    const staleRow = await order(stale.displayId)
    await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, staleRow.id))
    verdict = 'failed'
    assert.equal((await service.preview(buyer.id, input)).coupon?.valid, false)
    assert.equal(verifyCalls.get(stale.paymentId!), undefined, 'preview never waits for PSP reconciliation')
    await paymentService.reconcileCustomerPendingOrders(buyer.id)
    if (entry === 'preview') {
      const recoveredPreview = await service.preview(buyer.id, input)
      assert.equal(recoveredPreview.coupon?.valid, true)
      assert.equal((await reservation(buyer.id)).length, 0)
      assert.equal((await campaign(coupon.id)).usedCount, 0)
      assert.equal((await grant(coupon.id, buyer.id))?.consumedAt, null)
      assert.equal(await balance(buyer.id), 20_000)
      await service.preview(buyer.id, input)
    } else {
      const replacement = await service.checkout(buyer.id, input)
      assert.notEqual(replacement.displayId, stale.displayId)
      assert.equal((await reservation(buyer.id))[0]!.orderId, (await order(replacement.displayId)).id)
      assert.equal((await campaign(coupon.id)).usedCount, 1, 'old capacity releases before replacement reserves it')
      assert((await grant(coupon.id, buyer.id))?.consumedAt)
      assert.equal(await balance(buyer.id), 0)
      await assert.rejects(() => service.checkout(buyer.id, input), firstCouponUnavailable)
    }
    assert.equal((await order(stale.displayId)).status, 'CANCELED')
    assert.equal(verifyCalls.get(stale.paymentId!), 1)
    const settledLedger = await ledger(staleRow.id)
    assert.equal(settledLedger.length, 2)
    assert.equal(settledLedger.filter(row => row.type === 'DEPOSIT').length, 1)
    await staleCallback()
    assert.deepEqual(await ledger(staleRow.id), settledLedger)
    assert.equal(verifyCalls.get(stale.paymentId!), 2, 'late callback still checks PSP evidence without releasing reservations twice')
    passed(`explicit stale audit releases every reservation once; ${entry} can then use a newly eligible first coupon`)
  }

  const uncertainBuyer = await makeUser()
  await fund(uncertainBuyer.id, 20_000)
  const uncertainCoupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
  const uncertainInput = { ...simple, couponCode: uncertainCoupon.code }
  const uncertainCheckout = await service.checkout(uncertainBuyer.id, uncertainInput)
  const lateCallback = await startPayment(uncertainCheckout)
  const uncertainOrder = await order(uncertainCheckout.displayId)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, uncertainOrder.id))
  verdict = 'indeterminate'
  await paymentService.reconcileCustomerPendingOrders(uncertainBuyer.id)
  const pendingPreview = await service.preview(uncertainBuyer.id, uncertainInput)
  assert.equal(pendingPreview.paymentRecovery?.orderId, uncertainCheckout.displayId)
  assert.equal(pendingPreview.coupon?.valid, false)
  const [uncertainAttempt] = await db.select().from(payments).where(eq(payments.id, uncertainCheckout.paymentId!))
  const verification = uncertainAttempt!.metadata?.verification as { nextAt?: string } | undefined
  assert(Date.parse(verification?.nextAt ?? '') > Date.now(), 'uncertain PSP verification persists a future retry deadline')
  const [beforeFinding] = await db.select().from(reconcileFindings).where(and(
    eq(reconcileFindings.checkId, 'R12'), eq(reconcileFindings.entityId, uncertainCheckout.paymentId!),
  ))
  assert(beforeFinding)
  const beforeCalls = verifyCalls.get(uncertainCheckout.paymentId!)
  await assert.rejects(() => service.checkout(uncertainBuyer.id, uncertainInput), firstCouponUnavailable)
  const uncertainIndependent = await service.checkout(uncertainBuyer.id, simple)
  assert.equal(uncertainIndependent.breakdown.walletDeduction, 0)
  assert.equal((await reservation(uncertainBuyer.id))[0]!.orderId, uncertainOrder.id)
  const ordinaryCoupon = await makeCoupon({ rules: [{ type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
  const ordinaryIndependent = await service.checkout(uncertainBuyer.id, { ...simple, couponCode: ordinaryCoupon.code })
  assert.equal(ordinaryIndependent.breakdown.discount, 16_000)
  const repeatedPendingPreview = await service.preview(uncertainBuyer.id, simple)
  assert.equal(repeatedPendingPreview.paymentRecovery?.orderId, uncertainCheckout.displayId)
  const [afterFinding] = await db.select().from(reconcileFindings).where(eq(reconcileFindings.id, beforeFinding.id))
  assert.equal(verifyCalls.get(uncertainCheckout.paymentId!), beforeCalls, 'repeated backend requests respect persisted PSP backoff')
  assert.equal(afterFinding!.occurrences, beforeFinding.occurrences, 'backoff does not duplicate R12 observations')
  assert.equal((await order(uncertainCheckout.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await reservation(uncertainBuyer.id))[0]!.orderId, uncertainOrder.id)
  assert.equal((await campaign(uncertainCoupon.id)).usedCount, 1)
  assert((await grant(uncertainCoupon.id, uncertainBuyer.id))?.consumedAt)
  assert.equal(await balance(uncertainBuyer.id), 0)
  const uncertainLedger = await ledger(uncertainOrder.id)
  assert.equal(uncertainLedger.length, 1)
  assert.equal((await db.select().from(orders).where(eq(orders.userId, uncertainBuyer.id))).length, 3)
  assert.equal((await campaign(ordinaryCoupon.id)).usedCount, 1)
  assert((await grant(ordinaryCoupon.id, uncertainBuyer.id))?.consumedAt)
  passed('stale unknown outcome permits independent normal/private-coupon purchases while old holds and FIRST stay intact, with PSP audit backoff')

  verdict = 'success'
  await lateCallback()
  assert.equal(verifyCalls.get(uncertainCheckout.paymentId!), beforeCalls! + 1, 'callback evidence bypasses scheduled audit backoff')
  assert.equal((await order(uncertainCheckout.displayId)).status, 'PAID')
  assert.equal((await reservation(uncertainBuyer.id)).length, 0)
  assert.equal((await campaign(uncertainCoupon.id)).usedCount, 1)
  assert((await grant(uncertainCoupon.id, uncertainBuyer.id))?.consumedAt)
  await Promise.all([lateCallback(), lateCallback()])
  assert.equal(verifyCalls.get(uncertainCheckout.paymentId!), beforeCalls! + 1)
  assert.deepEqual(await ledger(uncertainOrder.id), uncertainLedger)
  const lateRedemptions = await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, uncertainOrder.id))
  assert.equal(lateRedemptions.length, 1)
  const anotherFirstCoupon = await makeCoupon({ rules: [firstRule] })
  assert.equal((await service.preview(uncertainBuyer.id, { ...simple, couponCode: anotherFirstCoupon.code })).coupon?.valid, false)
  const afterLateSuccess = await service.checkout(uncertainBuyer.id, simple)
  assert.notEqual(afterLateSuccess.displayId, uncertainCheckout.displayId)
  assert.equal((await reservation(uncertainBuyer.id)).length, 0, 'verified success makes the customer returning')
  passed('late success bypasses verification backoff, settles exactly once and consumes first-purchase entitlement once')

  const scopedBuyer = await makeUser()
  await fund(scopedBuyer.id, 30_000)
  const scopedFirst = await makeCoupon({ maxUses: 1, rules: [firstRule] })
  const scopedOrdinary = await makeCoupon({ rules: [{ type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
  const scopedOriginal = await service.checkout(scopedBuyer.id, { ...simple, couponCode: scopedFirst.code })
  const scopedOriginalCallback = await startPayment(scopedOriginal)
  const scopedOriginalRow = await order(scopedOriginal.displayId)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, scopedOriginalRow.id))
  verdict = 'indeterminate'
  await paymentService.reconcileCustomerPendingOrders(scopedBuyer.id)
  const scopedNew = await service.checkout(scopedBuyer.id, { ...simple, couponCode: scopedOrdinary.code })
  const scopedNewCallback = await startPayment(scopedNew)
  assert.equal(scopedNew.breakdown.walletDeduction, 0)
  verdict = 'failed'
  await scopedOriginalCallback()
  assert.equal((await order(scopedOriginal.displayId)).status, 'CANCELED')
  assert.equal((await campaign(scopedFirst.id)).usedCount, 0)
  assert.equal((await grant(scopedFirst.id, scopedBuyer.id))?.consumedAt, null)
  assert.equal(await balance(scopedBuyer.id), 30_000)
  assert.equal((await order(scopedNew.displayId)).status, 'PENDING_PAYMENT')
  assert.equal((await campaign(scopedOrdinary.id)).usedCount, 1)
  assert((await grant(scopedOrdinary.id, scopedBuyer.id))?.consumedAt)
  assert.equal((await reservation(scopedBuyer.id)).length, 0)
  assert.equal((await service.preview(scopedBuyer.id, { ...simple, couponCode: scopedFirst.code })).coupon?.valid, false,
    'an independent pending order keeps FIRST unavailable after the original entitlement releases')
  await scopedOriginalCallback()
  assert.equal((await campaign(scopedOrdinary.id)).usedCount, 1)
  assert.equal((await ledger(scopedOriginalRow.id)).filter(row => row.type === 'DEPOSIT').length, 1)
  await scopedNewCallback()
  assert.equal((await campaign(scopedOrdinary.id)).usedCount, 0)
  assert.equal((await grant(scopedOrdinary.id, scopedBuyer.id))?.consumedAt, null)
  assert.equal((await service.preview(scopedBuyer.id, { ...simple, couponCode: scopedFirst.code })).coupon?.valid, true)
  passed('original late failure releases only its wallet/FIRST/private-grant holds while the independent order retains its own coupon reservation')

  const sharedPublicBuyer = await makeUser()
  await fund(sharedPublicBuyer.id, 30_000)
  const sharedPublic = await makeCoupon({ maxUses: 2 })
  const sharedPublicInput = { ...simple, couponCode: sharedPublic.code }
  const publicOriginal = await service.checkout(sharedPublicBuyer.id, sharedPublicInput)
  const publicOriginalCallback = await startPayment(publicOriginal)
  const publicNew = await service.checkout(sharedPublicBuyer.id, sharedPublicInput)
  const publicNewCallback = await startPayment(publicNew)
  assert.equal((await campaign(sharedPublic.id)).usedCount, 2)
  assert.equal(publicNew.breakdown.walletDeduction, 0)
  assert.equal((await reservation(sharedPublicBuyer.id))[0]!.orderId, (await order(publicOriginal.displayId)).id)
  verdict = 'failed'
  await publicOriginalCallback()
  assert.equal((await campaign(sharedPublic.id)).usedCount, 1)
  assert.equal((await order(publicNew.displayId)).status, 'PENDING_PAYMENT')
  verdict = 'success'
  await Promise.all([publicNewCallback(), publicNewCallback()])
  assert.equal((await campaign(sharedPublic.id)).usedCount, 1)
  assert.equal((await db.select().from(couponRedemptions).where(and(
    eq(couponRedemptions.couponId, sharedPublic.id), eq(couponRedemptions.userId, sharedPublicBuyer.id),
  ))).length, 1)
  verdict = 'failed'
  await publicOriginalCallback()
  assert.equal((await campaign(sharedPublic.id)).usedCount, 1)
  assert.equal(await balance(sharedPublicBuyer.id), 30_000)
  passed('independent pending orders reserve a public coupon separately; old failure releases one use and new success consumes exactly one')

  const legacyGrantBuyer = await makeUser()
  const legacyGrantCoupon = await makeCoupon({ rules: [{ type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
  const legacyGrantInput = { ...simple, couponCode: legacyGrantCoupon.code }
  const legacyGrantOrder = await service.checkout(legacyGrantBuyer.id, legacyGrantInput)
  await db.update(couponGrants).set({ consumedAt: null }).where(and(
    eq(couponGrants.couponId, legacyGrantCoupon.id), eq(couponGrants.userId, legacyGrantBuyer.id),
  ))
  assert.equal((await service.preview(legacyGrantBuyer.id, legacyGrantInput)).coupon?.valid, false,
    'a legacy pending order owns its private grant even before consumedAt was introduced')
  await assert.rejects(() => service.checkout(legacyGrantBuyer.id, legacyGrantInput), firstCouponUnavailable)
  const legacyGrantIndependent = await service.checkout(legacyGrantBuyer.id, simple)
  assert.notEqual(legacyGrantIndependent.displayId, legacyGrantOrder.displayId)
  assert.equal((await campaign(legacyGrantCoupon.id)).usedCount, 1)
  passed('legacy unreserved private grants cannot be reused by another order; independent checkout without that held coupon still succeeds')

  // Historical overlaps cannot be created through checkout anymore. Construct
  // their existing financial snapshots explicitly to verify scoped release.
  for (const originalOutcome of ['failure', 'refund'] as const) {
    for (const newerOutcome of ['pending', 'success'] as const) {
      const buyer = await makeUser()
      await fund(buyer.id, 30_000)
      const coupon = await makeCoupon({ maxUses: 3, rules: [{ type: 'REGISTERED_DAYS_AGO', params: { days: 1 } }] })
      const original = await service.checkout(buyer.id, { ...simple, couponCode: coupon.code })
      const originalCallback = await startPayment(original)
      if (originalOutcome === 'refund') {
        verdict = 'success'
        await originalCallback()
      }
      const originalRow = await order(original.displayId)
      const newer = await service.checkout(buyer.id, simple)
      const newerRow = await order(newer.displayId)
      const legacyBreakdown = { ...originalRow.breakdown, walletDeduction: 0, amountPaidOnline: originalRow.totalAmount }
      await db.update(orders).set({ couponId: coupon.id, couponEligibleSubtotal: originalRow.couponEligibleSubtotal,
        totalAmount: originalRow.totalAmount, breakdown: legacyBreakdown,
      }).where(eq(orders.id, newerRow.id))
      await db.update(payments).set({ amount: legacyBreakdown.amountPaidOnline }).where(eq(payments.id, newer.paymentId!))
      const [originalItem] = await db.select().from(orderItems).where(eq(orderItems.orderId, originalRow.id))
      await db.update(orderItems).set({ couponDiscountAmount: originalItem!.couponDiscountAmount }).where(eq(orderItems.orderId, newerRow.id))
      await db.update(coupons).set({ usedCount: 2 }).where(eq(coupons.id, coupon.id))
      await db.update(couponGrants).set({ consumedAt: new Date() }).where(and(
        eq(couponGrants.couponId, coupon.id), eq(couponGrants.userId, buyer.id),
      ))
      const newerCallback = await startPayment(newer)
      if (newerOutcome === 'success') {
        verdict = 'success'
        await newerCallback()
      }
      const ownedGrant = (await grant(coupon.id, buyer.id))!.consumedAt
      assert(ownedGrant)
      if (originalOutcome === 'failure') {
        verdict = 'failed'
        await originalCallback()
      } else {
        await service.refund(original.displayId, 'Legacy shared private-grant regression')
      }
      assert.equal((await campaign(coupon.id)).usedCount, 1)
      assert.deepEqual((await grant(coupon.id, buyer.id))!.consumedAt, ownedGrant,
        'old terminal result cannot release a private grant still owned by a newer pending order/redemption')
      assert.equal((await order(newer.displayId)).status, newerOutcome === 'pending' ? 'PENDING_PAYMENT' : 'PAID')
      assert.equal((await db.select().from(couponRedemptions).where(and(
        eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.userId, buyer.id),
      ))).length, newerOutcome === 'success' ? 1 : 0)
      await assert.rejects(() => service.checkout(buyer.id, { ...simple, couponCode: coupon.code }), firstCouponUnavailable)
      if (originalOutcome === 'failure') await originalCallback()
      else await assert.rejects(() => service.refund(original.displayId, 'Duplicate legacy refund'))
      assert.deepEqual((await grant(coupon.id, buyer.id))!.consumedAt, ownedGrant)
      assert.equal((await campaign(coupon.id)).usedCount, 1)
      const independent = await service.checkout(buyer.id, simple)
      assert.notEqual(independent.displayId, newer.displayId)
      passed(`legacy private-grant overlap: original ${originalOutcome} retains newer ${newerOutcome} ownership while independent checkout proceeds`)
    }
  }

  const staleRacer = await makeUser()
  await fund(staleRacer.id, 20_000)
  const raceCoupon = await makeCoupon({ maxUses: 1, rules: [firstRule] })
  const raceInput = { ...simple, couponCode: raceCoupon.code }
  const raceStale = await service.checkout(staleRacer.id, raceInput)
  const raceCallback = await startPayment(raceStale)
  const raceStaleOrder = await order(raceStale.displayId)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, raceStaleOrder.id))
  verdict = 'failed'
  await paymentService.reconcileCustomerPendingOrders(staleRacer.id)
  const replacements = await Promise.allSettled([service.checkout(staleRacer.id, raceInput), service.checkout(staleRacer.id, raceInput)])
  assert.equal(replacements.filter(result => result.status === 'fulfilled').length, 1)
  const raceOrders = await db.select().from(orders).where(eq(orders.userId, staleRacer.id))
  const racePending = raceOrders.filter(row => row.status === 'PENDING_PAYMENT')
  assert.equal(racePending.length, 1)
  assert.equal(raceOrders.filter(row => row.status === 'CANCELED').length, 1)
  assert.equal((await reservation(staleRacer.id))[0]!.orderId, racePending[0]!.id)
  assert.equal((await campaign(raceCoupon.id)).usedCount, 1)
  assert((await grant(raceCoupon.id, staleRacer.id))?.consumedAt)
  assert.equal((await ledger(raceStaleOrder.id)).filter(row => row.type === 'DEPOSIT').length, 1)
  assert.equal(await balance(staleRacer.id), 0)
  await raceCallback()
  assert.equal((await reservation(staleRacer.id))[0]!.orderId, racePending[0]!.id, 'late failure cannot release replacement first-purchase reservation')
  assert.equal((await campaign(raceCoupon.id)).usedCount, 1)
  passed('after explicit stale failure audit, concurrent FIRST requests consume one entitlement and late original callbacks preserve it')

  // A disabled or edited campaign after preview must never reuse the preview decision.
  const editedBuyer = await makeUser()
  const editedCoupon = await makeCoupon()
  const editedInput = { ...simple, couponCode: editedCoupon.code }
  assert.equal((await service.preview(editedBuyer.id, editedInput)).coupon?.valid, true)
  await couponService.setActive(editedCoupon.id, false)
  await assert.rejects(() => service.checkout(editedBuyer.id, editedInput))
  assert.equal((await campaign(editedCoupon.id)).usedCount, 0)
  assert.equal((await db.select().from(orders).where(eq(orders.userId, editedBuyer.id))).length, 0)
  assert(pastSuccess)
  passed('final checkout independently validates current campaign state instead of trusting preview')
  console.log(`Coupon upgrade: ${checks} scenarios passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
