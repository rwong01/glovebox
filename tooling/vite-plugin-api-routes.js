/**
 * Runs the `api/` serverless functions inside the Vite dev server.
 *
 * In production Vercel picks up `api/*.js` automatically. Locally, `vite dev`
 * knows nothing about them, which would normally mean installing the Vercel CLI
 * just to exercise the OCR flow. This plugin mounts the same handlers on the dev
 * server with a Vercel-shaped `(req, res)` pair, so `npm run dev` runs the whole
 * app end to end.
 *
 * Handlers are loaded through `ssrLoadModule`, so editing one takes effect on the
 * next request without restarting the server.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MAX_BODY_BYTES = 25 * 1024 * 1024 // receipt images arrive base64-encoded

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        rej(Object.assign(new Error('Request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => res(Buffer.concat(chunks)))
    req.on('error', rej)
  })
}

/** Adds the `res.status().json()` helpers Vercel's Node runtime provides. */
function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
    return res
  }
  res.send = (payload) => {
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
    return res
  }
  return res
}

export default function apiRoutes({ dir = 'api' } = {}) {
  const root = resolve(process.cwd(), dir)

  return {
    name: 'glovebox:api-routes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        // Mirror Vercel's routing: `_`-prefixed files are shared helpers, not routes.
        const route = url.pathname.slice('/api/'.length)
        if (!/^[a-z0-9-]+$/i.test(route)) {
          return decorateResponse(res).status(404).json({ error: 'Not found' })
        }

        const file = join(root, `${route}.js`)
        if (!existsSync(file)) {
          return decorateResponse(res).status(404).json({ error: `No API route at /api/${route}` })
        }

        decorateResponse(res)
        req.query = Object.fromEntries(url.searchParams)

        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const raw = await readBody(req)
            const type = req.headers['content-type'] || ''
            req.body = type.includes('application/json') && raw.length
              ? JSON.parse(raw.toString('utf8'))
              : raw.toString('utf8')
          }

          const mod = await server.ssrLoadModule(file)
          const handler = mod.default
          if (typeof handler !== 'function') {
            throw new Error(`api/${route}.js has no default export`)
          }
          await handler(req, res)
        } catch (err) {
          server.config.logger.error(`[api/${route}] ${err.stack || err.message}`)
          if (!res.headersSent) {
            res.status(err.statusCode || 500).json({ error: err.message || 'Internal error' })
          }
        }
      })
    },
  }
}
