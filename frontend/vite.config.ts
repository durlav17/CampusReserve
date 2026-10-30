import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// In development, /api is proxied to the local Express server so the browser
// talks to one origin; the port comes from backend/.env. In production
// VITE_API_URL points at the Render API.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${loadEnv(mode, fileURLToPath(new URL('../backend', import.meta.url)), 'PORT').PORT || 4000}`, changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('recharts') || id.includes('d3-') ? 'charts' : undefined),
      },
    },
  },
}))
