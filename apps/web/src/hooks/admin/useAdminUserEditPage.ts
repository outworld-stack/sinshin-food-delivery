// src/hooks/admin/useAdminUserEditPage.ts
import { useReducer, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAdminUser } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'

// --- State: فرم + قفل‌ها + مودال‌ها + پرچم ویرایش ---
interface UserEditState {
  firstName: string
  lastName: string
  email: string
  phone: string
  referralCode: string
  isPhoneEditable: boolean
  isReferralEditable: boolean
  confirmUnlockPhone: boolean
  confirmUnlockReferral: boolean
  isDirty: boolean          // ⬅
}

type UserEditAction =
  | { type: 'SET_FIELD'; field: 'firstName' | 'lastName' | 'email' | 'phone' | 'referralCode'; payload: string }
  | { type: 'HYDRATE'; payload: Pick<UserEditState, 'firstName' | 'lastName' | 'email' | 'phone' | 'referralCode'> }
  | { type: 'REQUEST_UNLOCK_PHONE' }
  | { type: 'REQUEST_UNLOCK_REFERRAL' }
  | { type: 'UNLOCK_PHONE' }
  | { type: 'UNLOCK_REFERRAL' }
  | { type: 'CLOSE_UNLOCK_PHONE' }
  | { type: 'CLOSE_UNLOCK_REFERRAL' }
  | { type: 'MARK_SAVED' }

const initialState: UserEditState = {
  firstName: '', lastName: '', email: '', phone: '', referralCode: '',
  isPhoneEditable: false,
  isReferralEditable: false,
  confirmUnlockPhone: false,
  confirmUnlockReferral: false,
  isDirty: false,
}

function userEditReducer(state: UserEditState, action: UserEditAction): UserEditState {
  switch (action.type) {
    case 'SET_FIELD': return { ...state, [action.field]: action.payload, isDirty: true }
    case 'HYDRATE': return { ...state, ...action.payload, isDirty: false }
    case 'MARK_SAVED': return { ...state, isDirty: false }
    case 'REQUEST_UNLOCK_PHONE': return { ...state, confirmUnlockPhone: true }
    case 'REQUEST_UNLOCK_REFERRAL': return { ...state, confirmUnlockReferral: true }
    case 'UNLOCK_PHONE': return { ...state, isPhoneEditable: true, confirmUnlockPhone: false }
    case 'UNLOCK_REFERRAL': return { ...state, isReferralEditable: true, confirmUnlockReferral: false }
    case 'CLOSE_UNLOCK_PHONE': return { ...state, confirmUnlockPhone: false }
    case 'CLOSE_UNLOCK_REFERRAL': return { ...state, confirmUnlockReferral: false }
    default: return state
  }
}

// --- هوک ---
export function useAdminUserEditPage(
  userId: string,
  profile: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    phone: string
    referralCode?: string | null
    id: string
  } | null | undefined,
) {
  const [state, dispatch] = useReducer(userEditReducer, initialState)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  // سینک فقط تا وقتی ادمین دست نزده
  useEffect(() => {
    if (profile && !state.isDirty) {
      dispatch({
        type: 'HYDRATE',
        payload: {
          firstName: profile.firstName ?? '',
          lastName: profile.lastName ?? '',
          email: profile.email ?? '',
          phone: profile.phone,
          referralCode: profile.referralCode ?? '',
        },
      })
    }
  }, [profile, state.isDirty])

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: string
      firstName?: string
      lastName?: string
      email?: string
      phone?: string
      referralCode?: string
    }) => updateAdminUser(data),
    onSuccess: () => {
      // جزئیات همین کاربر + لیست‌ها (اسم/شماره در لیست هم عوض می‌شه)
      queryClient.invalidateQueries({ queryKey: qk.adminUserDetails(userId) })
      queryClient.invalidateQueries({ queryKey: qk.adminUsersAll })
      showToast('اطلاعات کاربر با موفقیت ذخیره شد')
      dispatch({ type: 'MARK_SAVED' })
    },
  })

  // --- هندلرها ---
  const handleFieldChange = useCallback((field: 'firstName' | 'lastName' | 'email' | 'phone' | 'referralCode', value: string) => {
    dispatch({ type: 'SET_FIELD', field, payload: value })
  }, [])

  const handlePhoneChange = useCallback((raw: string) => {
    dispatch({ type: 'SET_FIELD', field: 'phone', payload: raw.replace(/[^0-9]/g, '') })
  }, [])

  const handleRequestUnlockPhone = useCallback(() => dispatch({ type: 'REQUEST_UNLOCK_PHONE' }), [])
  const handleRequestUnlockReferral = useCallback(() => dispatch({ type: 'REQUEST_UNLOCK_REFERRAL' }), [])
  const handleUnlockPhone = useCallback(() => dispatch({ type: 'UNLOCK_PHONE' }), [])
  const handleUnlockReferral = useCallback(() => dispatch({ type: 'UNLOCK_REFERRAL' }), [])
  const handleCloseUnlockPhone = useCallback(() => dispatch({ type: 'CLOSE_UNLOCK_PHONE' }), [])
  const handleCloseUnlockReferral = useCallback(() => dispatch({ type: 'CLOSE_UNLOCK_REFERRAL' }), [])

  const handleSubmit = useCallback(() => {
    updateMutation.mutate({
      id: userId,
      firstName: state.firstName,
      lastName: state.lastName,
      email: state.email,
      phone: state.phone,
      referralCode: state.referralCode,
    })
  }, [userId, state, updateMutation])

  return {
    state,
    updateMutation,
    handleFieldChange,
    handlePhoneChange,
    handleRequestUnlockPhone,
    handleRequestUnlockReferral,
    handleUnlockPhone,
    handleUnlockReferral,
    handleCloseUnlockPhone,
    handleCloseUnlockReferral,
    handleSubmit,
  }
}