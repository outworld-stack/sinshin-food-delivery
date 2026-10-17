import { copyFile } from 'node:fs/promises'

// Vite copied public before manifest injection. Replace that stale worker in
// the actual deployment output with the worker for this build.
await copyFile('public/sw.js', '.output/public/sw.js')
console.log('[sw] copied generated worker → .output/public/sw.js')
