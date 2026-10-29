import {
	RESTAURANT_TIME_PATTERN,
	type RestaurantHoursDto,
} from '@sinshin/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, memo, useRef, useState } from 'react'
import { Clock } from 'reicon-react'
import { setRestaurantHours } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { restaurantHoursOptions } from '#/utils/queryOptions'

const TIME_PATTERN = new RegExp(RESTAURANT_TIME_PATTERN)

export const RestaurantHoursForm = memo(function RestaurantHoursForm() {
	const queryClient = useQueryClient()
	const showToast = useToastStore((state) => state.showToast)
	const {
		data: hours,
		isError,
		isFetching,
		refetch,
	} = useQuery(restaurantHoursOptions)
	// Keep a complete draft once editing starts; a background refresh must not
	// replace either field before the admin explicitly saves it.
	const [draft, setDraft] = useState<RestaurantHoursDto | null>(null)
	const [error, setError] = useState('')
	const submitting = useRef(false)
	const current = draft ?? hours
	const dirty =
		draft !== null &&
		(draft.openingTime !== hours?.openingTime ||
			draft.closingTime !== hours?.closingTime)
	const mutation = useMutation({
		mutationFn: (data: RestaurantHoursDto) => setRestaurantHours({ data }),
		onSuccess: async (saved) => {
			// An older request must not replace the acknowledged hours in the
			// footer. The returned value is also the form's new saved baseline.
			await queryClient.cancelQueries({ queryKey: qk.restaurantHours })
			queryClient.setQueryData(qk.restaurantHours, saved)
			showToast('ساعت کاری رستوران ذخیره شد')
		},
	})
	const disabled = hours === undefined || mutation.isPending

	function change(field: keyof RestaurantHoursDto, value: string) {
		if (!current || disabled || submitting.current) return
		setDraft({ ...current, [field]: value })
		setError('')
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!current || disabled || !dirty || submitting.current) return
		if (
			!TIME_PATTERN.test(current.openingTime) ||
			!TIME_PATTERN.test(current.closingTime)
		) {
			setError('ساعت باز شدن و بسته شدن را به‌درستی وارد کنید.')
			return
		}
		if (current.openingTime === current.closingTime) {
			setError('ساعت باز شدن و بسته شدن باید متفاوت باشند.')
			return
		}
		submitting.current = true
		setError('')
		try {
			await mutation.mutateAsync(current)
			setDraft(null)
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : 'ذخیره ساعت کاری ناموفق بود.'
			setError(message)
			showToast(message, 'error')
		} finally {
			submitting.current = false
		}
	}

	return (
		<form
			onSubmit={submit}
			className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]"
		>
			<h3 className="flex items-center gap-2 font-DanaDemiBold text-sm text-gray-800 dark:text-white">
				<Clock size={18} className="text-primary dark:text-dark-primary" />
				ساعت کاری روزانه
			</h3>
			<p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
				این ساعت‌ها هر روز در پایین سایت به مشتریان نمایش داده می‌شوند.
			</p>
			<fieldset
				disabled={disabled}
				className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3"
			>
				<label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300">
					ساعت باز شدن
					<input
						type="time"
						name="openingTime"
						dir="ltr"
						required
						step={60}
						value={current?.openingTime ?? ''}
						onChange={(event) => change('openingTime', event.target.value)}
						className="mt-2 w-full px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm disabled:opacity-60"
					/>
				</label>
				<label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300">
					ساعت بسته شدن
					<input
						type="time"
						name="closingTime"
						dir="ltr"
						required
						step={60}
						value={current?.closingTime ?? ''}
						onChange={(event) => change('closingTime', event.target.value)}
						className="mt-2 w-full px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm disabled:opacity-60"
					/>
				</label>
			</fieldset>
			<p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
				اگر ساعت بسته شدن از ساعت باز شدن کمتر باشد، پایان کار در روز بعد است؛
				برای نیمه‌شب ۰۰:۰۰ را انتخاب کنید.
			</p>
			{hours === undefined && !isError && (
				<output className="block mt-3 text-xs text-gray-500">
					در حال دریافت ساعت کاری…
				</output>
			)}
			{isError && (
				<p className="mt-3 text-xs text-red-500" role="alert">
					دریافت ساعت کاری ناموفق بود.
					<button
						type="button"
						onClick={() => void refetch()}
						disabled={isFetching || mutation.isPending}
						className="mr-2 underline cursor-pointer disabled:opacity-60"
					>
						تلاش مجدد
					</button>
				</p>
			)}
			{error && (
				<p className="mt-3 text-xs text-red-500" role="alert">
					{error}
				</p>
			)}
			<button
				type="submit"
				disabled={disabled || !dirty}
				className="mt-3 px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{mutation.isPending ? 'در حال ذخیره…' : 'ذخیره ساعت کاری'}
			</button>
		</form>
	)
})
