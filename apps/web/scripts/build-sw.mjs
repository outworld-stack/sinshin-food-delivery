//srcweb/scripts/build-sw.mjs
import { injectManifest } from 'workbox-build'

const res = await injectManifest({
  globDirectory: '.output/public',
  globPatterns: ['**/*.{js,css,png,svg,woff2,html}'],
  globFollow: true,
  swSrc: 'public/sw.template.js',
  swDest: 'public/sw.js',
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
})
console.log(`[sw] precached ${res.count} file(s) → public/sw.js`)