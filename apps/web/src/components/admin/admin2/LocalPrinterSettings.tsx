import type {
	LocalPrintAgentDto,
	LocalPrintAssignment,
	LocalPrintKind,
	LocalPrintTarget,
	LocalPrintWidth,
} from '@sinshin/shared'
import { useEffect, useRef, useState } from 'react'
import { apiBase } from '#/lib/api'
import {
	pairLocalPrintAgent,
	revokeLocalPrintAgent,
	saveLocalPrintAssignment,
} from '#/lib/localPrintQueue'

const empty: LocalPrintAssignment = { sales: null, kitchen: null }
const labels = { sales: 'فروش', kitchen: 'آشپزخانه' }
const field =
	'w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a0a0e] px-3 py-2 text-sm disabled:opacity-50'

/** The same controls and authorization rule apply to both administrator levels. */
export function LocalPrinterSettings({
	agents,
	assignment,
	canManage,
	disabled,
	onSaved,
}: {
	agents: LocalPrintAgentDto[]
	assignment: LocalPrintAssignment | undefined
	canManage: boolean
	disabled: boolean
	onSaved: () => Promise<unknown>
}) {
	const [draft, setDraft] = useState<LocalPrintAssignment>(assignment ?? empty)
	const [busy, setBusy] = useState(false)
	const busyRef = useRef(false)
	const [error, setError] = useState('')
	const [name, setName] = useState('صندوق رستوران')
	const [pairing, setPairing] = useState<{
		name: string
		token: string
	} | null>(null)
	useEffect(() => {
		if (assignment) setDraft(assignment)
	}, [assignment])
	const locked = disabled || busy || !canManage
	const change = (kind: LocalPrintKind, target: LocalPrintTarget | null) => {
		if (!locked) setDraft((current) => ({ ...current, [kind]: target }))
	}
	const run = async (action: () => Promise<unknown>) => {
		if (locked || busyRef.current) return
		busyRef.current = true
		setBusy(true)
		setError('')
		try {
			await action()
			await onSaved()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'ذخیره تنظیمات ناموفق بود')
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}
	return (
		<details className="rounded-xl border border-gray-200 dark:border-white/10 p-3">
			<summary className="cursor-pointer text-sm font-DanaDemiBold">
				تنظیم چاپگر و اتصال صندوق
			</summary>
			<div className="mt-3 space-y-4 text-sm">
				<p className="text-gray-500 dark:text-gray-400">
					عامل چاپ روی رایانهٔ ویندوز صندوق اجرا می‌شود. سفارش چاپ از موبایل، تبلت
					و رایانه به همین صندوق ارسال می‌شود.
				</p>
				{!canManage && (
					<output className="block">
						تغییر تنظیمات و ارسال مستقیم نیازمند مجوز «چاپ و مدیریت چاپگر» است.
					</output>
				)}
				{(['sales', 'kitchen'] as const).map((kind) => {
					const target = draft[kind]
					const value = target
						? JSON.stringify([target.agentId, target.printerName])
						: ''
					const available = agents.some(
						(agent) =>
							agent.id === target?.agentId &&
							agent.printers.some(
								(printer) => printer.name === target.printerName,
							),
					)
					return (
						<fieldset
							key={kind}
							disabled={locked || !assignment}
							className="space-y-2 rounded-lg bg-gray-50 dark:bg-white/5 p-3"
						>
							<legend className="font-DanaMedium">چاپگر {labels[kind]}</legend>
							<label className="block">
								صف چاپ ویندوز
								<select
									aria-label={`چاپگر ${labels[kind]}`}
									value={value}
									className={field}
									onChange={(event) => {
										if (!event.target.value) {
											change(kind, null)
											return
										}
										const [agentId, printerName] = JSON.parse(
											event.target.value,
										) as [string, string]
										change(kind, {
											agentId,
											printerName,
											widthDots: target?.widthDots ?? 576,
											mode: target?.mode ?? 'driver',
											cut: target?.cut ?? true,
										})
									}}
								>
									<option value="">انتخاب چاپگر</option>
									{target && !available && (
										<option value={value} disabled>
											{target.printerName} — در فهرست فعلی نیست
										</option>
									)}
									{agents.map((agent) => (
										<optgroup
											key={agent.id}
											label={`${agent.name} — ${agent.online ? 'متصل' : 'قطع ارتباط'}`}
										>
											{agent.printers.map((printer) => (
												<option
													key={printer.name}
													value={JSON.stringify([agent.id, printer.name])}
												>
													{printer.name}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</label>
							{target && (
								<>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
										<label>
											عرض رسید
											<select
												aria-label={`عرض رسید ${labels[kind]}`}
												className={field}
												value={target.widthDots}
												onChange={(event) =>
													change(kind, {
														...target,
														widthDots: Number(
															event.target.value,
														) as LocalPrintWidth,
													})
												}
											>
												<option value={576}>۸۰ میلی‌متر</option>
												<option value={384}>۵۸ میلی‌متر — ۳۸۴ نقطه</option>
												<option value={420}>۵۸ میلی‌متر — ۴۲۰ نقطه</option>
											</select>
										</label>
										<label>
											روش چاپ
											<select
												aria-label={`روش چاپ ${labels[kind]}`}
												className={field}
												value={target.mode}
												onChange={(event) =>
													change(kind, {
														...target,
														mode:
															event.target.value === 'escpos'
																? 'escpos'
																: 'driver',
													})
												}
											>
												<option value="driver">درایور ویندوز (پیشنهادی)</option>
												<option value="escpos">چاپگر سازگار با ESC/POS</option>
											</select>
										</label>
									</div>
									{target.mode === 'escpos' && (
										<label className="flex gap-2 items-center">
											<input
												type="checkbox"
												checked={target.cut}
												onChange={(event) =>
													change(kind, { ...target, cut: event.target.checked })
												}
											/>
											برش خودکار کاغذ
										</label>
									)}
								</>
							)}
						</fieldset>
					)
				})}
				<button
					type="button"
					disabled={locked || !assignment}
					onClick={() => void run(() => saveLocalPrintAssignment(draft))}
					className="rounded-lg bg-primary text-white px-4 py-2 disabled:opacity-50"
				>
					ذخیره چاپگرها
				</button>
				<details className="border-t border-gray-200 dark:border-white/10 pt-3">
					<summary className="cursor-pointer">
						افزودن یا تعویض رایانهٔ صندوق
					</summary>
					<div className="space-y-3 pt-3">
						<label className="block">
							نام رایانه
							<input
								aria-label="نام رایانه صندوق"
								className={field}
								value={name}
								disabled={locked}
								maxLength={60}
								onChange={(event) => setName(event.target.value)}
							/>
						</label>
						<button
							type="button"
							disabled={locked || !name.trim()}
							className="rounded-lg border px-3 py-2 disabled:opacity-50"
							onClick={() =>
								void run(async () => {
									const result = await pairLocalPrintAgent(name.trim())
									setPairing({ name: result.agent.name, token: result.token })
								})
							}
						>
							ایجاد کد اتصال
						</button>
						{pairing && canManage && (
							<div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
								<p>
									این کد فقط اکنون نمایش داده می‌شود. آن را در تنظیمات عامل چاپِ{' '}
									{pairing.name} وارد کنید.
								</p>
								<label className="block">
									نشانی API
									<input
										aria-label="نشانی API عامل چاپ"
										className={field}
										dir="ltr"
										readOnly
										value={apiBase()}
									/>
								</label>
								<label className="block">
									کد اتصال
									<textarea
										aria-label="کد اتصال عامل چاپ"
										className={field}
										dir="ltr"
										readOnly
										value={pairing.token}
									/>
								</label>
								<button
									type="button"
									onClick={() => setPairing(null)}
									className="underline"
								>
									کد را ذخیره کردم؛ پنهان شود
								</button>
							</div>
						)}
						{agents.map((agent) => (
							<div
								key={agent.id}
								className="flex flex-wrap justify-between gap-2"
							>
								<span>
									{agent.name} — {agent.online ? 'متصل' : 'قطع ارتباط'}
								</span>
								<button
									type="button"
									disabled={locked}
									className="text-red-600 disabled:opacity-50"
									onClick={() => {
										if (
											!locked &&
											window.confirm(
												`اتصال «${agent.name}» لغو شود؟ کارهای دریافت‌نشده نباید بعداً چاپ شوند.`,
											)
										)
											void run(() => revokeLocalPrintAgent(agent.id))
									}}
								>
									لغو اتصال
								</button>
							</div>
						))}
						<p className="text-gray-500">
							با تعویض چاپگر، درایور جدید را در ویندوز نصب و نام جدید را در
							فهرست بالا انتخاب کنید. برش در حالت درایور از تنظیمات خود چاپگر
							کنترل می‌شود.
						</p>
					</div>
				</details>
				{error && (
					<p role="alert" className="text-red-600">
						{error}
					</p>
				)}
			</div>
		</details>
	)
}
