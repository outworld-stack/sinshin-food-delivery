// src/components/admin/users/UsersFilterBox.tsx
// stage-70 — فیلترهای دستگاه «واقعی» شدند: نوع (موبایل/تبلت/رایانه) و برند
// (اپل/سامسونگ/شیائومی/…) به‌جای سه گزینه‌ی mock — از ستون‌های device_type /
// device_brand دیتابیس فیلتر می‌کنند و کارت‌ها «نام دستگاه» واقعی نشان می‌دهند.
import { memo, useCallback } from 'react'
import {
        FILTER_LABEL_CLS,
        FILTER_INPUT_CLS as INPUT_CLS,
        MobileFilterTrigger,
} from '#/components/admin/filters'
import type { AdminUserFilterProps } from '#/types/shared/ui'
import type { AmountSortDir, UserSortDir } from '#/utils/queryOptions'

interface UsersFilterBoxProps extends AdminUserFilterProps {
        isMobileModal?: boolean
}

/** stage-70 — برندهای قراردادی فیلتر (هم‌راستا با zod-catch اسکیمای URL)؛
 *  stage-72 (P2-۱۶) — برندهای دسکتاپ اضافه شدند */
const KNOWN_BRANDS = [
    'apple',
    'samsung',
    'xiaomi',
    'huawei',
    'honor',
    'google',
    'windows',
    'macos',
    'linux',
    'other',
] as const

