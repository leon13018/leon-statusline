import { describe, it, expect } from 'vitest'
import { parseTasklistCsv } from '../src/procscan.mjs'

const HEADER = '"Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"'
const row = (name, pid, cpu, title = 'N/A') =>
  `"${name}","${pid}","Console","1","47,020 K","Unknown","DESKTOP\\LIN HONG","${cpu}","${title}"`

describe('parseTasklistCsv', () => {
  it('解析標頭 + 資料列，取 name/pid/cpuSeconds', () => {
    const out = parseTasklistCsv([HEADER, row('node.exe', 32228, '0:00:01'), row('chrome.exe', 100, '0:02:03')].join('\r\n'))
    expect(out).toEqual([
      { pid: 32228, name: 'node.exe', cpuSeconds: 1 },
      { pid: 100, name: 'chrome.exe', cpuSeconds: 123 },
    ])
  })
  it('時數可超過 99', () => {
    const out = parseTasklistCsv([HEADER, row('System Idle Process', 0, '350:32:46')].join('\n'))
    expect(out[0].cpuSeconds).toBe(1261966)   // 350*3600 + 32*60 + 46
  })
  it('CPU Time 格式異常的列被略過', () => {
    const out = parseTasklistCsv([HEADER, row('bad.exe', 7, 'N/A'), row('ok.exe', 8, '0:00:05')].join('\n'))
    expect(out).toEqual([{ pid: 8, name: 'ok.exe', cpuSeconds: 5 }])
  })
  it('Window Title 內含逗號引號不影響前 8 欄', () => {
    const out = parseTasklistCsv([HEADER, row('node.exe', 9, '0:00:07', 'a","b')].join('\n'))
    expect(out).toEqual([{ pid: 9, name: 'node.exe', cpuSeconds: 7 }])
  })
  it('只有標頭 / 空字串 / 非字串 → null', () => {
    expect(parseTasklistCsv(HEADER)).toBe(null)
    expect(parseTasklistCsv('')).toBe(null)
    expect(parseTasklistCsv(null)).toBe(null)
    expect(parseTasklistCsv(undefined)).toBe(null)
    expect(parseTasklistCsv('完全不是 CSV')).toBe(null)
  })
})
