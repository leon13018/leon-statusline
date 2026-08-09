import { describe, it, expect } from 'vitest'
import { classify, detect, CONSECUTIVE_REQUIRED, SCAN_INTERVAL_MS, RATE_THRESHOLD } from '../src/runaway.mjs'

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
  it('prev 非物件（磁碟狀態壞掉）→ nextState 為 null，不回吐垃圾', () => {
    // 若原樣回吐字串／數字，呼叫端展開後會寫回 {0:'壞',1:'掉'} 這種垃圾狀態
    expect(classify('壞掉', [], 2, {}).nextState).toBe(null)
    expect(classify('壞掉', null, 2, {}).nextState).toBe(null)
    expect(classify(7, [], 2, {}).nextState).toBe(null)
    expect(classify(true, [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }], NaN, {}).nextState).toBe(null)
  })
})

describe('detect', () => {
  const flaggedOne = [{ pid: 1, name: 'a.exe', rate: 1 }]

  // 註：brief 原文此處的 writeState 是「被呼叫就 throw」的哨兵，但 detect 的 try/catch 會吞掉它
  // ——哨兵零作用。依審查要求改為計數器（語義相同、只是真的驗得到），sample 也改回有效樣本
  it('未達掃描間隔 → 不取樣，直接回快取的 flagged', () => {
    let sampled = 0, written = 0
    const out = detect({
      now: 1000 + SCAN_INTERVAL_MS - 1,
      readState: () => ({ t: 1000, procs: {}, flagged: flaggedOne }),
      writeState: () => { written += 1 },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
    })
    expect({ out, sampled, written }).toEqual({ out: flaggedOne, sampled: 0, written: 0 })
  })
  it('達間隔 → 取樣、判定並寫入狀態', () => {
    let written = null
    const out = detect({
      now: 1000 + SCAN_INTERVAL_MS,
      readState: () => ({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: [] }),
      writeState: s => { written = s },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }],
    })
    expect(out).toEqual([{ pid: 1, name: 'a.exe', rate: 1 }])
    expect(written.procs[1].streak).toBe(5)
    expect(written.flagged).toEqual(out)
  })
  // 原本這條斷言「不寫入」。整合階段證明那個前提（取樣失敗很罕見）是錯的：
  // 取樣恆失敗時「不寫入」＝節流基準永不前進＝每次 render 都重新取樣。
  // 新契約：判定用的 t/procs/flagged 原樣保留，只多記一個 attemptedAt 讓節流走得下去
  it('取樣回 null → 沿用上次 flagged，只推進 attemptedAt 而不動 t/procs', () => {
    let written = null
    const now = 10 * SCAN_INTERVAL_MS
    const out = detect({
      now,
      readState: () => ({ t: 0, procs: { 1: { name: 'a.exe', cpu: 5, streak: 4 } }, flagged: flaggedOne }),
      writeState: s => { written = s },
      sample: () => null,
    })
    expect(out).toEqual(flaggedOne)
    expect(written).toEqual({
      t: 0,                                    // 快照時間基準不動
      procs: { 1: { name: 'a.exe', cpu: 5, streak: 4 } },
      flagged: flaggedOne,
      attemptedAt: now,
    })
  })
  it('首次執行（無狀態）→ 空陣列並建立基準', () => {
    let written = null
    const out = detect({
      now: 5000,
      readState: () => null,
      writeState: s => { written = s },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 3 }],
    })
    expect(out).toEqual([])
    expect(written.t).toBe(5000)
  })
  it('readState 拋錯 → 視為無狀態，不往外拋', () => {
    expect(() => detect({
      now: 1, readState: () => { throw new Error('壞檔') },
      writeState: () => {}, sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }],
    })).not.toThrow()
  })
  it('writeState 拋錯 → 不往外拋，仍回傳判定結果', () => {
    const out = detect({
      now: 1, readState: () => null,
      writeState: () => { throw new Error('磁碟滿') },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }],
    })
    expect(out).toEqual([])
  })
})

