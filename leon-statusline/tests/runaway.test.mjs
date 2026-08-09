import { describe, it, expect } from 'vitest'
import { classify, CONSECUTIVE_REQUIRED, SCAN_INTERVAL_MS, RATE_THRESHOLD } from '../src/runaway.mjs'

const MIN = 60_000
// 依序餵入多輪樣本，回傳最後一次的結果
const feed = (rounds) => {
  let state = null, last = null
  rounds.forEach(({ sample, t }) => {
    last = classify(state, sample, t, {})
    state = last.nextState
  })
  return last
}
// 每輪固定 cpu 增量的單一行程
const ramp = (pid, name, perRound, count) =>
  Array.from({ length: count }, (_, i) => ({ t: i * MIN, sample: [{ pid, name, cpuSeconds: i * perRound }] }))

describe('classify', () => {
  it('持續 1.0 核 → 第 6 個樣本（第 5 個區間）標記（tsserver 31832）', () => {
    const rounds = ramp(31832, 'node.exe', 60, CONSECUTIVE_REQUIRED + 1)
    const out = feed(rounds)
    expect(out.flagged).toEqual([{ pid: 31832, name: 'node.exe', rate: 1 }])
  })
  it('滿 5 個區間前不標記（邊界）', () => {
    const out = feed(ramp(31832, 'node.exe', 60, CONSECUTIVE_REQUIRED))
    expect(out.flagged).toEqual([])
  })
  it('持續 0.03 核 → 永不標記（健康的 tsserver 33452）', () => {
    const out = feed(ramp(33452, 'node.exe', 1.8, 10))
    expect(out.flagged).toEqual([])
  })
  it('連續 4 個區間超標後回落 → 計數歸零，不標記', () => {
    const rounds = [
      ...ramp(1, 'x.exe', 60, 5),                                  // 4 個超標區間
      { t: 5 * MIN, sample: [{ pid: 1, name: 'x.exe', cpuSeconds: 4 * 60 + 1 }] },  // 第 5 個區間僅 1 秒
      { t: 6 * MIN, sample: [{ pid: 1, name: 'x.exe', cpuSeconds: 4 * 60 + 61 }] }, // 再超標一次
    ]
    expect(feed(rounds).flagged).toEqual([])
  })
  it('短命 spinner：只出現一輪就消失 → 不標記，且不留在 nextState', () => {
    const out = feed([
      { t: 0, sample: [{ pid: 7, name: 'node.exe', cpuSeconds: 0 }] },
      { t: MIN, sample: [{ pid: 7, name: 'node.exe', cpuSeconds: 60 }] },
      { t: 2 * MIN, sample: [{ pid: 99, name: 'other.exe', cpuSeconds: 0 }] },
    ])
    expect(out.flagged).toEqual([])
    expect(out.nextState.procs[7]).toBeUndefined()
  })
  it('累計 CPU 變小（PID 重用）→ 計數歸零', () => {
    const rounds = [...ramp(5, 'a.exe', 60, 5), { t: 5 * MIN, sample: [{ pid: 5, name: 'a.exe', cpuSeconds: 0 }] }]
    const out = feed(rounds)
    expect(out.flagged).toEqual([])
    expect(out.nextState.procs[5].streak).toBe(0)
  })
  it('同 PID 但行程名不同 → 計數歸零', () => {
    const rounds = [...ramp(5, 'a.exe', 60, 5), { t: 5 * MIN, sample: [{ pid: 5, name: 'b.exe', cpuSeconds: 400 }] }]
    expect(feed(rounds).nextState.procs[5].streak).toBe(0)
  })
  it('首次執行（prev 為 null）→ 只建立基準', () => {
    const out = classify(null, [{ pid: 1, name: 'a.exe', cpuSeconds: 999 }], 1000, {})
    expect(out.flagged).toEqual([])
    expect(out.nextState).toEqual({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 999, streak: 0 } } })
  })
  it('時間未前進（時鐘異常）→ 原樣回傳 prev，不誤判', () => {
    const prev = { t: 5000, procs: { 1: { name: 'a.exe', cpu: 10, streak: 4 } } }
    const out = classify(prev, [{ pid: 1, name: 'a.exe', cpuSeconds: 9999 }], 5000, {})
    expect(out.flagged).toEqual([])
    expect(out.nextState).toBe(prev)
  })
  it('sample 為 null 或空陣列 → 保留 prev', () => {
    const prev = { t: 1, procs: {} }
    expect(classify(prev, null, 2, {}).nextState).toBe(prev)
    expect(classify(prev, [], 2, {}).nextState).toBe(prev)
  })
})

