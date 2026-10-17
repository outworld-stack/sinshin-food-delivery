//srcweb/scripts/build-sw.mjs
import { injectManifest } from 'workbox-build'

const res = await injectManifest({
  globDirectory: '.output/public',
  globPatterns: ['**/*.{js,css,png,svg,woff2,webmanifest}', 'offline.html'],
  globIgnores: ['sw.js', 'sw.template.js', 'sw-push.js', 'sw-reset.html'],
  globFollow: true,
  swSrc: 'public/sw.template.js',
  swDest: 'public/sw.js',
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
})
if (res.warnings.length) console.warn('[sw]', res.warnings.join('\n'))
console.log(`[sw] precached ${res.count} file(s) → public/sw.js`)
