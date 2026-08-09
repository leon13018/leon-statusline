import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderLine1, renderLine2, renderLine3, renderLine4, renderLine5, buildOutput } from '../src/render.mjs'
import { classify } from '../src/runaway.mjs'

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

const deps = {
  home: '/home/leon',
  now: () => 1000,
  git: () => ({ branch: 'main', staged: 2, modified: 1, ahead: 1, behind: 0 }),
  counts: () => ({ claudeMd: 7, memory: 5, mcp: 3, agent: 1, skill: 2, hook: 13, plugin: 2, workflow: 1 }),
}

const DIM = '\x1b[38;2;130;130;130m'

describe('renderLine1 (never hide)', () => {
  it('empty d -> 佔位（沒抓到）', () => {
    const raw = renderLine1({}, deps)
    const out = strip(raw)
    expect(out).toContain('none')          // model
    expect(out).toContain('effort:n/a')
    expect(out).toContain('think:off')
    expect(out).toContain('token:n/a')
    expect(out).toContain('session:none')
    expect(out).toContain('n/a')           // bar / dir 佔位
    expect(raw).toContain(DIM + 'effort:n/a')   // 佔位是 DIM
    expect(raw).toContain(DIM + 'session:none')
  })
  it('真 0 token & pct -> 真值，非 n/a', () => {
    const d = { context_window: { total_input_tokens: 0, used_percentage: 0 } }
    const out = strip(renderLine1(d, deps))
    expect(out).toContain('token:0.0k')
    expect(out).toContain('0%')
    expect(out).not.toContain('token:n/a')
  })
  it('bar 顯示 auto-compact %（used 對門檻換算）+ compact 標籤', () => {
    const d = { context_window: { used_percentage: 47.5 } }
    const out = strip(renderLine1(d, { ...deps, autoCompactThreshold: 95 }))
    expect(out).toContain('compact')
    expect(out).toContain('50%')   // 47.5 / 95 * 100 = 50
  })
  it('有 autoCompactWindow → bar 用 total_input_tokens÷window，且隨視窗變動', () => {
    const d = { context_window: { total_input_tokens: 250000, used_percentage: 25 } }
    const out500k = strip(renderLine1(d, { ...deps, autoCompactWindow: 500000 }))
    expect(out500k).toContain('50%')        // 250000/500000
    expect(out500k).not.toContain('26%')    // 非近似 25/95≈26
    const out1m = strip(renderLine1(d, { ...deps, autoCompactWindow: 1000000 }))
    expect(out1m).toContain('25%')          // 250000/1000000 → 視窗變大 → %變小
  })
})

describe('renderLine2 (never hide)', () => {
  it('absent repo/worktree/PR -> none；git + lines 真值', () => {
    const d = { cost: { total_lines_added: 156, total_lines_removed: 23 } }
    const raw = renderLine2(d, deps)
    const out = strip(raw)
    expect(out).toContain('git:main +2 ~1 ↑1')
    expect(out).toContain('+156 -23')
    expect(out).toContain('repo:none')
    expect(out).toContain('worktree:none')
    expect(out).toContain('PR:none')
    expect(raw).toContain(DIM + 'repo:none')
  })
  it('不在 git repo -> git:none (DIM)', () => {
    const noGit = { ...deps, git: () => null }
    const raw = renderLine2({}, noGit)
    expect(strip(raw)).toContain('git:none')
    expect(raw).toContain(DIM + 'git:none')
  })
  it('無 cost -> 增刪行 n/a（沒抓到）', () => {
    expect(strip(renderLine2({}, deps))).toContain('n/a')
  })
})

