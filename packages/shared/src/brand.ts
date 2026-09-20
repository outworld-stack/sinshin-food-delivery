// packages/shared/src/brand.ts
// برندها — منبع واحد. api و web هر دو از اینجا می‌گیرند.

declare const __brand: unique symbol

export type Brand<T, B extends string> = T & {
  readonly [__brand]: B
}

// ── Domain IDs ──
export type UserId = Brand<string, 'UserId'>
export type OrderId = Brand<string, 'OrderId'>
export type CampaignId = Brand<string, 'CampaignId'>
export type ConditionId = Brand<string, 'ConditionId'>
export type ProductId = Brand<string, 'ProductId'>
export type SizeId = Brand<string, 'SizeId'>
export type AddressId = Brand<string, 'AddressId'>
export type PaymentId = Brand<string, 'PaymentId'>
export type SessionToken = Brand<string, 'SessionToken'>
export type SessionId = Brand<string, 'SessionId'>
export type DeviceId = Brand<string, 'DeviceId'>
export type DeviceFingerprint = Brand<string, 'DeviceFingerprint'>
export type ReferralCode = Brand<string, 'ReferralCode'>
export type MainCategoryId = Brand<string, 'MainCategoryId'>
export type CategoryId = Brand<string, 'CategoryId'>
export type CourierId = Brand<string, 'CourierId'>
export type SubAdminId = Brand<string, 'SubAdminId'>
export type ReviewId = Brand<string, 'ReviewId'>
export type GalleryImageId = Brand<string, 'GalleryImageId'>

/** نقاط cast مجاز — برای audit مرزها grep کن */
export const asUserId = (v: string): UserId => v as UserId
export const asOrderId = (v: string): OrderId => v as OrderId
export const asCampaignId = (v: string): CampaignId => v as CampaignId
export const asConditionId = (v: string): ConditionId => v as ConditionId
export const asProductId = (v: string): ProductId => v as ProductId
export const asSizeId = (v: string): SizeId => v as SizeId
export const asAddressId = (v: string): AddressId => v as AddressId
export const asPaymentId = (v: string): PaymentId => v as PaymentId
export const asSessionToken = (v: string): SessionToken => v as SessionToken
export const asSessionId = (v: string): SessionId => v as SessionId
export const asDeviceId = (v: string): DeviceId => v as DeviceId
export const asDeviceFingerprint = (v: string): DeviceFingerprint => v as DeviceFingerprint
export const asReferralCode = (v: string): ReferralCode => v as ReferralCode
export const asMainCategoryId = (v: string): MainCategoryId => v as MainCategoryId
export const asCategoryId = (v: string): CategoryId => v as CategoryId
export const asCourierId = (v: string): CourierId => v as CourierId
export const asSubAdminId = (v: string): SubAdminId => v as SubAdminId
export const asReviewId = (v: string): ReviewId => v as ReviewId
export const asGalleryImageId = (v: string): GalleryImageId => v as GalleryImageId