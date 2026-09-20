//src/http/openapi.ts
import { openapi } from '@elysiajs/openapi'

import type { AppConfig } from '#/infra/config/env'

export const openapiPlugin = (config: AppConfig) =>
  openapi({
    path: '/swagger',
    documentation: {
      info: {
        title: 'Sinshin FoodPark API',
        version: '0.2.0',
        description: 'Sinshin backend — all business routes live under /api.',
      },
      tags: [
        { name: 'Health', description: 'Liveness and readiness' },
        { name: 'Realtime', description: 'SSE live feeds' },
        { name: 'Auth', description: 'OTP login and sessions' },
      ],
    },
    ...(config.isProd ? { swaggerOptions: { persistAuthorization: false } } : {}),
  })