describe('renderLine3 (never hide)', () => {
  it('absent rate -> 5h/7d n/a；api/wall/cost 真值', () => {
    const d = { cost: { total_api_duration_ms: 3000, total_duration_ms: 14 * 60000, total_cost_usd: 0.42 } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('api:<1m')
    expect(out).toContain('wall:14m')
    expect(out).toContain('cost:$0.42')
    expect(out).toContain('5h:n/a')
    expect(out).toContain('7d:n/a')
  })
  it('Pro/Max rate 帶倒數', () => {
    const d = { rate_limits: { five_hour: { used_percentage: 24, resets_at: 1000 + 3600 + 23 * 60 } } }
    expect(strip(renderLine3(d, deps))).toContain('5h:24%(reset 1h23m)')
  })
  it('無 cost -> api/wall/cost n/a（沒抓到）', () => {
    const out = strip(renderLine3({}, deps))
    expect(out).toContain('api:n/a')
    expect(out).toContain('wall:n/a')
    expect(out).toContain('cost:n/a')
  })
  it('真 0% rate -> 0%，非 n/a', () => {
    const d = { rate_limits: { five_hour: { used_percentage: 0, resets_at: 1000 + 60 } } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('5h:0%')
    expect(out).not.toContain('5h:n/a')
  })
})

describe('renderLine4', () => {
  it('renders all counts with labels', () => {
    const out = strip(renderLine4({ workspace: { project_dir: '/p' } }, deps))
    expect(out).toContain('CLAUDE.md:7')
    expect(out).toContain('workflow:1')
  })
})

describe('renderLine5 (失控行程守衛)', () => {
  it('無 deps.runaway → 空字串（既有呼叫端不受影響）', () => {
    expect(renderLine5({}, deps)).toBe('')
  })
  it('無標記 → 空字串（零噪音）', () => {
    expect(renderLine5({}, { ...deps, runaway: () => [] })).toBe('')
    expect(renderLine5({}, { ...deps, runaway: () => null })).toBe('')
  })
  it('1 筆 → 顯示數量、名稱、PID 與速率', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [{ pid: 31832, name: 'node.exe', rate: 0.857 }] }))
    expect(out).toContain('⚠ runaway:1')
    expect(out).toContain('node.exe(31832) 0.86c')
  })
  it('3 筆 → 只列 2 筆並帶 +1', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [
      { pid: 1, name: 'a.exe', rate: 1 }, { pid: 2, name: 'b.exe', rate: 1 }, { pid: 3, name: 'c.exe', rate: 1 },
    ] }))
    expect(out).toContain('⚠ runaway:3')
    expect(out).toContain('a.exe(1) 1.00c')
    expect(out).toContain('b.exe(2) 1.00c')
    expect(out).not.toContain('c.exe(3)')
    expect(out).toContain('+1')
  })
  it('runaway 拋錯 → 空字串，不往外拋', () => {
    expect(renderLine5({}, { ...deps, runaway: () => { throw new Error('壞了') } })).toBe('')
  })
})

