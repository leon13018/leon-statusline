import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'statusline.mjs')

// 每條測試給一個獨立的 CLAUDE_PLUGIN_DATA：
// 一則避免跑測試污染使用者真實家目錄（cache-*.json / runaway-state.json 都落在 cacheDir()），
// 二則讓 runaway 狀態不跨測試外洩，否則種了 flagged 的那條會讓 4 行的斷言隨執行順序時綠時紅
let dataDir
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'lsl-e2e-')) })
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

const run = stdin => spawnSync('node', [entry], {
  input: stdin,
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
})

// cacheDir() 會在 CLAUDE_PLUGIN_DATA 底下再開一層同名目錄
const stateDir = () => join(dataDir, 'leon-statusline')
const stateFile = () => join(stateDir(), 'runaway-state.json')
const seedState = obj => {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(stateFile(), JSON.stringify(obj))
}

describe('statusline entry (never crash)', () => {
  it('valid input -> exit 0, 4 lines', () => {
    const r = run(JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/tmp/x' } }))
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
    expect(r.stdout.split('\n').length).toBe(4)
  })
  it('empty input -> exit 0', () => {
    const r = run('')
    expect(r.status).toBe(0)
  })
  it('garbage input -> exit 0', () => {
    const r = run('}{not json')
    expect(r.status).toBe(0)
  })
})

describe('runaway 守衛已接上進入點', () => {
  const input = JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/tmp/x' } })

  // 節流期內 detect 直接回吐 state.flagged，不取樣 —— 故本條完全不依賴本機行程狀況。
  // 它釘住：import 有接上、deps.runaway 有注入、readSharedState 的名字是 'runaway-state'。
  // 但它「釘不住」now 的單位：實測把 now 改成秒或 undefined，本條照樣綠
  // —— 因為兩者都會退回 cached，而 cached 就是種下去的 flagged。單位由下面的靜態鎖負責
  it('狀態檔內有未過期的 flagged → 進入點輸出第 5 行', () => {
    seedState({ t: Date.now(), procs: {}, flagged: [{ pid: 4242, name: 'node.exe', rate: 1.25 }] })
    const r = run(input)
    expect(r.status).toBe(0)
    const lines = r.stdout.split('\n')
    expect(lines.length).toBe(5)
    expect(lines[4]).toContain('runaway:1')
    expect(lines[4]).toContain('node.exe(4242)')
  })

  it('狀態檔內有未過期但畸形的 flagged → 不得多出第 5 行（壞狀態不劣化狀態列）', () => {
    seedState({ t: Date.now(), procs: {}, flagged: [{ pid: 'x' }, null, 'garbage'] })
    const r = run(input)
    expect(r.status).toBe(0)
    expect(r.stdout.split('\n').length).toBe(4)
  })

  // 首次執行（無狀態檔）必須真的走完取樣分支。刻意不斷言「狀態檔一定生成」：
  // sampleProcesses 取樣失敗（非 win32、tasklist 逾時）時 detect 依約不寫入，
  // 那是降級不是 bug。這裡鎖的是降級路徑也不得讓狀態列崩掉或多印東西
  it('首次執行（無狀態檔）：仍 exit 0、仍 4 行、無 .tmp 殘留', () => {
    const r = run(input)
    expect(r.status).toBe(0)
    expect(r.stdout.split('\n').length).toBe(4)
    expect(readdirSync(stateDir()).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  // 跑測試不得在使用者真實家目錄留下東西 —— 靠的是 run() 注入 CLAUDE_PLUGIN_DATA。
  // 這條守住那層隔離本身：若 env 被拿掉，cacheDir() 會落回 homedir，暫存目錄裡就什麼都不會有
  it('所有落盤都在 CLAUDE_PLUGIN_DATA 底下（隔離被拿掉就紅）', () => {
    run(input)
    const written = readdirSync(stateDir())
    expect(written.some(f => f.startsWith('cache-'))).toBe(true)
  })
})

// 這些約束光靠行為測試鎖不住（cfg 走錯路只會讓門檻悄悄失效、測試照樣綠），故直接讀原始碼釘死
describe('statusline.mjs 注入點的靜態鎖', () => {
  const src = readFileSync(new URL('../statusline.mjs', import.meta.url), 'utf8')

  it('detect 必須拿到毫秒時鐘 now: Date.now()', () => {
    expect(src).toMatch(/now:\s*Date\.now\(\)/)
  })
  // cfg 是測試接縫不是設定管道：cfg.required=0 會讓每個行程第一輪就被標記、
  // cfg.intervalMs 會弱化節流（狀態列不卡頓的唯一保障）
  it('不得從進入點傳 cfg 給 detect，也不得有讀設定／環境變數當門檻的路徑', () => {
    expect(src).not.toMatch(/\bcfg\b/)
    expect(src).not.toMatch(/RATE_THRESHOLD|CONSECUTIVE_REQUIRED|SCAN_INTERVAL_MS|intervalMs|required/)
  })
  it('進入點不得含任何終止行程的手段', () => {
    expect(src).not.toMatch(/child_process|taskkill|\bkill\(|process\.kill|SIGTERM|SIGKILL/)
  })
})
