// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 9 از 14
// مسیر مقصد: apps/web/vite.config.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, loadEnv } from 'vite'

const mapKeyFrom = (env: Record<string, string | undefined>) =>
	env.VITE_NESHAN_MAP_KEY || env.VITE_NESHAN_API_KEY

const config = defineConfig(({ mode }) => {
	// Native Vite runs in apps/web; Docker receives the public map key from the
	// root .env. Share that fallback without loading server secrets into Vite.
	// Resolve each source together so a local legacy key still overrides root.
	const mapKey =
		mapKeyFrom(process.env) ||
		mapKeyFrom(
			loadEnv(
				mode,
				fileURLToPath(new URL('.', import.meta.url)),
				'VITE_NESHAN_',
			),
		) ||
		mapKeyFrom(
			loadEnv(
				mode,
				fileURLToPath(new URL('../../', import.meta.url)),
				'VITE_NESHAN_',
			),
		)

	return {
		define: {
			'import.meta.env.VITE_NESHAN_MAP_KEY': JSON.stringify(mapKey ?? ''),
		},
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
	}
})

export default config
