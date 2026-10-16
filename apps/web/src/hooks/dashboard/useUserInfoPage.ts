// src/hooks/dashboard/useUserInfoPage.ts

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useReducer } from 'react'
import { useI18n } from '#/i18n'
import { updateUserProfile } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'

// --- وضعیت: فرم پروفایل + پرچم ویرایش ---
interface UserInfoState {
	firstName: string
	lastName: string
	email: string
	isDirty: boolean // ⬅ کاربر چیزی دستکاری کرده؟
}

type UserInfoAction =
	| { type: 'SET_FIELD'; field: keyof UserInfoState; payload: string }
	| { type: 'HYDRATE'; payload: Omit<UserInfoState, 'isDirty'> }
	| { type: 'MARK_SAVED' }

const initialUserInfoState: UserInfoState = {
	firstName: '',
	lastName: '',
	email: '',
	isDirty: false,
}

function userInfoReducer(
	state: UserInfoState,
	action: UserInfoAction,
): UserInfoState {
	switch (action.type) {
		case 'SET_FIELD':
			return { ...state, [action.field]: action.payload, isDirty: true }
		// stage-71 — رفع حلقه‌ی «Maximum update depth» در /dashboard/info:
		// HYDRATE قبلاً همیشه آبجکت جدید برمی‌گرداند؛ همراه با dep «آبجکتِ inline» در
		// افکت پایین، dispatch→رندر→افکت→dispatch بی‌نهایت می‌شد. حالا اگر مقادیر همانِ
		// وضعیت فعلی باشد همان رفرنس برمی‌گردد (React خودش از رندر صرف‌نظر می‌کند).
		case 'HYDRATE': {
			const next = { ...action.payload, isDirty: false }
			return next.firstName === state.firstName &&
				next.lastName === state.lastName &&
				next.email === state.email &&
				!state.isDirty
				? state
				: next
		}
		case 'MARK_SAVED':
			return state.isDirty ? { ...state, isDirty: false } : state
		default:
			return state
	}
}

// --- هوک ---
export function useUserInfoPage(
	profile:
		| {
				firstName?: string | null
				lastName?: string | null
				email?: string | null
		  }
		| undefined,
) {
	const [state, dispatch] = useReducer(userInfoReducer, initialUserInfoState)
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const { t } = useI18n()

	// سینک از سرور فقط وقتی کاربر دست نزده — ویرایش‌ها امن می‌مونن
	// stage-71 — گارد مقایسه‌ی «مقداری» قبل از dispatch: والد (routes/dashboard/info)
	// پروفایل را به‌صورت آبجکتِ inline می‌سازد که هر رندر رفرنس تازه دارد؛ بدون این
	// گارد افکت هر بار HYDRATE می‌فرستاد (حلقه‌ی رندر بی‌نهایت). حالا فقط وقتی
	// مقدار واقعاً با سرور فرق دارد سینک می‌شود — همان معنای قبلی، بدون حلقه.
	useEffect(() => {
		if (profile && !state.isDirty) {
			const firstName = profile.firstName ?? ''
			const lastName = profile.lastName ?? ''
			const email = profile.email ?? ''
			if (
				state.firstName !== firstName ||
				state.lastName !== lastName ||
				state.email !== email
			) {
				dispatch({
					type: 'HYDRATE',
					payload: { firstName, lastName, email },
				})
			}
		}
	}, [profile, state.isDirty, state.firstName, state.lastName, state.email])

	const handleFieldChange = useCallback(
		(field: keyof UserInfoState, value: string) => {
			dispatch({ type: 'SET_FIELD', field, payload: value })
		},
		[],
	)

	const updateMutation = useMutation({
		mutationFn: (data: {
			firstName?: string
			lastName?: string
			email?: string
		}) => updateUserProfile(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: qk.userProfile })
			showToast(t['dash.info.savedToast'])
			dispatch({ type: 'MARK_SAVED' }) // ⬅ بعد ذخیره، اجازه‌ی سینک مجدد با داده‌ی تازه
		},
	})

	const handleSubmit = useCallback(() => {
		updateMutation.mutate({
			firstName: state.firstName,
			lastName: state.lastName,
			email: state.email,
		})
	}, [state, updateMutation])

	return {
		state,
		updateMutation,
		handleFieldChange,
		handleSubmit,
	}
}
