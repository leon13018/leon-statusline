import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
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

// 跨 session 共用狀態（非 per-session）：失控偵測是全機層級，每 session 各存一份會重複掃描且反覆暖機
export function readSharedState(name, dir = cacheDir()) {
  try { return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) } catch { return null }
}

// 先寫暫存再 rename，保證原子性；多 session 併發時最後一個勝出，內容仍完整
export function writeSharedState(name, obj, dir = cacheDir()) {
  const file = join(dir, `${name}.json`)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(obj))
    renameSync(tmp, file)
  } catch {
    try { unlinkSync(tmp) } catch {}
  }
}
