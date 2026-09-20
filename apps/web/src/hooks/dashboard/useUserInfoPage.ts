// src/hooks/dashboard/useUserInfoPage.ts
import { useReducer, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateUserProfile } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'

// --- State: فرم پروفایل + پرچم ویرایش ---
interface UserInfoState {
  firstName: string
  lastName: string
  email: string
  isDirty: boolean          // ⬅ کاربر چیزی دستکاری کرده؟
}

type UserInfoAction =
  | { type: 'SET_FIELD'; field: keyof UserInfoState; payload: string }
  | { type: 'HYDRATE'; payload: Omit<UserInfoState, 'isDirty'> }
  | { type: 'MARK_SAVED' }

const initialUserInfoState: UserInfoState = {
  firstName: '', lastName: '', email: '', isDirty: false,
}

function userInfoReducer(state: UserInfoState, action: UserInfoAction): UserInfoState {
  switch (action.type) {
    case 'SET_FIELD': return { ...state, [action.field]: action.payload, isDirty: true }
    case 'HYDRATE': return { ...action.payload, isDirty: false }
    case 'MARK_SAVED': return { ...state, isDirty: false }
    default: return state
  }
}

// --- هوک ---
export function useUserInfoPage(profile: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
} | undefined) {
  const [state, dispatch] = useReducer(userInfoReducer, initialUserInfoState)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  // سینک از سرور فقط وقتی کاربر دست نزده — ویرایش‌ها امن می‌مونن
  useEffect(() => {
    if (profile && !state.isDirty) {
      dispatch({
        type: 'HYDRATE',
        payload: {
          firstName: profile.firstName ?? '',
          lastName: profile.lastName ?? '',
          email: profile.email ?? '',
        },
      })
    }
  }, [profile, state.isDirty])

  const handleFieldChange = useCallback((field: keyof UserInfoState, value: string) => {
    dispatch({ type: 'SET_FIELD', field, payload: value })
  }, [])

  const updateMutation = useMutation({
    mutationFn: (data: { firstName?: string; lastName?: string; email?: string }) =>
      updateUserProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      showToast('اطلاعات شما با موفقیت ذخیره شد')
      dispatch({ type: 'MARK_SAVED' })   // ⬅ بعد ذخیره، اجازه‌ی سینک مجدد با داده‌ی تازه
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