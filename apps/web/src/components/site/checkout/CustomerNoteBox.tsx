// src/components/site/checkout/CustomerNoteBox.tsx
import { memo, useCallback } from 'react'
import { MessageSquare, Warning } from 'reicon-react'
import { useI18n } from '#/i18n'

interface CustomerNoteBoxProps {
	value: string
	onChange: (v: string) => void
	/**
	 *  stage-84 — رستوران شلوغ است و حالت تحویل «سرو در محل» است؟
	 *  هشدارِ نارنجیِ الزامی زیر باکس نمایش داده می‌شود (متنِ مثالِ
	 *  «علی امیری - 22») و ثبت سفارش بدون یادداشت بلاک می‌شود.
	 */
	busyDineIn?: boolean
}

export const CustomerNoteBox = memo(function CustomerNoteBox({
	value,
	onChange,
	busyDineIn,
}: CustomerNoteBoxProps) {
	const { t, fmt } = useI18n()
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			onChange(e.target.value) // برش ۳۰۰ کاراکتری داخل کاهنده
		},
		[onChange],
	)

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<div className="flex items-center justify-between mb-4">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white flex items-center gap-2">
					<MessageSquare
						size={20}
						className="text-primary dark:text-dark-primary"
					/>
					{t['checkout.noteTitle']}
				</h2>
				<span className="text-xs text-gray-400 font-DanaMedium">
					{fmt.num(value.length)}/{fmt.num(300)}
				</span>
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-3">
				{t['checkout.noteHint']}
			</p>
			<textarea
				value={value}
				onChange={handleChange}
				maxLength={300}
				className="w-full h-24 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white resize-none font-DanaMedium"
				placeholder={t['checkout.notePlaceholder']}
			/>
			{/* stage-84 — هشدار شلوغی: فقط سرو در محل + رستوران شلوغ */}
			{busyDineIn && (
				<div
					className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25"
					role="alert"
				>
					<Warning size={18} className="text-orange-500 shrink-0 mt-0.5" />
					<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
						{t['checkout.busyNoteHint']}
					</p>
				</div>
			)}
		</div>
	)
})
