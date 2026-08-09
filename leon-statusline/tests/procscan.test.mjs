import { describe, it, expect } from 'vitest'
import { parseTasklistCsv, sampleProcesses } from '../src/procscan.mjs'
import { classify } from '../src/runaway.mjs'

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
  // 以下兩條釘住 sampleProcesses 所依賴的契約
  it('Buffer（非字串）→ null，不當成可解析輸入', () => {
    expect(parseTasklistCsv(Buffer.from([HEADER, row('node.exe', 42, '0:00:10')].join('\n'), 'utf8'))).toBe(null)
  })
  it('少於 8 欄（漏了 /v）→ null，不產生假資料', () => {
    const narrow = [
      '"Image Name","PID","Session Name","Session#","Mem Usage"',
      '"node.exe","42","Console","1","47,020 K"',
    ].join('\n')
    expect(parseTasklistCsv(narrow)).toBe(null)
  })
})

describe('sampleProcesses', () => {
  const csv = [HEADER, row('node.exe', 42, '0:00:10')].join('\n')

  it('Windows + 正常輸出 → 解析結果', () => {
    expect(sampleProcesses({ platform: 'win32', exec: () => csv }))
      .toEqual([{ pid: 42, name: 'node.exe', cpuSeconds: 10 }])
  })
  it('非 Windows → null，且完全不執行 exec', () => {
    let called = false
    const out = sampleProcesses({ platform: 'linux', exec: () => { called = true; return csv } })
    expect(out).toBe(null)
    expect(called).toBe(false)
  })
  it('exec 拋錯 → null，不往外拋', () => {
    expect(() => sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).not.toThrow()
    expect(sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).toBe(null)
  })
  it('輸出無法解析 → null', () => {
    expect(sampleProcesses({ platform: 'win32', exec: () => '亂碼' })).toBe(null)
  })
})

// 釘住 procscan → classify 的跨模組欄位契約。這一段是進入點實際走的路
// （statusline.mjs 的 deps.runaway 把 sampleProcesses 直接餵進 detect→classify），
// 但兩邊的單元測試都用手寫字面量，所以協同改名可以全綠通過而功能無聲死亡：
// sampleProcesses 的 cpuSeconds/pid/name 任一改名 → classify 的 valid() 會整批濾掉
// → flagged 永遠是空的、狀態列永遠不警告。故這裡不寫死中間形狀，只驗端到端結果
describe('procscan → classify 欄位契約', () => {
  it('sampleProcesses 的真實輸出餵給 classify 能標出持續失控的行程（上游欄位改名要當場紅燈）', () => {
    // 每 60 秒 CPU 增加 60 秒＝1 核，超過 RATE_THRESHOLD 0.5；連續 5 個區間後被標記
    const sampleAt = i => sampleProcesses({
      platform: 'win32',
      exec: () => [HEADER, row('runaway.exe', 4242, `0:${String(i).padStart(2, '0')}:00`)].join('\n'),
    })
    let st = null
    for (let i = 0; i <= 5; i++) st = classify(st, sampleAt(i), i * 60_000, {}).nextState
    const { flagged } = classify(st, sampleAt(6), 6 * 60_000, {})
    expect(flagged).toEqual([{ pid: 4242, name: 'runaway.exe', rate: 1 }])
  })
})
