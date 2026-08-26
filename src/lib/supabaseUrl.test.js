import { describe, expect, it } from 'vitest'

import { normaliseSupabaseKey, normaliseSupabaseUrl } from './supabaseUrl.js'

const PROJECT = 'https://gqncijqsmpnghudrbmuc.supabase.co'

describe('project URL normalisation', () => {
  it('passes a correct project URL through unchanged', () => {
    expect(normaliseSupabaseUrl(PROJECT)).toBe(PROJECT)
  })

  it('strips the REST path copied from the Data API page', () => {
    // The real bug this guards: supabase-js appends /auth/v1 to whatever it is
    // given, so this produced POSTs to /rest/v1/auth/v1/otp that 404'd with
    // "Invalid path specified in request URL".
    expect(normaliseSupabaseUrl(`${PROJECT}/rest/v1`)).toBe(PROJECT)
    expect(normaliseSupabaseUrl(`${PROJECT}/rest/v1/`)).toBe(PROJECT)
  })

  it('strips a trailing slash, query string or fragment', () => {
    expect(normaliseSupabaseUrl(`${PROJECT}/`)).toBe(PROJECT)
    expect(normaliseSupabaseUrl(`${PROJECT}/?apikey=abc`)).toBe(PROJECT)
    expect(normaliseSupabaseUrl(`${PROJECT}#anything`)).toBe(PROJECT)
  })

  it('survives surrounding whitespace from a copy-paste', () => {
    expect(normaliseSupabaseUrl(`  ${PROJECT}\n`)).toBe(PROJECT)
  })

  it('keeps a port, so a local Supabase stack still works', () => {
    expect(normaliseSupabaseUrl('http://localhost:54321')).toBe('http://localhost:54321')
  })

  it('rejects the placeholder, so a fresh clone shows the setup screen', () => {
    expect(normaliseSupabaseUrl('your-supabase-project-url')).toBeNull()
  })

  it('rejects anything that is not an http(s) URL', () => {
    expect(normaliseSupabaseUrl('not a url')).toBeNull()
    expect(normaliseSupabaseUrl('postgres://user@host/db')).toBeNull()
    expect(normaliseSupabaseUrl('')).toBeNull()
    expect(normaliseSupabaseUrl(undefined)).toBeNull()
  })
})

describe('key normalisation', () => {
  it('trims the newline a dashboard copy tends to bring along', () => {
    expect(normaliseSupabaseKey('  sb_publishable_abc123\n')).toBe('sb_publishable_abc123')
  })

  it('rejects the placeholder and empty values', () => {
    expect(normaliseSupabaseKey('your-supabase-anon-key')).toBeNull()
    expect(normaliseSupabaseKey('   ')).toBeNull()
    expect(normaliseSupabaseKey(undefined)).toBeNull()
  })
})
