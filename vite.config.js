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
    build: {
      // React, the Supabase SDK and the router account for nearly all of a
      // ~565kB / 167kB-gzipped bundle, and all three are needed on first paint
      // (the session check runs before anything renders), so code-splitting
      // them would buy nothing. Raised just above the real figure rather than
      // switched off, so a genuine regression still trips it.
      chunkSizeWarningLimit: 650,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}'],
      globals: false,
    },
  }
})
