# compact bar 改讀真實 auto-compact 視窗 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓第 1 行 compact bar 讀 `~/.claude/settings.json` 的 `autoCompactWindow`（tokens），用 `total_input_tokens ÷ window` 算進度，使其隨 `/autocompact` 即時變動；沒設過則沿用 95% 近似。

**Architecture:** 純函式邏輯在 `src/compact.mjs`（新增 `autoCompactWindow` 擷取器、改寫 `autoCompactPct` 為具名物件參數、token 路徑優先）；I/O 在進入點 `statusline.mjs` 讀 user settings、把視窗數注入 `deps`；`render.mjs` bar 行改傳物件。`readJson` 由 `count.mjs` export 共用。

**Tech Stack:** Node ESM（`.mjs`）、Vitest（dev-only）、零執行期依賴。

## Global Constraints

- **永不崩潰**：進入點一律 `process.exit(0)`、至少印一行；新增檔案讀取全程容錯、不 throw、不阻塞 render。
- **零執行期依賴**：只用 Node 內建。
- **路徑安全**：一律 `os.homedir()` + `path.join()`，不字串拼路徑、不讀 `$HOME`/`~`。
- **`src/compact.mjs` 維持純函式**（不 import fs）。
- **只讀 user 層** `~/.claude/settings.json` 的 `autoCompactWindow`；不讀 project/local。
- **env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`** 只在「近似後備」路徑生效；有 `autoCompactWindow` 時忽略。
- **TDD 先紅後綠**、逐 task commit、**`git add <明確檔案>`（絕不 `-A`）**。
- 產出（程式碼註解 / commit message）用**繁體中文**。
- 完成後 bump `leon-statusline/.claude-plugin/plugin.json` `version` → **1.4.1**。
- 測試指令：全跑 `npx vitest run`；單檔 `npx vitest run tests/<file>`（在 `leon-statusline/` 目錄下）。

---

### Task 1: `autoCompactWindow(settingsObjs)` 擷取器（純加法）

**Files:**
- Modify: `leon-statusline/src/compact.mjs`（新增 export，不動既有）
- Test: `leon-statusline/tests/compact.test.mjs`（新增 describe）

**Interfaces:**
- Produces: `autoCompactWindow(settingsObjs: object[]): number | null` — 依序回傳第一個 `s.autoCompactWindow` 為有限正數者，否則 `null`。

- [ ] **Step 1: Write the failing test**

在 `leon-statusline/tests/compact.test.mjs` 的 import 行加入 `autoCompactWindow`：

```js
import { autoCompactThreshold, autoCompactPct, autoCompactWindow, DEFAULT_AUTOCOMPACT_PCT } from '../src/compact.mjs'
```

在檔案末端新增：

```js
describe('autoCompactWindow', () => {
  it('取第一個有效正數視窗', () => {
    expect(autoCompactWindow([{ autoCompactWindow: 500000 }])).toBe(500000)
    expect(autoCompactWindow([{}, { autoCompactWindow: 1000000 }])).toBe(1000000)
    expect(autoCompactWindow([{ autoCompactWindow: 0 }, { autoCompactWindow: 800000 }])).toBe(800000)
  })
  it('跳過 null/0/負/NaN/非數字；全無 → null', () => {
    expect(autoCompactWindow([{ autoCompactWindow: 0 }])).toBe(null)
    expect(autoCompactWindow([{ autoCompactWindow: -1 }])).toBe(null)
    expect(autoCompactWindow([{ autoCompactWindow: 'big' }])).toBe(null)
    expect(autoCompactWindow([null, undefined, {}])).toBe(null)
    expect(autoCompactWindow([])).toBe(null)
    expect(autoCompactWindow()).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/compact.test.mjs`
Expected: FAIL —「autoCompactWindow is not a function」。

- [ ] **Step 3: Write minimal implementation**

在 `leon-statusline/src/compact.mjs` 末端新增：

```js
// 從 settings 物件陣列（依優先序排好）取第一個有效的 autoCompactWindow（tokens）；無 → null
export function autoCompactWindow(settingsObjs) {
  for (const s of settingsObjs || []) {
    const w = s && s.autoCompactWindow
    if (Number.isFinite(w) && w > 0) return w
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/compact.test.mjs`
Expected: PASS（全部，含既有 autoCompactThreshold / autoCompactPct）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/compact.mjs leon-statusline/tests/compact.test.mjs
git commit -m "feat(compact): autoCompactWindow 從 settings 取真實 token 視窗"
```

---

### Task 2: `autoCompactPct` 改物件參數 + token 路徑（含 render 呼叫端原子切換）

**Files:**
- Modify: `leon-statusline/src/compact.mjs`（改寫 `autoCompactPct`）
- Modify: `leon-statusline/src/render.mjs:26`（bar 呼叫改物件形）
- Test: `leon-statusline/tests/compact.test.mjs`（改寫 autoCompactPct describe）
- Test: `leon-statusline/tests/render.test.mjs`（bar token-window 新案例）

**Interfaces:**
- Consumes: 無（不依賴 Task 1 的 `autoCompactWindow`）。
- Produces: `autoCompactPct({ usedTokens?, usedPercentage?, window?, threshold? }): number | null` —
  - 有 `window`（有限正數）且 `usedTokens`（有限 ≥0）→ `clamp((usedTokens/window)*100)`；
  - 否則 `usedPercentage` 有限 → `clamp((usedPercentage/threshold)*100)`，`threshold` 預設 `autoCompactThreshold()`；
  - 皆缺 → `null`。

> ⚠️ 此 task 把 `autoCompactPct` 簽名從 positional 改成物件，並**同時**更新唯一呼叫端 `render.mjs`，使整個測試套件在 commit 時保持綠燈。`render.mjs` 傳入的 `deps.autoCompactWindow` 在 Task 4 前為 `undefined` → 自動走近似路徑，畫面行為與 v1.4.0 相同。

- [ ] **Step 1: Write the failing tests**

把 `leon-statusline/tests/compact.test.mjs` 的整個 `describe('autoCompactPct', …)` 區塊（約第 17–30 行）**替換**為：

```js
describe('autoCompactPct', () => {
  it('token 路徑：usedTokens ÷ window', () => {
    expect(autoCompactPct({ usedTokens: 250000, window: 500000 })).toBe(50)
    expect(autoCompactPct({ usedTokens: 95689, window: 1000000 })).toBeCloseTo(9.5689, 4)
  })
  it('token 路徑夾 0–100', () => {
    expect(autoCompactPct({ usedTokens: 600000, window: 500000 })).toBe(100) // usedTokens > window
    expect(autoCompactPct({ usedTokens: -5, window: 500000 })).toBe(0)
  })
  it('無有效 window → 近似 usedPercentage ÷ threshold', () => {
    expect(autoCompactPct({ usedPercentage: 47.5, threshold: 95 })).toBe(50)
    expect(autoCompactPct({ usedPercentage: 0, threshold: 95 })).toBe(0)
    expect(autoCompactPct({ usedPercentage: 47.5, window: 0, threshold: 95 })).toBe(50) // window 0 無效
    expect(autoCompactPct({ usedPercentage: 120, threshold: 95 })).toBe(100)
  })
  it('window 在但 usedTokens 缺 → 走近似', () => {
    expect(autoCompactPct({ usedPercentage: 47.5, window: 500000, threshold: 95 })).toBe(50)
  })
  it('兩者皆缺 → null', () => {
    expect(autoCompactPct({})).toBe(null)
    expect(autoCompactPct({ usedPercentage: null, threshold: 95 })).toBe(null)
    expect(autoCompactPct()).toBe(null)
  })
})
```

在 `leon-statusline/tests/render.test.mjs` 的 `describe('renderLine1 (never hide)', …)` 內，最後一個 `it`（bar 50%）後新增：

```js
  it('有 autoCompactWindow → bar 用 total_input_tokens÷window，且隨視窗變動', () => {
    const d = { context_window: { total_input_tokens: 250000, used_percentage: 25 } }
    const out500k = strip(renderLine1(d, { ...deps, autoCompactWindow: 500000 }))
    expect(out500k).toContain('50%')        // 250000/500000
    expect(out500k).not.toContain('26%')    // 非近似 25/95≈26
    const out1m = strip(renderLine1(d, { ...deps, autoCompactWindow: 1000000 }))
    expect(out1m).toContain('25%')          // 250000/1000000 → 視窗變大 → %變小
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compact.test.mjs tests/render.test.mjs`
Expected: FAIL — compact 新案例因舊 positional 簽名回傳錯值（如 `autoCompactPct({usedTokens:250000,window:500000})` 舊碼讀 `usedPercentage=物件` → null）；render token 案例顯示近似值而非 50%。

- [ ] **Step 3: Write the implementation**

把 `leon-statusline/src/compact.mjs` 的 `autoCompactPct`（約第 10–13 行）**替換**為：

```js
// 計算 auto-compact 進度 %（0–100）。真實 token 視窗優先，否則 used% 對門檻近似；皆缺 → null
export function autoCompactPct({ usedTokens, usedPercentage, window, threshold = autoCompactThreshold() } = {}) {
  if (Number.isFinite(window) && window > 0 && Number.isFinite(usedTokens) && usedTokens >= 0) {
    return Math.max(0, Math.min(100, (usedTokens / window) * 100))
  }
  if (usedPercentage == null || !Number.isFinite(usedPercentage)) return null
  return Math.max(0, Math.min(100, (usedPercentage / threshold) * 100))
}
```

把 `leon-statusline/src/render.mjs:26` 的 bar 行**替換**為：

```js
    colorize('compact', DIM) + ' ' + gradientBar(autoCompactPct({
      usedTokens: cw.total_input_tokens,
      usedPercentage: cw.used_percentage,
      window: deps.autoCompactWindow,
      threshold: deps.autoCompactThreshold,
    })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/compact.test.mjs tests/render.test.mjs`
Expected: PASS（含既有「bar 顯示 50%」「真 0 token & pct」等案例 —— 無 window 時走近似，行為不變）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/compact.mjs leon-statusline/src/render.mjs leon-statusline/tests/compact.test.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(compact): autoCompactPct 物件參數 + token 視窗優先；render bar 同步切換"
```

---

### Task 3: `count.mjs` export `readJson`（給進入點共用）

**Files:**
- Modify: `leon-statusline/src/count.mjs:44`（`function readJson` → `export function readJson`）
- Test: `leon-statusline/tests/count.test.mjs`（新增 readJson 案例）

**Interfaces:**
- Produces: `readJson(file: string): object | null` — 容錯讀 JSON，失敗回 `null`。

- [ ] **Step 1: Write the failing test**

在 `leon-statusline/tests/count.test.mjs` 第 5 行 import 加入 `readJson`：

```js
import { countClaudeMd, countDirFiles, countMemory, readJson } from '../src/count.mjs'
```

在檔案末端新增（沿用既有 `root` 暫存目錄）：

```js
describe('readJson', () => {
  it('讀有效 JSON；缺檔/壞檔 → null', () => {
    const f = join(root, 'settings.json')
    writeFileSync(f, '{"autoCompactWindow":123}')
    expect(readJson(f)).toEqual({ autoCompactWindow: 123 })
    writeFileSync(f, '{ not json')
    expect(readJson(f)).toBe(null)
    expect(readJson(join(root, 'nope-does-not-exist.json'))).toBe(null)
  })
})
```

> 註：`count.test.mjs` 已 import `describe, it, expect`、`writeFileSync`、`join`，並在 `beforeEach` 建立 `root` 暫存目錄、`afterEach` 清除。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/count.test.mjs`
Expected: FAIL —「readJson is not a function」（未 export）。

- [ ] **Step 3: Write the implementation**

在 `leon-statusline/src/count.mjs` 把第 44 行：

```js
function readJson(file) {
```

改成：

```js
export function readJson(file) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/count.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/count.mjs leon-statusline/tests/count.test.mjs
git commit -m "refactor(count): export readJson 供進入點共用"
```

---

### Task 4: 進入點注入 `autoCompactWindow` + bump 版本 1.4.1

**Files:**
- Modify: `leon-statusline/statusline.mjs`（import + 讀 user settings + deps 注入）
- Modify: `leon-statusline/.claude-plugin/plugin.json`（`version` → `1.4.1`）
- Test: `leon-statusline/tests/integration.test.mjs`（不改內容，跑全套驗證）

**Interfaces:**
- Consumes: `autoCompactWindow`（Task 1）、`readJson`（Task 3）。
- Produces: `deps.autoCompactWindow: number | null`，供 `render.mjs`（Task 2）使用。

- [ ] **Step 1: Edit imports**

把 `leon-statusline/statusline.mjs` 第 1–7 行**替換**為：

```js
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseInput } from './src/input.mjs'
import { buildOutput } from './src/render.mjs'
import { gitInfo } from './src/git.mjs'
import { countInfra, readJson } from './src/count.mjs'
import { withCache } from './src/cache.mjs'
import { autoCompactThreshold, autoCompactWindow } from './src/compact.mjs'
```

- [ ] **Step 2: Read user settings & inject dep**

把 `leon-statusline/statusline.mjs` 內：

```js
    const home = homedir()
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
      autoCompactThreshold: autoCompactThreshold(),
    }
```

**替換**為：

```js
    const home = homedir()
    // 每次 render 即時讀 user settings 的 autoCompactWindow（隨 /autocompact 立即反映）
    const userSettings = readJson(join(home, '.claude', 'settings.json'))
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
      autoCompactThreshold: autoCompactThreshold(),
      autoCompactWindow: autoCompactWindow([userSettings]),
    }
```

- [ ] **Step 3: Run full suite to verify no break**

Run: `npx vitest run`
Expected: PASS（含 `integration.test.mjs`：空/壞 JSON/缺欄位仍 exit 0 且 4 行；進入點讀真實 user settings 不崩）。

- [ ] **Step 4: Bump version**

把 `leon-statusline/.claude-plugin/plugin.json` 的：

```json
  "version": "1.4.0",
```

改成：

```json
  "version": "1.4.1",
```

- [ ] **Step 5: Smoke test 進入點（手動，可選）**

Run（在 `leon-statusline/`，PowerShell）：
```
'{"model":{"display_name":"Opus"},"workspace":{"current_dir":"."},"context_window":{"total_input_tokens":250000,"used_percentage":25}}' | node statusline.mjs
```
Expected: 印出 4 行;第 1 行含 `compact` 與一個 bar 百分比、exit 0（若本機 `autoCompactWindow=1000000`，bar 顯示 250000/1000000≈25%）。

- [ ] **Step 6: Commit**

```bash
git add leon-statusline/statusline.mjs leon-statusline/.claude-plugin/plugin.json
git commit -m "feat(statusline): 進入點注入真實 autoCompactWindow + bump 1.4.1"
```

---

### Task 5: 文件對齊（attributes / journal / CODE_MAP）

**Files:**
- Modify: `resources/statusline-attributes.md`（context bar 列公式）
- Modify: `resources/development-journal.md`（版本沿革 + §13）
- Modify: `leon-statusline/CODE_MAP.md`（compact.mjs / count.mjs 註記）

> 純文件，無測試。逐檔改好後一次 commit。

- [ ] **Step 1: `statusline-attributes.md` context bar 列**

把第 1 行表格中「context bar（auto-compact %）」那列的「格式」欄改為（重點：真實視窗優先、來源 settings、否則近似）：

```
`compact` + 20 格 `█/░` + ` NN%`；有 `~/.claude/settings.json` 的 `autoCompactWindow`（tokens，`/autocompact` 設定值）→ NN = total_input_tokens ÷ autoCompactWindow × 100、隨 `/autocompact` 即時變動；否則後備近似 NN = used_percentage ÷ 門檻（env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 否則 95）。綠→紅。
```

- [ ] **Step 2: `development-journal.md` 版本沿革加列**

在版本沿革表 `| 1.4.0 |` 列下新增：

```
| 1.4.1 | 修 compact bar：改讀 `~/.claude/settings.json` 的 `autoCompactWindow`（tokens），用 total_input_tokens÷window 算進度，隨 `/autocompact` 即時變動；無則沿用 95% 近似 |
```

- [ ] **Step 3: `development-journal.md` 新增 §13**

在 §12 之後、`## 版本沿革` 之前新增：

```markdown
---

## 13. v1.4.1：compact bar 改讀真實 auto-compact 視窗

- 症狀：改 `/autocompact`（500k↔1m）時 bar 的 % 不變。
- 根因（systematic-debugging，4 來源一致）：v1.4.0 用 `used_percentage ÷ 95` 近似，而 `/autocompact` 實際把視窗（tokens）寫進 `~/.claude/settings.json` 的 `autoCompactWindow`；stdin JSON **不含**任何 auto-compact 欄位（真實擷取證實）。兩個輸入都與該設定無關 → bar 凍結。
- 修法：有 `autoCompactWindow` → `compact% = total_input_tokens ÷ autoCompactWindow × 100`（夾 0–100）；否則沿用近似。每次 render 即時讀 user 層 settings（不進 60s 快取）→ 改 `/autocompact` 下一次 render 立即反映。env override 僅留在近似後備路徑。
- 實作：`compact.mjs` 加 `autoCompactWindow(settingsObjs)`、`autoCompactPct` 改具名物件參數（token 路徑優先）；`count.mjs` export `readJson`；`statusline.mjs` 注入 `deps.autoCompactWindow`。純函式全測，永不崩潰不變。
```

- [ ] **Step 4: `CODE_MAP.md` 註記**

把 `leon-statusline/CODE_MAP.md` 的 `compact.mjs` 那行改為：

```
- `compact.mjs` — `autoCompactThreshold`（env 否則 95）/ `autoCompactWindow`（從 settings 取真實 token 視窗）/ `autoCompactPct`（token 視窗優先、否則近似，給第 1 行 bar）
```

把 `count.mjs` 那行末補上 `；export `readJson``（給進入點讀 settings 共用）。

- [ ] **Step 5: Commit**

```bash
git add resources/statusline-attributes.md resources/development-journal.md leon-statusline/CODE_MAP.md
git commit -m "docs: v1.4.1 compact bar 真實視窗（attributes/journal §13/CODE_MAP）"
```

---

## 完成後

跑 `npx vitest run` 全綠 → 進 `superpowers:finishing-a-development-branch`：驗測試 → 選項（你慣例選「合回 main 本地」）→ push 另外問。

## Self-Review（已對 spec 核對）

- **Spec coverage**：§3.1 公式→Task 2；§3.2 來源/即時讀→Task 4；§3.3 env 後備→Task 2 threshold 路徑；§4.1 compact.mjs→Task 1+2；§4.2 readJson export→Task 3；§4.3 statusline 注入→Task 4；§4.4 render→Task 2；§6 測試→各 task；§7 版本/文件→Task 4/5。無缺口。
- **Placeholder scan**：無 TBD/TODO；每個 code step 附完整碼。
- **Type consistency**：`autoCompactPct({usedTokens,usedPercentage,window,threshold})` 與 `autoCompactWindow(settingsObjs)→number|null`、`readJson(file)→object|null` 在 Task 1–4 一致；render 呼叫端鍵名與 compact 簽名相符。
