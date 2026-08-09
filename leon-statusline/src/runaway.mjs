export const SCAN_INTERVAL_MS = 60_000
export const RATE_THRESHOLD = 0.5          // 核
export const CONSECUTIVE_REQUIRED = 5      // 連續超標區間數（以 60 秒間隔計＝持續 5 分鐘）

// 只收形狀正確的樣本列，其餘一律略過（畸形輸入不得 throw）
function valid(p) {
  return !!p && typeof p === 'object' &&
    Number.isInteger(p.pid) && p.pid >= 0 &&
    typeof p.name === 'string' &&
    Number.isFinite(p.cpuSeconds)
}

// 純函式：比對前後兩次快照，算區間速率（Δcpu ÷ Δ牆鐘時間），判定持續失控的行程
export function classify(prev, sample, now, cfg = {}) {
  const opts = cfg && typeof cfg === 'object' ? cfg : {}
  const rateThreshold = Number.isFinite(opts.rateThreshold) ? opts.rateThreshold : RATE_THRESHOLD
  const required = Number.isFinite(opts.required) ? opts.required : CONSECUTIVE_REQUIRED
  const keep = prev || null                  // 無法判定時原樣保留舊狀態

  if (!Array.isArray(sample)) return { flagged: [], nextState: keep }
  const rows = sample.filter(valid)
  if (rows.length === 0) return { flagged: [], nextState: keep }
  if (!Number.isFinite(now)) return { flagged: [], nextState: keep }

  const hasPrev = !!(prev && typeof prev === 'object' &&
    prev.procs && typeof prev.procs === 'object' && Number.isFinite(prev.t))
  const dtSec = hasPrev ? (now - prev.t) / 1000 : 0
  if (hasPrev && dtSec <= 0) return { flagged: [], nextState: prev }   // 時鐘異常，原樣保留

  const procs = {}
  const flagged = []
  for (const p of rows) {
    const before = hasPrev ? prev.procs[p.pid] : null
    let streak = 0, rate = 0
    if (before && typeof before === 'object' && before.name === p.name && Number.isFinite(before.cpu)) {
      const delta = p.cpuSeconds - before.cpu
      if (delta >= 0) {                      // 變小＝PID 被重用，計數歸零
        rate = delta / dtSec
        const prior = Number.isFinite(before.streak) ? before.streak : 0
        streak = rate >= rateThreshold ? prior + 1 : 0
      }
    }
    procs[p.pid] = { name: p.name, cpu: p.cpuSeconds, streak }
    if (streak >= required) flagged.push({ pid: p.pid, name: p.name, rate })
  }
  return { flagged, nextState: { t: now, procs } }
}