// 以下為全域限制的守門測試：純函式、不 crash、常數契約
describe('classify 的全域限制', () => {
  it('常數為計畫指定的確切值', () => {
    expect(SCAN_INTERVAL_MS).toBe(60_000)
    expect(RATE_THRESHOLD).toBe(0.5)
    expect(CONSECUTIVE_REQUIRED).toBe(5)
  })
  it('不就地修改 prev（回傳新的 nextState）', () => {
    const prev = { t: 0, procs: { 1: { name: 'a.exe', cpu: 0, streak: 3 } } }
    const snapshot = JSON.parse(JSON.stringify(prev))
    const out = classify(prev, [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }], MIN, {})
    expect(prev).toEqual(snapshot)
    expect(out.nextState).not.toBe(prev)
    expect(out.nextState.procs).not.toBe(prev.procs)
    expect(out.nextState.procs[1]).not.toBe(prev.procs[1])
  })
  it('cfg 可覆寫門檻與連續次數', () => {
    let state = null, out = null
    for (const r of ramp(1, 'a.exe', 60, 3)) {
      out = classify(state, r.sample, r.t, { rateThreshold: 0.9, required: 2 })
      state = out.nextState
    }
    expect(out.flagged).toEqual([{ pid: 1, name: 'a.exe', rate: 1 }])
    // 門檻拉到 1.5 核時同一段資料不該標記
    let s2 = null, o2 = null
    for (const r of ramp(1, 'a.exe', 60, 3)) {
      o2 = classify(s2, r.sample, r.t, { rateThreshold: 1.5, required: 2 })
      s2 = o2.nextState
    }
    expect(o2.flagged).toEqual([])
  })
  it('cfg 省略時使用預設常數', () => {
    const out = classify(null, [{ pid: 1, name: 'a.exe', cpuSeconds: 0 }], 0)
    expect(out.nextState.procs[1].streak).toBe(0)
  })
  it('畸形輸入一律不 throw', () => {
    const bad = [
      undefined, null, 42, 'x', {}, [],
      [null], [undefined], ['x'], [{}],
      [{ pid: 'a', name: 'a.exe', cpuSeconds: 1 }],
      [{ pid: 1, name: 5, cpuSeconds: 1 }],
      [{ pid: 1, name: 'a.exe', cpuSeconds: NaN }],
      [{ pid: 1, name: 'a.exe' }],
    ]
    const prevs = [undefined, null, 'x', 7, {}, { t: NaN, procs: {} }, { t: 0 }, { t: 0, procs: null }]
    for (const p of prevs) {
      for (const s of bad) {
        expect(() => classify(p, s, 1000, {})).not.toThrow()
        expect(() => classify(p, s, NaN)).not.toThrow()
      }
    }
  })
  it('畸形的 sample 項目被略過，正常項目照常判定', () => {
    const s0 = [null, { pid: 1, name: 'a.exe', cpuSeconds: 0 }, { pid: 'x', name: 'b.exe', cpuSeconds: 0 }]
    const s1 = [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }, 'junk']
    const a = classify(null, s0, 0, {})
    expect(Object.keys(a.nextState.procs)).toEqual(['1'])
    const b = classify(a.nextState, s1, MIN, { required: 1 })
    expect(b.flagged).toEqual([{ pid: 1, name: 'a.exe', rate: 1 }])
  })
  it('now 非有限數 → 原樣保留 prev', () => {
    const prev = { t: 0, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } } }
    expect(classify(prev, [{ pid: 1, name: 'a.exe', cpuSeconds: 9999 }], NaN, {}).nextState).toBe(prev)
  })
})
