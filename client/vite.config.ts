import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function buildId(): string {
  let sha = 'nogit'
  try { sha = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* */ }
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${sha}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { host: '127.0.0.1', port: 5178, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3218', changeOrigin: true } } },
})