// 本 describe 一律用「計數器」斷言呼叫次數，絕不用「被呼叫就 throw」的哨兵：
// renderLine5 對 deps.runaway 包了 try/catch（那正是它「絕不 crash」的本體），
// 哨兵拋的錯會被吞掉、走進降級路徑，反而剛好回出期望值 → 假綠。
// 計數器的假依賴也必須回「有效值」，回空陣列會被下游的零噪音路徑遮蔽，看不出差異。
describe('renderLine5 的全域限制', () => {
  it('flagged 全是畸形列 → 空字串，不往外拋', () => {
    const bad = [
      null, undefined, 'x', 42, [], {},
      { pid: 1 }, { name: 'a.exe' }, { pid: 1, name: 'a.exe' },
      { pid: 1, name: 'a.exe', rate: NaN }, { pid: 1, name: 'a.exe', rate: 'x' },
      { pid: NaN, name: 'a.exe', rate: 1 }, { pid: '1', name: 'a.exe', rate: 1 },
      { pid: 1, name: '', rate: 1 }, { pid: 1, name: 7, rate: 1 },
    ]
    expect(renderLine5({}, { ...deps, runaway: () => bad })).toBe('')
  })
  it('畸形列混有效列 → 只列有效列，計數也只算有效列', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [
      null, { pid: 7, name: 'a.exe', rate: 2 }, { pid: '8', name: 'b.exe', rate: 1 },
    ] }))
    expect(out).toContain('⚠ runaway:1')
    expect(out).toContain('a.exe(7) 2.00c')
    expect(out).not.toContain('b.exe')
    expect(out).not.toContain('+')
  })
  it('溢位標記的邊界：2 筆不帶 +N、4 筆帶 +2，且畸形列不計入', () => {
    const row = n => ({ pid: n, name: `p${n}.exe`, rate: 1 })
    const two = strip(renderLine5({}, { ...deps, runaway: () => [row(1), row(2)] }))
    expect(two).toContain('⚠ runaway:2')
    expect(two).toContain('p2.exe(2) 1.00c')
    expect(two).not.toContain('+')
    const four = strip(renderLine5({}, { ...deps, runaway: () => [row(1), row(2), row(3), row(4)] }))
    expect(four).toContain('⚠ runaway:4')
    expect(four).not.toContain('p3.exe')
    expect(four).not.toContain('p4.exe')
    expect(four).toContain('+2')
    const mixed = strip(renderLine5({}, { ...deps, runaway: () => [null, row(1), 'x', row(2), {}, row(3)] }))
    expect(mixed).toContain('⚠ runaway:3')
    expect(mixed).toContain('+1')
  })
  it('回傳非陣列 → 空字串', () => {
    for (const v of [{ pid: 1, name: 'a.exe', rate: 1 }, 'boom', 7, undefined, true]) {
      expect(renderLine5({}, { ...deps, runaway: () => v })).toBe('')
    }
  })
  it('每次渲染只呼叫 deps.runaway 一次（取樣是同步阻塞的外部命令）', () => {
    let n = 0
    const d = { model: { display_name: 'Opus' } }
    const counting = { ...deps, runaway: () => { n += 1; return [{ pid: 1, name: 'a.exe', rate: 1 }] } }
    expect(strip(renderLine5(d, counting))).toContain('⚠ runaway:1')
    expect(n).toBe(1)
    n = 0
    expect(strip(buildOutput(d, counting)).split('\n').length).toBe(5)
    expect(n).toBe(1)
  })
  it('runaway 壞掉不得讓其他 4 行消失或劣化', () => {
    const d = { model: { display_name: 'Opus' }, workspace: { current_dir: '/home/leon/p' } }
    const base = strip(buildOutput(d, deps))
    expect(base.split('\n').length).toBe(4)
    for (const broken of [() => { throw new Error('壞了') }, () => null, () => 'x', () => [null], () => []]) {
      expect(strip(buildOutput(d, { ...deps, runaway: broken }))).toBe(base)
    }
  })
  // 這條只掃第 5 行的輸出。切勿改成掃整份 buildOutput：renderLine4 有 `skill:` 欄位，
  // 正則裡的 kill 會立刻誤報。程式碼面的鎖是下一條靜態測試，不是這條。
  it('警告文字不得暗示或提供終止行程的手段', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [{ pid: 1, name: 'a.exe', rate: 1 }] }))
    expect(out).not.toMatch(/kill|terminate|stop|終止|結束|殺/i)
  })
  // 「只警告，絕不動手」是使用者在設計階段明確裁決的約束，光靠文字回歸鎖不住
  // ——文字沒變但別處被加了終止程式碼，上一條照樣綠。故直接讀原始碼把它釘死。
  it('render.mjs 原始碼不得含任何終止行程的手段', () => {
    const src = readFileSync(new URL('../src/render.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/child_process|taskkill|\bkill\(|process\.kill|SIGTERM|SIGKILL/)
  })
  // 釘住 renderLine5 與 classify 之間的欄位契約：render.test.mjs 其餘假資料都是手寫字面量，
  // 上游把 {pid,name,rate} 改名的話 validFlag 會把每一列濾掉、警告無聲消失而測試全綠。
  it('classify 實際產出的 flagged 形狀接得上 renderLine5（欄位改名要當場紅燈）', () => {
    let st = null
    const mk = cpu => [{ pid: 4242, name: 'node.exe', cpuSeconds: cpu }]
    for (let i = 0; i <= 6; i++) st = classify(st, mk(i * 60), i * 60_000, {}).nextState
    const { flagged } = classify(st, mk(7 * 60), 7 * 60_000, {})
    expect(flagged.length).toBe(1)
    expect(strip(renderLine5({}, { ...deps, runaway: () => flagged }))).toContain('node.exe(4242)')
  })
})

describe('buildOutput', () => {
  it('renders 4 non-empty lines', () => {
    const out = buildOutput({ model: { display_name: 'Opus' }, workspace: { current_dir: '/home/leon/p' } }, deps)
    const lines = strip(out).split('\n')
    expect(lines.length).toBe(4)
    expect(lines[0]).toContain('Opus')
    expect(lines.every(l => l.length > 0)).toBe(true)
  })
  it('empty d 仍輸出完整 4 行（never hide）', () => {
    const lines = strip(buildOutput({}, deps)).split('\n')
    expect(lines.length).toBe(4)
    expect(lines.every(l => l.length > 0)).toBe(true)
  })
  it('有失控行程 → 變成 5 行；無則維持 4 行', () => {
    const d = { model: { display_name: 'Opus' } }
    expect(strip(buildOutput(d, deps)).split('\n').length).toBe(4)
    const withWarn = { ...deps, runaway: () => [{ pid: 1, name: 'a.exe', rate: 1 }] }
    const lines = strip(buildOutput(d, withWarn)).split('\n')
    expect(lines.length).toBe(5)
    expect(lines[4]).toContain('⚠ runaway:1')
  })
})
