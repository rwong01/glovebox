/**
 * Lists the Gemini models your key can actually reach.
 *
 *   npm run models
 *
 * Free-tier quotas differ sharply between models — the daily request allowance
 * on a Flash-Lite model is orders of magnitude larger than on a Pro one, which
 * is the difference between scanning a shoebox in one sitting and rationing it
 * over a week. Blog posts go stale; this asks your own account.
 *
 * Rate limits themselves are not exposed by the API. This prints what you can
 * call; AI Studio shows what you may call how often.
 */
import { loadEnv } from 'vite'

const env = loadEnv('development', process.cwd(), '')
const apiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY

if (!apiKey || apiKey.startsWith('your-')) {
  console.error('No GEMINI_API_KEY found. Add it to .env.local (see .env.local.example).')
  process.exit(1)
}

const response = await fetch(
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
  { headers: { 'x-goog-api-key': apiKey } },
)

if (!response.ok) {
  const body = await response.text().catch(() => '')
  console.error(`Request failed (${response.status}). ${body.slice(0, 400)}`)
  process.exit(1)
}

const { models = [] } = await response.json()

// Only models that can actually run an extraction are useful here.
const usable = models
  .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
  .map((m) => m.name.replace(/^models\//, ''))
  .sort()

const current = process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-3.1-flash-lite'

console.log(`\n${usable.length} models support generateContent:\n`)
for (const name of usable) {
  const mark = name === current ? '→' : ' '
  const lite = /flash-lite/.test(name) ? '   (flash-lite: highest free-tier daily allowance)' : ''
  console.log(`${mark} ${name}${lite}`)
}
console.log(`\nCurrently using: ${current}`)
console.log('Change it with GEMINI_MODEL in .env.local, or in your Vercel env vars.\n')
