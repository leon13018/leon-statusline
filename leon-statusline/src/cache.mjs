import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function cacheDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? join(process.env.CLAUDE_PLUGIN_DATA, 'leon-statusline')
    : join(homedir(), '.claude', 'leon-statusline')
  try { mkdirSync(base, { recursive: true }) } catch {}
  return base
}

const sanitize = s => String(s || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '_')

export function withCache(sessionId, key, ttlMs, fn, now = Date.now(), dir = cacheDir()) {
  const file = join(dir, `cache-${sanitize(sessionId)}.json`)
  let store = {}
  try { store = JSON.parse(readFileSync(file, 'utf8')) || {} } catch {}
  const entry = store[key]
  if (entry && (now - entry.t) < ttlMs) return entry.v
  let v
  try { v = fn() } catch { v = entry ? entry.v : null }
  store[key] = { t: now, v }
  try { writeFileSync(file, JSON.stringify(store)) } catch {}
  return v
}
