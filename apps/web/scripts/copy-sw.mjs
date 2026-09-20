//src/web/scripts/copy-sw.mjs
import { copyFile } from 'node:fs/promises'

// کپی به output برای همین deploy
await copyFile('public/sw.js', '.output/public/sw.js')
console.log('[sw] copied to .output/public/sw.js')

// دفعه‌ی بعد، چون public/sw.js وجود دارد، nitro خودش می‌برد —
// و build-sw دوباره روی template می‌سازد و بازنویسی می‌کند