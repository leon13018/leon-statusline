import { colorize } from './color.mjs'

export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 1) return '<1m'
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  let out = ''
  if (d) out += `${d}d`
  if (h) out += `${h}h`
  if (m) out += `${m}m`
  return out
}

export function resetCountdown(epochSec, nowSec) {
  if (epochSec == null || !Number.isFinite(epochSec)) return ''
  const diffMs = (epochSec - nowSec) * 1000
  if (diffMs <= 0) return '0m'
  return fmtDuration(diffMs) || '0m'
}

export function shortPath(absPath, homeDir) {
  if (!absPath) return ''
  let p = String(absPath).replace(/\\/g, '/').replace(/\/+$/, '')
  if (homeDir) {
    const h = String(homeDir).replace(/\\/g, '/').replace(/\/+$/, '')
    if (h && (p === h || p.startsWith(h + '/'))) p = '~' + p.slice(h.length)
  }
  const tokens = p.split('/').filter(Boolean)
  if (tokens.length <= 3) return p
  return `${tokens[0]}/…/${tokens.slice(-2).join('/')}`
}

// 條件顯示單位：value 為空 => 回 ''（整個 attribute 含標題隱藏）
export function attr(label, value, rgb = null) {
  if (value == null || value === '') return ''
  const text = `${label}${value}`
  return rgb ? colorize(text, rgb) : text
}

export function joinLine(parts) {
  const kept = parts.filter(p => p && p.length)
  return kept.join('  ')
}
