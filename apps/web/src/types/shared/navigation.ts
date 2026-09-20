// src/types/navigation.ts
import type { ReactNode } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  exact?: boolean
}