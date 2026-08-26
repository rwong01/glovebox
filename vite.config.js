import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import apiRoutes from './tooling/vite-plugin-api-routes.js'

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars to client code. The dev-mode API
  // plugin runs in Node and needs the unprefixed server secrets (GEMINI_API_KEY),
  // so load the full env and hand it to process.env for the dev server only.
  // Production reads these straight from the Vercel environment.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), tailwindcss(), apiRoutes()],
    server: { port: 5173 },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}'],
      globals: false,
    },
  }
})
