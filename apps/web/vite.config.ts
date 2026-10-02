// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 9 از 14
// مسیر مقصد: apps/web/vite.config.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // پروکسی توسعه — فایل‌های آپلودی و مسیرهای رابط برنامه‌نویسی از
  // مبدأ بک‌اند سرو می‌شوند تا تگ تصویر روی مبدأ وب نشکند.
  // تولید دست‌نخورده: لبه از قبل همین مسیرها را به بک‌اند می‌فرستد.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config