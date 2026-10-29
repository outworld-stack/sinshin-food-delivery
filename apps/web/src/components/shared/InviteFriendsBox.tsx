import { QRCodeSVG } from 'qrcode.react'
import { useI18nSafe } from '#/i18n'
import { useToastStore } from '#/stores/toastStore'

interface InviteFriendsBoxProps {
  referralCode: string | null
}

export function InviteFriendsBox({ referralCode }: InviteFriendsBoxProps) {
  const { t } = useI18nSafe()
  const showToast = useToastStore((state) => state.showToast)
  const referralLink = `${window.location.origin}/referral/${encodeURIComponent(referralCode ?? '')}`

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div id="print-area" style={{ display: 'none' }}>
        <div className="print-brand-box">
          <span className="print-brand-text">سین شین</span>
        </div>
        <QRCodeSVG
          value={referralLink}
          size={400}
          bgColor="#ffffff"
          fgColor="#1a0a0e"
          level="H"
          marginSize={0}
        />
        <p className="font-DanaMedium" style={{ fontSize: '1.2rem' }}>
          {t['dash.home.printReferralText']}
        </p>
      </div>

      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 text-center md:text-right">
        {t['dash.home.inviteFriends']}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium leading-relaxed text-center md:text-right">
        {t['dash.home.inviteDesc']}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="flex flex-col items-center justify-center gap-4 p-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-gray-100 dark:border-white/5">
          <div id="printable-qr" className="p-4 bg-white rounded-2xl shadow-sm">
            <QRCodeSVG
              value={referralLink}
              size={140}
              bgColor="#ffffff"
              fgColor="#1a0a0e"
              level="H"
              marginSize={0}
            />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            {t['dash.home.printQr']}
          </button>
        </div>

        <div className="flex flex-col justify-center p-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-gray-100 dark:border-white/5">
          <h3 className="font-DanaDemiBold text-gray-700 dark:text-gray-300 text-center mb-4">
            {t['dash.home.yourInviteLink']}
          </h3>
          <div
            className="bg-white dark:bg-[#2a1015] py-3 px-4 rounded-xl text-center text-sm text-primary dark:text-dark-primary border border-dashed border-primary/30 dark:border-dark-primary/30 mb-4 break-all font-DanaMedium"
            dir="ltr"
          >
            {referralLink}
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(referralLink)
                showToast(t['dash.home.linkCopied'])
              } catch {
                showToast(t['dash.home.copyFailed'], 'error')
              }
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
          >
            {t['dash.home.copyLink']}
          </button>
        </div>
      </div>
    </div>
  )
}
