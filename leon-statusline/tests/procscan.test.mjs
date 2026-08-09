import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sampleProcesses } from '../src/procscan.mjs'
import { classify } from '../src/runaway.mjs'

// PowerShell 取樣的輸出格式：每列 `<pid> <cpu秒> <行程名>`，行程名在最後一欄
const ps = rows => rows.map(([pid, cpu, name]) => `${pid} ${cpu} ${name}`).join('\r\n')
const win = out => sampleProcesses({ platform: 'win32', exec: () => out })

describe('sampleProcesses（PowerShell Get-Process 取樣）', () => {
  it('正常輸出 → 解析為 {pid,name,cpuSeconds}', () => {
    expect(win(ps([[32252, '3.28125', 'adb'], [19196, '0.03125', 'bash']])))
      .toEqual([
        { pid: 32252, name: 'adb', cpuSeconds: 3.28125 },
        { pid: 19196, name: 'bash', cpuSeconds: 0.03125 },
      ])
  })
  // 實測本機存在 ProcessName 為 `Docker Desktop` 的行程（含空白），
  // 故行程名必須是最後一欄、且只切前兩個分隔符
  it('行程名含空白 → 完整保留（名稱在最後一欄）', () => {
    expect(win(ps([[5128, '12.5', 'Docker Desktop']])))
      .toEqual([{ pid: 5128, name: 'Docker Desktop', cpuSeconds: 12.5 }])
  })
  it('CPU 為浮點秒數（非 H:MM:SS），小數與 0 都照收', () => {
    const out = win(ps([[1, '1261966.484375', 'big'], [2, '0', 'idle']]))
    expect(out).toEqual([
      { pid: 1, name: 'big', cpuSeconds: 1261966.484375 },
      { pid: 2, name: 'idle', cpuSeconds: 0 },
    ])
  })
  it('CPU 欄非數字（含地區設定吐出逗號小數點）→ 該列被略過，不當成 0', () => {
    // 若 PowerShell 端沒指定 invariant，de-DE 之類的地區會吐 `3,28125`（實測）。
    // 這種列必須整列丟掉：補 0 會讓該行程的區間速率恆為 0 而永遠不可能被偵測到
    const out = win(ps([[7, '3,28125', 'bad'], [8, 'N/A', 'worse'], [9, '5.5', 'ok']]))
    expect(out).toEqual([{ pid: 9, name: 'ok', cpuSeconds: 5.5 }])
  })
  it('缺欄位／pid 非數字／行程名為空 → 該列被略過', () => {
    expect(win(['42', '42 1.5', 'x 1.5 name', '42 1.5 ', '42 1.5 good'].join('\n')))
      .toEqual([{ pid: 42, name: 'good', cpuSeconds: 1.5 }])
  })
  it('CRLF 與 LF 都能解析', () => {
    expect(win('1 1.5 a\r\n2 2.5 b')).toEqual(win('1 1.5 a\n2 2.5 b'))
  })

  it('非 Windows → null，且完全不執行 exec', () => {
    // ⚠ 不可用「被呼叫就 throw」當哨兵：sampleProcesses 對 run() 包了 try/catch，
    // 哨兵拋的錯會被吞掉而假綠。只能數呼叫次數，且假 exec 要回有效值
    let called = 0
    const out = sampleProcesses({ platform: 'linux', exec: () => { called += 1; return ps([[1, '1', 'a']]) } })
    expect({ out, called }).toEqual({ out: null, called: 0 })
  })
  it('exec 拋錯（逾時／找不到 powershell）→ null，不往外拋', () => {
    expect(() => sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).not.toThrow()
    expect(sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).toBe(null)
  })
  it('輸出無法解析 / 空輸出 → null', () => {
    expect(win('亂碼')).toBe(null)
    expect(win('')).toBe(null)
    expect(win('   \r\n  ')).toBe(null)
    expect(win(null)).toBe(null)
    expect(win(undefined)).toBe(null)
  })
  it('Buffer（非字串，忘了 encoding: utf8）→ null，不當成可解析輸入', () => {
    expect(win(Buffer.from(ps([[42, '1.5', 'node']]), 'utf8'))).toBe(null)
  })
})

// 以下性質全在注入的 exec 之外（測試不會真的執行 PowerShell），行為測試鎖不住：
// 少了 -NoProfile 只是變慢、少了 invariant 只在特定地區才壞、名稱被補上 .exe 只是資料造假，
// 三者都不會讓任何一條行為測試轉紅。故直接讀原始碼釘死
describe('procscan.mjs 取樣命令的靜態鎖', () => {
  const src = readFileSync(new URL('../src/procscan.mjs', import.meta.url), 'utf8')

  it('必須用 -NoProfile -NonInteractive（不載入使用者 profile、不等互動輸入）', () => {
    expect(src).toMatch(/'-NoProfile'/)
    expect(src).toMatch(/'-NonInteractive'/)
  })
  it('必須用 -Command 單行命令，不得依賴外部 .ps1 腳本檔', () => {
    expect(src).toMatch(/'-Command'/)
    expect(src).not.toMatch(/\.ps1/)
  })
  it('小數點必須明確指定 InvariantCulture', () => {
    expect(src).toMatch(/InvariantCulture/)
    expect(src).toMatch(/CPU\.ToString\(\$ci\)/)
  })
  it('CPU 為 $null 的行程必須整列略過，不得補 0', () => {
    expect(src).toMatch(/\$null -ne \$_\.CPU/)
  })
  // 只禁「程式碼裡出現 '.exe' 字面量」（那是唯一能把副檔名接回去的手法）；
  // 註解裡提到 node.exe 是在說明這個變化，不該被鎖住
  it('不得自行補上 .exe（ProcessName 本來就不帶副檔名，補了是捏造資料）', () => {
    expect(src).not.toMatch(/'\.exe'|"\.exe"|`\.exe`/)
  })
  it('不得含任何終止行程的手段', () => {
    expect(src).not.toMatch(/taskkill|Stop-Process|\bkill\(|process\.kill|SIGTERM|SIGKILL/)
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
    // 名稱刻意用不帶 .exe 的 `node`：那正是 Get-Process 的 ProcessName 形態
    const sampleAt = i => sampleProcesses({
      platform: 'win32',
      exec: () => ps([[4242, String(i * 60), 'node']]),
    })
    let st = null
    for (let i = 0; i <= 5; i++) st = classify(st, sampleAt(i), i * 60_000, {}).nextState
    const { flagged } = classify(st, sampleAt(6), 6 * 60_000, {})
    expect(flagged).toEqual([{ pid: 4242, name: 'node', rate: 1 }])
  })
})
