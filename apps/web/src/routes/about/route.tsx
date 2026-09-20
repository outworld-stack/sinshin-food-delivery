// src/routes/about/route.tsx
import { createFileRoute } from '@tanstack/react-router'
import { MainLayout } from '#/components/MainLayout'

export const Route = createFileRoute('/about')({
  component: MainLayout,
})