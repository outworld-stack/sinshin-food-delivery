import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // round-12 — پروکسی dev: فایل‌های آپلودی URL نسبی (/uploads/xxx.png) از
  // مبدأ API (:3000) سرو می‌شوند؛ بدون این پروکسی، <img> روی مبدأ وب (:3001)
  // می‌افتد و آیکون شکسته می‌گیرد. /api هم برای حالت بدون VITE_API_URL.
  // prod دست‌نخورده: Caddy از قبل /api/* و /uploads/* را به api می‌فرستد.
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