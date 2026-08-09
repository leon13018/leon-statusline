// tasklist /v /fo csv 共 9 欄，只取 Image Name(0) / PID(1) / CPU Time(7)
const CPU_RE = /^(\d+):([0-5]\d):([0-5]\d)$/

export function parseTasklistCsv(text) {
  if (typeof text !== 'string') return null
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length < 2 || line[0] !== '"' || line[line.length - 1] !== '"') continue
    const f = line.slice(1, -1).split('","')
    if (f.length < 8) continue
    if (f[0] === 'Image Name') continue            // 標頭
    const pid = Number(f[1])
    if (!Number.isInteger(pid) || pid < 0) continue
    const m = CPU_RE.exec(f[7])
    if (!m) continue                               // CPU Time 為 N/A 或格式異常 → 略過該列
    rows.push({
      pid,
      name: f[0],
      cpuSeconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
    })
  }
  return rows.length ? rows : null
}