// محتوای فیلتر کاربران — مشترک دسکتاپ/مودال (DRY)
export const UsersFilterBox = memo(function UsersFilterBox({
        tempSearch,
        setTempSearch,
        tempDeviceType,
        setTempDeviceType,
        tempDeviceBrand,
        setTempDeviceBrand,
        tempStatus,
        setTempStatus,
        tempSortDate,
        setTempSortDate,
        tempSortWallet,
        setTempSortWallet,
        tempSortSpent,
        setTempSortSpent,
        applyFilters,
        isMobileModal = false,
}: UsersFilterBoxProps) {
        const handleSearch = useCallback(
                (e: React.ChangeEvent<HTMLInputElement>) => setTempSearch(e.target.value),
                [setTempSearch],
        )
        // stage-70 — selectهای دستگاه فقط مقادیر enum قراردادی را می‌پذیرند؛
        // مقدار زباله از DOM به پیش‌فرض برمی‌گردد (هم‌راستا با zod-catch اسکیمای URL)
        const handleDeviceType = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) => {
                        const v = e.target.value
                        setTempDeviceType(
                                v === 'mobile' || v === 'tablet' || v === 'desktop' ? v : 'all',
                        )
                },
                [setTempDeviceType],
        )
        const handleDeviceBrand = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) => {
                        const v = e.target.value
                        setTempDeviceBrand(
                                (KNOWN_BRANDS as readonly string[]).includes(v) ? v : 'all',
                        )
                },
                [setTempDeviceBrand],
        )
        const handleStatus = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) => setTempStatus(e.target.value),
                [setTempStatus],
        )
        // رارد ۴۷ — مقدار select با قرارداد enum چک می‌شود (زباله → پیش‌فرض)
        const handleDate = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) =>
                        setTempSortDate(e.target.value as UserSortDir),
                [setTempSortDate],
        )
        const handleWallet = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) =>
                        setTempSortWallet(e.target.value as AmountSortDir),
                [setTempSortWallet],
        )
        const handleSpent = useCallback(
                (e: React.ChangeEvent<HTMLSelectElement>) =>
                        setTempSortSpent(e.target.value as AmountSortDir),
                [setTempSortSpent],
        )

        const selectCls = `${INPUT_CLS} cursor-pointer`

        return (
                <div
                        className={
                                isMobileModal
                                        ? 'grid grid-cols-2 gap-4 items-end'
                                        : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9 gap-4 items-end'
                        }
                >
                        <div
                                className={
                                        isMobileModal
                                                ? 'col-span-2'
                                                : 'sm:col-span-2 lg:col-span-2 xl:col-span-2'
                                }
                        >
                                <label className={FILTER_LABEL_CLS}>جستجو (نام یا شماره)</label>
                                <input
                                        type="text"
                                        value={tempSearch}
                                        onChange={handleSearch}
                                        placeholder="0912..."
                                        className={INPUT_CLS}
                                />
                        </div>
                        <div>
                                <label htmlFor="users-filter-device-type" className={FILTER_LABEL_CLS}>نوع دستگاه</label>
                                <select
                                        id="users-filter-device-type"
                                        value={tempDeviceType}
                                        onChange={handleDeviceType}
                                        className={selectCls}
                                >
                                        <option value="all">همه</option>
                                        <option value="mobile">موبایل</option>
                                        <option value="tablet">تبلت</option>
                                        <option value="desktop">رایانه</option>
                                </select>
                        </div>
                        <div>
                                <label htmlFor="users-filter-device-brand" className={FILTER_LABEL_CLS}>برند دستگاه</label>
                                <select
                                        id="users-filter-device-brand"
                                        value={tempDeviceBrand}
                                        onChange={handleDeviceBrand}
                                        className={selectCls}
                                >
                                        <option value="all">همه برندها</option>
                                        <option value="apple">اپل</option>
                                        <option value="samsung">سامسونگ</option>
                                        <option value="xiaomi">شیائومی</option>
                                        <option value="huawei">هوآوی</option>
                                        <option value="honor">آنر</option>
                                        <option value="google">گوگل</option>
                                        <option value="windows">ویندوز</option>
                                        <option value="macos">مک</option>
                                        <option value="linux">لینوکس</option>
                                        <option value="other">سایر</option>
                                </select>
                        </div>
                        <div>
                                <label className={FILTER_LABEL_CLS}>وضعیت</label>
                                <select
                                        value={tempStatus}
                                        onChange={handleStatus}
                                        className={selectCls}
                                >
                                        <option value="all">همه</option>
                                        <option value="ACTIVE">فعال</option>
                                        <option value="SUSPENDED">مسدود</option>
                                </select>
                        </div>
                        <div>
                                <label className={FILTER_LABEL_CLS}>تاریخ ثبت‌نام</label>
                                <select
                                        value={tempSortDate}
                                        onChange={handleDate}
                                        className={selectCls}
                                >
                                        <option value="none">بدون مرتب‌سازی</option>
                                        <option value="newest">جدیدترین</option>
                                        <option value="oldest">قدیمی‌ترین</option>
                                </select>
                        </div>
                        <div>
                                <label className={FILTER_LABEL_CLS}>موجودی کیف پول</label>
                                <select
                                        value={tempSortWallet}
                                        onChange={handleWallet}
                                        className={selectCls}
                                >
                                        <option value="none">بدون مرتب‌سازی</option>
                                        <option value="highest">بیشترین</option>
                                        <option value="lowest">کمترین</option>
                                </select>
                        </div>
                        <div>
                                <label className={FILTER_LABEL_CLS}>مبلغ پرداختی</label>
                                <select
                                        value={tempSortSpent}
                                        onChange={handleSpent}
                                        className={selectCls}
                                >
                                        <option value="none">بدون مرتب‌سازی</option>
                                        <option value="highest">بیشترین</option>
                                        <option value="lowest">کمترین</option>
                                </select>
                        </div>
                        <div
                                className={
                                        isMobileModal
                                                ? 'col-span-2'
                                                : 'sm:col-span-2 lg:col-span-1 xl:col-span-1'
                                }
                        >
                                <button
                                        type="button"
                                        onClick={applyFilters}
                                        className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
                                >
                                        اعمال فیلتر
                                </button>
                        </div>
                </div>
        )
})

// تریگر موبایل — جدا
export const UsersFilterTrigger = memo(function UsersFilterTrigger({
        onClick,
}: {
        onClick: () => void
}) {
        // رارد ۴۸ — دکمه‌ی موبایل از اجزای مشترک فیلترها
        return <MobileFilterTrigger label="فیلترهای کاربران" onClick={onClick} />
})
