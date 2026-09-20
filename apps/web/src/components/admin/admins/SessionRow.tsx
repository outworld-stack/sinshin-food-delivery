// src/components/admin/admins/SessionRow.tsx
import { memo } from 'react'
import type { AdminSession } from '#/server/admin'
import { formatDate, formatTime, faNum } from '#/utils/format'
import { Eye, EyeOff } from 'reicon-react'

interface SessionRowProps {
  session: AdminSession
}

// ردیف سشن — گزارش حضور (تفکیک حضور واقعی/لاگین خالی)
export const SessionRow = memo(function SessionRow({ session }: SessionRowProps) {
  const duration = session.logoutAt
    ? (new Date(session.logoutAt).getTime() - new Date(session.loginAt).getTime()) / 60000
    : null

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-100 dark:border-white/5">
      <div className="flex items-center gap-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          session.wasActive
            ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
            : 'bg-gray-200 dark:bg-[#2a1015] text-gray-400'
        }`}>
          {session.wasActive ? <Eye size={16} /> : <EyeOff size={16} />}
        </span>
        <div>
          <p className="text-xs font-DanaMedium text-gray-700 dark:text-gray-200">
            {formatDate(session.loginAt)} • {formatTime(session.loginAt)}
            {session.logoutAt ? ` تا ${formatTime(session.logoutAt)}` : ' — آنلاین'}
          </p>
          <p className={`text-[10px] mt-0.5 ${session.wasActive ? 'text-green-500' : 'text-gray-400'}`}>
            {session.wasActive ? 'حضور و فعالیت واقعی' : 'لاگین بدون فعالیت'}
          </p>
        </div>
      </div>
      <div className="text-left">
        <p className="text-[10px] text-gray-400">مدت</p>
        <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-300">
          {duration ? `${faNum(Math.round(duration))} دقیقه` : '—'}
        </p>
      </div>
    </div>
  )
})