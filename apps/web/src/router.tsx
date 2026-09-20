// src/router.tsx
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'
import { RootPendingFallback, RouteNotFound } from '#/components/shared/RouteFallbacks'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // ⬅ با staleTime پیش‌فرض QueryClient (۳۰s) هم‌تراز — preload ریفچ نمی‌کنه
    defaultPreloadStaleTime: 30_000,
    defaultPendingMs: 300,
    defaultPendingMinMs: 500,
    // اسکلتون‌ها حداقل 500ms نمایش داده می‌شن تا فلیکر نخوریم

    // ⬅ NEW: ترنزیشن نرم بین روت‌ها (React 19 View Transitions API)
    defaultViewTransition: true,

    // ⬅ NEW: pending و 404 پیش‌فرضِ سراسری —
    // روت‌هایی که pendingComponent/notFoundComponent خودشان را تعریف کرده‌اند
    // همان نسخه‌ی اختصاصی‌شان نمایش داده می‌شود (این فقط fallback روت‌های ساده است)
    defaultPendingComponent: RootPendingFallback,
    defaultNotFoundComponent: RouteNotFound,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}