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
  // 無法判定時原樣保留舊狀態；但只保留物件，畸形的舊狀態一律歸零免得被呼叫端寫回磁碟
  const keep = prev && typeof prev === 'object' ? prev : null

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

// 節流看的是「上次嘗試取樣」的時間，不是「上次成功取樣」的 t。
// 取樣失敗時只推進 attemptedAt，t 維持不動 —— 因為 t 同時是 procs 快照的時間基準，
// 一起推進的話，下一輪成功取樣會拿舊快照的 cpu 差去除以被縮短的區間，速率高估而誤報
const lastAttempt = st => {
  if (!st || typeof st !== 'object') return null
  const a = Number.isFinite(st.attemptedAt) ? st.attemptedAt : null
  const t = Number.isFinite(st.t) ? st.t : null
  if (a === null) return t
  if (t === null) return a
  return Math.max(a, t)
}

// 取樣失敗時要寫回的狀態：只記「這次嘗試過」，判定用的 t/procs/flagged 一律原樣保留。
// base 壞掉（非物件／陣列／procs 不是物件／t 非數字）時退回乾淨的空基準，絕不寫回垃圾
const attemptOnly = (base, now, cached) => {
  const usable = !!base && typeof base === 'object' && !Array.isArray(base) &&
    Number.isFinite(base.t) &&
    !!base.procs && typeof base.procs === 'object' && !Array.isArray(base.procs)
  return usable
    ? { t: base.t, procs: base.procs, flagged: cached, attemptedAt: now }
    : { t: now, procs: {}, flagged: cached, attemptedAt: now }
}

// 編排：節流 → 取樣 → 判定 → 持久化。所有 I/O（含時鐘）由外部注入，故可完全測試
// 只負責產出警告用的清單，永不對行程做任何處置
export function detect({ now, readState, writeState, sample, cfg } = {}) {
  const opts = cfg && typeof cfg === 'object' ? cfg : {}   // cfg 僅為測試接縫，不接任何使用者設定
  const interval = Number.isFinite(opts.intervalMs) ? opts.intervalMs : SCAN_INTERVAL_MS
  let state = null
  try { state = readState() } catch { state = null }
  const cached = state && Array.isArray(state.flagged) ? state.flagged : []

  // 早退必須在 sample() 之前：取樣是同步阻塞的外部命令，且 classify 對極短 dt 無下限
  if (!Number.isFinite(now)) return cached   // 時鐘壞掉：不取樣也不寫入，否則節流會永久失效
  const tryAt = lastAttempt(state)
  const dt = tryAt === null ? null : now - tryAt
  if (dt !== null && dt >= 0 && dt < interval) return cached
  // 基準落在未來（時鐘往回撥／NTP 校正）→ 丟掉基準重建，否則會一路早退到時鐘追上為止
  const base = dt !== null && dt < 0 ? null : state

  let s = null
  try { s = sample() } catch { s = null }
  // 取樣失敗：判定結果沿用上次，但一定要記下這次嘗試。否則節流基準永不前進，
  // 下一次 render 又會再付一次完整的取樣成本 —— 在取樣恆逾時的機器上，
  // 「每分鐘至多一次」會退化成「每次 render 一次」，且永遠不會自癒
  if (!s) {
    try { writeState(attemptOnly(base, now, cached)) } catch {}
    return cached
  }

  const { flagged, nextState } = classify(base, s, now, opts)
  // classify 判不出來時會原樣回吐 base；此時不得寫入，否則 t 不前進＝節流失效、flagged 被洗掉
  if (nextState && nextState !== base) { try { writeState({ ...nextState, flagged }) } catch {} }
  return flagged
}