// 節流是狀態列不卡頓的唯一保障（sampleProcesses 走同步 execFileSync），
// 也是 classify 對極短 dt 無下限的唯一防線 —— 以下把這條界線釘死
describe('detect 的節流與防呆', () => {
  const flaggedOne = [{ pid: 1, name: 'a.exe', rate: 1 }]
  // ⚠ 本檔一律用「計數器」而非「被呼叫就 throw」的哨兵驗證「某個注入的 I/O 不得被呼叫」：
  // detect 對 readState / writeState / sample 全都包了 try/catch（那是它「絕不 crash」的本體），
  // 哨兵拋的錯會被吞掉，測試反而走上安全路徑而假綠。這裡踩過兩次，別再引入 throw 哨兵。
  it('極短 dt（1ms）不可能走到取樣與判定', () => {
    let sampled = 0, written = 0
    const out = detect({
      now: 1001,
      readState: () => ({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: [] }),
      writeState: () => { written += 1 },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
    })
    expect({ out, sampled, written }).toEqual({ out: [], sampled: 0, written: 0 })
  })
  it('now 非有限數（時鐘壞掉）→ 不取樣、不寫入，回快取的 flagged', () => {
    // 若讓它往下走：classify 判不出來 → 寫回原樣的 t → 節流永久失效，每次 render 都同步取樣一次
    // 註：哨兵不能用 throw（會被 detect 的 try 吞掉而假綠），必須數呼叫次數
    for (const now of [NaN, undefined, Infinity, -Infinity]) {
      let sampled = 0, written = 0
      const out = detect({
        now,
        readState: () => ({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: flaggedOne }),
        writeState: () => { written += 1 },
        sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
      })
      expect({ now, out, sampled, written }).toEqual({ now, out: flaggedOne, sampled: 0, written: 0 })
    }
  })
  it('now 非有限數時連跑三輪 → 狀態不被洗掉，具自癒能力', () => {
    let disk = { t: 1000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: flaggedOne }
    let sampled = 0
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
    })
    for (let i = 0; i < 3; i += 1) expect(run(NaN)).toEqual(flaggedOne)
    expect(sampled).toBe(0)
    expect(disk.t).toBe(1000)                 // 時鐘恢復後，仍以原基準續判
    expect(run(1000 + SCAN_INTERVAL_MS)).toEqual(flaggedOne)
    expect(sampled).toBe(1)
  })
  it('基準落在未來（時鐘往回跳）→ 視同無基準重建，不是一路早退', () => {
    // (now - t) 為大負數時恆 < interval，若照節流早退，偵測器會停擺到時鐘追上為止且毫無跡象
    let written = null, sampled = 0
    const out = detect({
      now: 1000,
      readState: () => ({ t: 10_000_000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: flaggedOne }),
      writeState: s => { written = s },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
    })
    expect(out).toEqual([])
    expect(sampled).toBe(1)
    expect(written).toEqual({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 60, streak: 0 } }, flagged: [] })
  })
  it('時鐘往回跳後一輪就重建基準，之後回到正常節流', () => {
    let disk = { t: 10_000_000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: flaggedOne }
    let sampled = 0
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 + sampled * 60 }] },
    })
    run(1000)
    expect(disk.t).toBe(1000)                 // 基準已重建於當下
    run(1000 + SCAN_INTERVAL_MS - 1)          // 重建後節流照常生效
    expect(sampled).toBe(1)
    run(1000 + SCAN_INTERVAL_MS)
    expect(sampled).toBe(2)
    expect(disk.t).toBe(1000 + SCAN_INTERVAL_MS)
  })
  it('狀態是陣列 → 不寫出 {"0":..} 這種垃圾狀態', () => {
    // typeof [] === 'object'，光靠 typeof 守衛擋不住；判不出來就整個不寫才擋得住
    let written = 'NOT_CALLED'
    const out = detect({
      now: 2, readState: () => ['垃', '圾'],
      writeState: s => { written = s },
      sample: () => [],
    })
    expect(out).toEqual([])
    expect(written).toBe('NOT_CALLED')
  })
  it('sample 回傳非陣列的垃圾 → 不寫入（避免 t 不前進導致節流失效）', () => {
    let written = 'NOT_CALLED'
    const out = detect({
      now: SCAN_INTERVAL_MS,
      readState: () => ({ t: 0, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: flaggedOne }),
      writeState: s => { written = s },
      sample: () => ({ bad: 1 }),
    })
    expect(out).toEqual([])
    expect(written).toBe('NOT_CALLED')
  })
  it('節流預設以 SCAN_INTERVAL_MS 為界，邊界兩側各釘一次', () => {
    let calls = 0
    const run = now => detect({
      now,
      readState: () => ({ t: 0, procs: {}, flagged: flaggedOne }),
      writeState: () => {},
      sample: () => { calls += 1; return [] },
    })
    run(SCAN_INTERVAL_MS - 1)
    expect(calls).toBe(0)
    run(SCAN_INTERVAL_MS)
    expect(calls).toBe(1)
  })
  it('磁碟狀態是畸形字串 → 不寫回垃圾狀態、不拋錯', () => {
    let written = 'NOT_CALLED'
    const out = detect({
      now: 2, readState: () => '壞掉的狀態檔',
      writeState: s => { written = s },
      sample: () => [],                       // 有取樣但無有效列 → classify 無法判定
    })
    expect(out).toEqual([])
    expect(written).toBe('NOT_CALLED')
  })
  it('狀態的 t 非數字 → 視同無基準重新建立，不誤判', () => {
    let written = null
    const out = detect({
      now: 5000,
      readState: () => ({ t: 'x', procs: {}, flagged: flaggedOne }),
      writeState: s => { written = s },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 3 }],
    })
    expect(out).toEqual([])
    expect(written).toEqual({ t: 5000, procs: { 1: { name: 'a.exe', cpu: 3, streak: 0 } }, flagged: [] })
  })
  it('快取的 flagged 非陣列 → 回空陣列，且仍在節流期內不取樣', () => {
    let sampled = 0, written = 0
    const out = detect({
      now: 1001,
      readState: () => ({ t: 1000, procs: {}, flagged: '壞掉' }),
      writeState: () => { written += 1 },
      sample: () => { sampled += 1; return [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }] },
    })
    expect({ out, sampled, written }).toEqual({ out: [], sampled: 0, written: 0 })
  })
  // sample 拋錯與 sample 回 null 走同一條路（procscan 兩種失敗都可能發生：逾時會拋、解析不出會回 null）
  it('sample 拋錯 → 沿用上次 flagged，且同樣推進 attemptedAt', () => {
    let written = null
    const out = detect({
      now: SCAN_INTERVAL_MS,
      readState: () => ({ t: 0, procs: {}, flagged: flaggedOne }),
      writeState: s => { written = s },
      sample: () => { throw new Error('tasklist 掛了') },
    })
    expect(out).toEqual(flaggedOne)
    expect(written).toEqual({ t: 0, procs: {}, flagged: flaggedOne, attemptedAt: SCAN_INTERVAL_MS })
  })

  // 沒有任何既有狀態時（本機的實際處境：狀態檔從未建立成功）也必須立起節流基準，
  // 否則「取樣失敗 → 無狀態可推進 → 下次仍立刻取樣」的迴圈原封不動
  it('無狀態且取樣失敗 → 仍寫出乾淨的空基準，讓節流從第二次 render 起生效', () => {
    let disk = null, sampled = 0
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      sample: () => { sampled += 1; return null },
    })
    expect(run(1000)).toEqual([])
    expect(disk).toEqual({ t: 1000, procs: {}, flagged: [], attemptedAt: 1000 })
    run(1000 + SCAN_INTERVAL_MS - 1)
    expect(sampled).toBe(1)                    // 第二次 render 被節流擋下，沒有再付一次取樣成本
  })
  // 取樣失敗不是罕見情境：整合階段實測本機 tasklist /v 需約 29.5 秒，恆超過 procscan 的 3 秒逾時，
  // 也就是說「取樣永遠失敗」在真機上是常態。舊行為在失敗時完全不寫狀態 → 節流基準永不前進
  // → 每一次 render 都得再付一次完整的取樣成本，「每分鐘至多一次」退化成「每次 render 一次」
  it('取樣恆失敗時節流仍生效：sample 呼叫次數＝經過時間÷間隔，不是 render 次數', () => {
    let disk = null, sampled = 0
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      sample: () => { sampled += 1; return null },
    })
    const STEP = 10_000                       // statusline 的 refreshInterval 是 10 秒
    const SPAN = 5 * SCAN_INTERVAL_MS
    let renders = 0
    for (let now = 0; now < SPAN; now += STEP) { run(now); renders += 1 }
    expect(renders).toBe(30)
    expect(sampled).toBe(SPAN / SCAN_INTERVAL_MS)   // 5，而不是 30
  })

  // 防止「為了修節流而把判定狀態洗掉」：t（procs 快照的時間基準）與 procs 都必須原樣保留，
  // 否則恢復取樣時會拿舊快照的 cpu 差去除以被推進過的短區間 → 速率高估 → 誤報
  it('取樣失敗數輪後恢復 → streak 不重置且區間速率算得正確', () => {
    let disk = null, ok = true, sampled = 0
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      // 恆定 1.0 核：cpuSeconds 與牆鐘同步成長
      sample: () => { sampled += 1; return ok ? [{ pid: 9, name: 'hog.exe', cpuSeconds: now / 1000 }] : null },
    })
    for (let i = 0; i <= 3; i += 1) run(i * MIN)          // 基準 + 3 個超標區間 → streak 3
    expect(disk.procs[9].streak).toBe(3)
    ok = false
    run(4 * MIN); run(5 * MIN)                            // 連兩輪取樣失敗
    expect(disk.procs[9].streak).toBe(3)                  // 狀態沒被洗掉
    expect(disk.procs[9].cpu).toBe(180)                   // 快照仍是最後一次成功取樣的值
    ok = true
    expect(run(6 * MIN)).toEqual([])                      // 恢復：第 4 個區間，還沒滿 5
    expect(disk.procs[9].streak).toBe(4)
    const out = run(7 * MIN)
    expect(disk.procs[9].streak).toBe(CONSECUTIVE_REQUIRED)
    // 速率必須是 1（真實值）。若失敗時把 t 一併推進，這裡會算成 3 之類的高估值
    expect(out).toEqual([{ pid: 9, name: 'hog.exe', rate: 1 }])
    expect(sampled).toBe(8)                               // 每個區間各一次，失敗的兩次也算
  })

  // 上一條其實抓不到「t 也一起推進」這個變體（實測：那個變體下最後一個區間的速率仍是 1）。
  // 這條專門釘住它：把 t 一起推進會縮短區間、高估速率，讓真實只用 0.2 核的行程被算成 1.0 核
  it('取樣失敗期間 t 不得推進：恢復後的速率以「上次成功取樣」為基準，不得高估', () => {
    let disk = null, ok = true
    const run = now => detect({
      now,
      readState: () => disk,
      writeState: s => { disk = s },
      sample: () => ok ? [{ pid: 9, name: 'idle.exe', cpuSeconds: 0.2 * (now / 1000) }] : null,
      cfg: { required: 1 },                    // 一個超標區間就標記，讓速率直接可觀測
    })
    run(0)                                     // 基準
    ok = false
    for (let i = 1; i <= 4; i += 1) run(i * MIN)
    ok = true
    // 真實 0.2 核 < 0.5 門檻 → 不得標記。t 若被一起推進，區間會從 300 秒縮成 60 秒 → 誤算成 1.0 核
    expect(run(5 * MIN)).toEqual([])
    expect(disk.procs[9].streak).toBe(0)
  })

  it('缺參數或 cfg 畸形一律不拋錯，並回空陣列', () => {
    expect(detect()).toEqual([])
    expect(detect({})).toEqual([])
    expect(() => detect({ now: 1, readState: () => null, writeState: () => {}, sample: () => [], cfg: null })).not.toThrow()
    expect(() => detect({ now: 1, readState: () => null, writeState: () => {}, sample: () => [], cfg: 'x' })).not.toThrow()
    const out = detect({
      now: 0, readState: () => null, writeState: () => {},
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }], cfg: null,
    })
    expect(out).toEqual([])
  })
})
