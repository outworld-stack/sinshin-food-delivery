import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import type { Db } from '#/infra/db/client'
import { contentAbout } from '#/infra/db/schema'
import type { SessionService } from '#/domain/auth/session.service'
import { requireAdmin } from '#/http/hooks/require-auth'

export interface AboutRoutesDeps {
  db: Db
  sessions: SessionService
}

export const aboutRoutes = (deps: AboutRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/about', tags: ['About'] })
    .get('/', async () => {
      const row = (await deps.db.select().from(contentAbout).limit(1))[0]
      return row ?? null
    }, { detail: { summary: 'About content (seeded, single row)' } })

  const adminRoutes = new Elysia({ prefix: '/admin/about', tags: ['Admin / About'] })
    .use(requireAdmin(deps.sessions))
    .patch(
      '/',
      async ({ body }) => {
        const existing = (await deps.db.select().from(contentAbout).limit(1))[0]
        const patch = { ...body, updatedAt: new Date() }
        if (existing) {
          await deps.db.update(contentAbout).set(patch).where(eq(contentAbout.id, existing.id))
        } else {
          await deps.db.insert(contentAbout).values(patch)
        }
        return { success: true }
      },
      {
        body: t.Object({
          heroTitle: t.String({ minLength: 1, maxLength: 120 }),
          heroText: t.String({ maxLength: 2000 }),
          heroGradient: t.String({ maxLength: 200 }),
          teamTitle: t.String({ maxLength: 120 }),
          teamGradient: t.String({ maxLength: 200 }),
          teamAlt: t.String({ maxLength: 200 }),
        }),
        detail: { summary: 'Update about content (main admin)' },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}