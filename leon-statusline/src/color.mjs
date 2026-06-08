export function colorize(text, [r, g, b]) {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

export function gradientColor(t) {
  const x = Math.max(0, Math.min(1, t))
  const lerp = (a, b, k) => Math.round(a + (b - a) * k)
  if (x <= 0.5) {
    const k = x / 0.5
    return [lerp(0, 220, k), lerp(200, 200, k), lerp(80, 0, k)]
  }
  const k = (x - 0.5) / 0.5
  return [lerp(220, 220, k), lerp(200, 40, k), lerp(0, 40, k)]
}

export function gradientBar(pct, width = 20) {
  if (pct == null || !Number.isFinite(pct)) return ''
  const p = Math.max(0, Math.min(100, pct))
  const filled = Math.round((p / 100) * width)
  let bar = ''
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const t = width > 1 ? i / (width - 1) : 0
      bar += colorize('█', gradientColor(t))
    } else {
      bar += colorize('░', [60, 60, 60])
    }
  }
  return `${bar} ${Math.round(p)}%`
}
