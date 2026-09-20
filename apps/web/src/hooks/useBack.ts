// src/hooks/useBack.ts
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

// دکمه «بازگشت» — اگه تاریخچه هست برگرد، وگرنه به مقصد امن
export function useBack(fallback: '/' | '/products' | '/articles' = '/') {
  const navigate = useNavigate()
  return useCallback(() => {
    if (window.history.length > 1) window.history.back()
    else navigate({ to: fallback })
  }, [navigate, fallback])
}