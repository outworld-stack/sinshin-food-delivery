// src/components/dashboard/ReferralApplyBox.tsx
// round-12 — ثبت معرف پس از ثبت‌نام: اسکن QR کد معرف (دوربین/عکس) یا ورود دستی.
// قبلاً کد معرف فقط لحظه‌ی signup از ?ref= خوانده می‌شد؛ کاربرِ موجودِ بدون
// معرف هیچ راهی نداشت (بک‌اند referredBy را فقط در ساخت کاربر می‌نوشت).

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useState } from 'react'
import { Check, Scan } from 'reicon-react'
import { QrScannerDialog } from '#/components/shared/QrScannerDialog'
import { applyReferralCode } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { tpl, useI18n } from '#/i18n'
import { qk } from '#/utils/queryKeys'

/** QR لینک کامل است (…/referral/CODE)؛ کد خام هم پذیرفته می‌شود */
export function parseReferralInput(text: string): string | null {
        const t = text.trim()
        if (!t) return null
        const fromUrl = t.match(/\/referral\/([A-Za-z0-9-]+)/)
        if (fromUrl) return fromUrl[1].toUpperCase()
        return t.toUpperCase().slice(0, 32)
}

interface ReferralApplyBoxProps {
        onApplied?: (referrerCode: string) => void
}

export const ReferralApplyBox = memo(function ReferralApplyBox({
        onApplied,
}: ReferralApplyBoxProps) {
        const queryClient = useQueryClient()
        const showToast = useToastStore((s) => s.showToast)
        const { t, apiError } = useI18n()
        const [scannerOpen, setScannerOpen] = useState(false)
        const [manual, setManual] = useState('')

        const applyMutation = useMutation({
                mutationFn: (code: string) => applyReferralCode(code),
                onSuccess: (res) => {
                        queryClient.invalidateQueries({ queryKey: qk.userProfile })
                        showToast(tpl(t['dash.referral.appliedToast'], { n: res.referrerCode }))
                        setScannerOpen(false)
                        setManual('')
                        onApplied?.(res.referrerCode)
                },
                onError: (err: Error) => {
                        showToast(apiError(err, t['dash.referral.applyFailed']), 'error')
                },
        })

        const handleDecode = useCallback(
                (text: string) => {
                        const code = parseReferralInput(text)
                        if (!code) {
                                showToast(t['dash.referral.qrNotFound'], 'error')
                                return
                        }
                        applyMutation.mutate(code)
                },
                [applyMutation, showToast, t],
        )

        const handleManualSubmit = useCallback(() => {
                const code = parseReferralInput(manual)
                if (!code || code.length < 4) {
                        showToast(t['dash.referral.invalidCode'], 'error')
                        return
                }
                applyMutation.mutate(code)
        }, [manual, applyMutation, showToast, t])

        return (
                <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* اسکن QR */}
                                <button
                                        type="button"
                                        onClick={() => setScannerOpen(true)}
                                        disabled={applyMutation.isPending}
                                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                                >
                                        <Scan size={18} />
                                        {t['dash.referral.scanButton']}
                                </button>

                                {/* ورود دستی */}
                                <div className="flex gap-2">
                                        <input
                                                type="text"
                                                dir="ltr"
                                                value={manual}
                                                onChange={(e) => setManual(e.target.value.slice(0, 32))}
                                                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                                                placeholder="SIN-XXXXXX"
                                                disabled={applyMutation.isPending}
                                                className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary text-gray-800 dark:text-white disabled:opacity-50"
                                                aria-label={t['dash.referral.codeAria']}
                                        />
                                        <button
                                                type="button"
                                                onClick={handleManualSubmit}
                                                disabled={applyMutation.isPending || !manual.trim()}
                                                className="px-4 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                                                aria-label={t['dash.referral.submitAria']}
                                        >
                                                <Check size={18} />
                                        </button>
                                </div>
                        </div>

                        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-DanaMedium leading-relaxed text-center">
                                {t['dash.referral.desc']}
                        </p>

                        {applyMutation.isPending && (
                                <p className="text-xs text-gray-400 font-DanaMedium text-center">
                                        {t['dash.referral.applying']}
                                </p>
                        )}

                        <QrScannerDialog
                                open={scannerOpen}
                                title={t['dash.referral.scanButton']}
                                hint={t['dash.referral.scanHint']}
                                onDecode={handleDecode}
                                onClose={() => setScannerOpen(false)}
                        />
                </div>
        )
})
