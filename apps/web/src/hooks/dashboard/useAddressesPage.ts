// src/hooks/dashboard/useAddressesPage.ts
import { useReducer, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteUserAddress } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'

// --- State ---
interface AddressesState {
  isModalOpen: boolean
  editingId: string | null
  isDeleteModalOpen: boolean
  addressToDelete: string | null
}

type AddressesAction =
  | { type: 'OPEN_NEW' }
  | { type: 'OPEN_EDIT'; payload: string }
  | { type: 'CLOSE_MODAL' }
  | { type: 'OPEN_DELETE'; payload: string }
  | { type: 'CLOSE_DELETE' }

const initialAddressesState: AddressesState = {
  isModalOpen: false,
  editingId: null,
  isDeleteModalOpen: false,
  addressToDelete: null,
}

function addressesReducer(state: AddressesState, action: AddressesAction): AddressesState {
  switch (action.type) {
    case 'OPEN_NEW': return { ...state, isModalOpen: true, editingId: null }
    case 'OPEN_EDIT': return { ...state, isModalOpen: true, editingId: action.payload }
    case 'CLOSE_MODAL': return { ...state, isModalOpen: false, editingId: null }
    case 'OPEN_DELETE': return { ...state, isDeleteModalOpen: true, addressToDelete: action.payload }
    case 'CLOSE_DELETE': return { ...state, isDeleteModalOpen: false, addressToDelete: null }
    default: return state
  }
}

// --- هوک — فقط UI state؛ فرم داخل مودال خودش state داره ---
export function useAddressesPage() {
  const [state, dispatch] = useReducer(addressesReducer, initialAddressesState)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const handleOpenEdit = useCallback((id: string) => dispatch({ type: 'OPEN_EDIT', payload: id }), [])


  // حذف
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUserAddress(id), onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      showToast('آدرس حذف شد')
      dispatch({ type: 'CLOSE_DELETE' })
    },
  })

  // باز/بسته
  const handleOpenNew = useCallback(() => dispatch({ type: 'OPEN_NEW' }), [])
  const handleCloseModal = useCallback(() => dispatch({ type: 'CLOSE_MODAL' }), [])
  const handleOpenDelete = useCallback((id: string) => dispatch({ type: 'OPEN_DELETE', payload: id }), [])
  const handleCloseDelete = useCallback(() => dispatch({ type: 'CLOSE_DELETE' }), [])
  const handleConfirmDelete = useCallback(() => {
    if (state.addressToDelete) deleteMutation.mutate(state.addressToDelete)
  }, [state.addressToDelete, deleteMutation])

  return {
    state,
    deleteMutation,
    handleOpenEdit,
    handleOpenNew,
    handleCloseModal,
    handleOpenDelete,
    handleCloseDelete,
    handleConfirmDelete,
  }
}