import { execFileSync } from 'node:child_process'

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

// 唯一與系統互動處。非 Windows 或任何失敗一律回 null（不 throw）
export function sampleProcesses({ exec, platform = process.platform } = {}) {
  if (platform !== 'win32') return null
  // encoding 必須是 utf8：拿到 Buffer 會讓 parseTasklistCsv 靜默回 null
  const run = exec || (() => execFileSync('tasklist', ['/v', '/fo', 'csv'], {
    encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  }))
  try {
    return parseTasklistCsv(run())
  } catch {
    return null
  }
}
