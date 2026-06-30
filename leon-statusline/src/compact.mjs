export const DEFAULT_AUTOCOMPACT_PCT = 95

// auto-compact 門檻（%）：env CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE 為有效數則用，否則預設
export function autoCompactThreshold(env = process.env) {
  const raw = Number(env.CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE)
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_AUTOCOMPACT_PCT
}

// 把 context 已用 % 換算成 auto-compact %（used 對門檻），夾 0–100；used 缺 → null
export function autoCompactPct(usedPercentage, threshold = autoCompactThreshold()) {
  if (usedPercentage == null || !Number.isFinite(usedPercentage)) return null
  return Math.max(0, Math.min(100, (usedPercentage / threshold) * 100))
}
