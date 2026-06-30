# context bar 改為 auto-compact % Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把第 1 行的 context bar 從 `context_window.used_percentage` 改為「auto-compact %」（used 對 auto-compact 門檻換算，100%＝compact 將至），並加 `compact` 標籤。

**Architecture:** 新增純函式模組 `src/compact.mjs`（門檻解析 + 換算）；`renderLine1` 把 bar 餵 `autoCompactPct(used)`；進入點 `statusline.mjs` 解析一次門檻塞進 deps。`gradientBar` 不變。

**Tech Stack:** Node.js ESM（`.mjs`）、Vitest（dev-only）。

## Global Constraints

逐字照搬自 spec，每個 task 隱含包含：

- **永不崩潰**：不動 `statusline.mjs` 的 try/catch/`exit 0` 結構（只在 deps 物件多加一個欄位）。
- **門檻 T**：`autoCompactThreshold(env)` → env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 為有效數（>0 且 ≤100）用它，否則 `DEFAULT_AUTOCOMPACT_PCT = 95`。
- **換算**：`autoCompactPct(used, threshold)` → `used` 為 `null`/非有限 → `null`；否則 `used/threshold*100` 夾 0–100。
- **永不隱藏（沿用 1.2.0）**：`used` 缺 → bar 顯示 `n/a`；真實 `0` → `0%`（非 n/a）。
- **顏色**：沿用 `gradientBar` 綠→紅位置漸層，不改 `color.mjs`。
- **路徑安全 / 純函式 / 繁中產出物 / TDD 先紅後綠 / commit 明確列檔**（沿用專案慣例）。
- **改對外行為 → bump `leon-statusline/.claude-plugin/plugin.json` version：1.3.0 → 1.4.0**（Task 3）。
- 測試指令在 `leon-statusline/` 下執行。

---

## File Structure

- `leon-statusline/src/compact.mjs` — **新檔**：`DEFAULT_AUTOCOMPACT_PCT`、`autoCompactThreshold(env)`、`autoCompactPct(used, threshold)`。
- `leon-statusline/tests/compact.test.mjs` — **新檔**：上述純函式單測。
- `leon-statusline/src/render.mjs` — `renderLine1` 的 bar 元素改用 `autoCompactPct` + `compact` 標籤。
- `leon-statusline/statusline.mjs` — deps 加 `autoCompactThreshold`。
- `leon-statusline/tests/render.test.mjs` — `renderLine1` 加「換算 + 標籤」斷言。
- `leon-statusline/.claude-plugin/plugin.json`、`leon-statusline/CODE_MAP.md`、`resources/statusline-attributes.md`、`resources/development-journal.md` — 版本與文件。

---

## Task 1: `src/compact.mjs`（門檻 + 換算純函式）

**Files:**
- Create: `leon-statusline/src/compact.mjs`
- Create: `leon-statusline/tests/compact.test.mjs`

**Interfaces:**
- Produces:
  - `DEFAULT_AUTOCOMPACT_PCT` = `95`。
  - `autoCompactThreshold(env = process.env)` → number（env override 有效則用，否則 95）。
  - `autoCompactPct(usedPercentage, threshold = autoCompactThreshold())` → number 0–100 或 `null`（used 為 null/非有限時）。

- [ ] **Step 1: 寫測試（先紅）**

建立 `leon-statusline/tests/compact.test.mjs`：

```js
import { describe, it, expect } from 'vitest'
import { autoCompactThreshold, autoCompactPct, DEFAULT_AUTOCOMPACT_PCT } from '../src/compact.mjs'

describe('autoCompactThreshold', () => {
  it('uses env override when valid', () => {
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '80' })).toBe(80)
  })
  it('falls back to 95 for invalid / out-of-range / unset', () => {
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '0' })).toBe(95)
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '150' })).toBe(95)
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: 'abc' })).toBe(95)
    expect(autoCompactThreshold({})).toBe(95)
    expect(DEFAULT_AUTOCOMPACT_PCT).toBe(95)
  })
})

describe('autoCompactPct', () => {
  it('null / non-finite used -> null', () => {
    expect(autoCompactPct(null, 95)).toBe(null)
    expect(autoCompactPct(undefined, 95)).toBe(null)
  })
  it('scales used to threshold', () => {
    expect(autoCompactPct(47.5, 95)).toBe(50)
    expect(autoCompactPct(0, 95)).toBe(0)
  })
  it('caps at 100 when used >= threshold', () => {
    expect(autoCompactPct(95, 95)).toBe(100)
    expect(autoCompactPct(120, 95)).toBe(100)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run tests/compact.test.mjs`
Expected: FAIL（`../src/compact.mjs` 不存在）。

- [ ] **Step 3: 建立實作**

建立 `leon-statusline/src/compact.mjs`：

```js
export const DEFAULT_AUTOCOMPACT_PCT = 95

// auto-compact 門檻（%）：env CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE 為有效數則用，否則預設
export function autoCompactThreshold(env = process.env) {
  const raw = Number(env.CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE)
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_AUTOCOMPACT_PCT
}

// 把 context 已用 % 換算成 auto-compact %（used 對門檻），夾 0–100；used 缺 → null
export function autoCompactPct(usedPercentage, threshold = autoCompactThreshold()) {
  if (usedPercentage == null || !Number.isFinite(usedPercentage)) return null
  return Math.max(0, Math.min(100, (usedPercentage / threshold) * 100))
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/compact.test.mjs`
Expected: PASS（8 個斷言全綠）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/compact.mjs leon-statusline/tests/compact.test.mjs
git commit -m "feat(compact): autoCompactThreshold + autoCompactPct 純函式

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: renderLine1 bar 改 auto-compact % + 進入點門檻

**Files:**
- Modify: `leon-statusline/src/render.mjs`（import + `renderLine1` 的 bar 那行）
- Modify: `leon-statusline/statusline.mjs`（import + deps）
- Test: `leon-statusline/tests/render.test.mjs`（`renderLine1` describe 加 1 個測試）

**Interfaces:**
- Consumes: `autoCompactPct`（Task 1）、`autoCompactThreshold`（Task 1）、`gradientBar`/`colorize`/`DIM`（既有）、`deps.autoCompactThreshold`。

- [ ] **Step 1: 加測試（先紅）**

在 `leon-statusline/tests/render.test.mjs` 的 `describe('renderLine1 (never hide)', ...)` 區塊內（`真 0 token & pct` 那個 `it` 之後）插入：

```js
  it('bar 顯示 auto-compact %（used 對門檻換算）+ compact 標籤', () => {
    const d = { context_window: { used_percentage: 47.5 } }
    const out = strip(renderLine1(d, { ...deps, autoCompactThreshold: 95 }))
    expect(out).toContain('compact')
    expect(out).toContain('50%')   // 47.5 / 95 * 100 = 50
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run tests/render.test.mjs`
Expected: FAIL（舊 bar 顯示 `48%`（`Math.round(47.5)`）且無 `compact` 標籤）。

- [ ] **Step 3: 改實作**

(a) `leon-statusline/src/render.mjs` 第 2 行 import 之後（或併入既有 import 區）加：

```js
import { autoCompactPct } from './compact.mjs'
```

把 `renderLine1` 裡這行：

```js
    gradientBar(cw.used_percentage),
```

換成：

```js
    colorize('compact', DIM) + ' ' + gradientBar(autoCompactPct(cw.used_percentage, deps.autoCompactThreshold)),
```

(b) `leon-statusline/statusline.mjs`：在現有 import 區加：

```js
import { autoCompactThreshold } from './src/compact.mjs'
```

把 deps 物件：

```js
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
    }
```

換成（多一個欄位）：

```js
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
      autoCompactThreshold: autoCompactThreshold(),
    }
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/render.test.mjs`
Expected: PASS（新測試綠；既有 renderLine1 測試仍綠——空 d → bar `n/a`、真 0 → `0%` 不受影響）。

- [ ] **Step 5: 全套 + 進入點 smoke**

Run：`npx vitest run`
Expected: PASS（含 integration 子程序 smoke：餵 `/tmp/x` 無 context_window → bar `compact … n/a`、仍 4 行 exit 0）。

再做視覺 smoke（確認 bar 換算正確）：

```bash
printf '%s' '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":47.5}}' | node "C:/Users/LIN HONG/Desktop/leon-statusline/leon-statusline/statusline.mjs" | cat -v | head -1
```

Expected: 第 1 行含 `compact`、bar 後為 ` 50%`（門檻取真實 env，無 override → 95；若你環境有設 override 則依該值）。

- [ ] **Step 6: Commit**

```bash
git add leon-statusline/src/render.mjs leon-statusline/statusline.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(render): 第1行 bar 改 auto-compact %（compact 標籤 + 門檻換算）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: bump 1.4.0 + 更新文件

**Files:**
- Modify: `leon-statusline/.claude-plugin/plugin.json:5`（version）
- Modify: `resources/statusline-attributes.md`（版面總覽 bar + context bar 那列）
- Modify: `leon-statusline/CODE_MAP.md`（src 區塊加 compact.mjs）
- Modify: `resources/development-journal.md`（版本沿革加 1.4.0 列）

- [ ] **Step 1: bump version**

`leon-statusline/.claude-plugin/plugin.json` 第 5 行：

```json
  "version": "1.4.0",
```

- [ ] **Step 2: 更新 statusline-attributes.md**

(a) 版面總覽第 1 行的 bar：把

```
~/…/Project_01  Opus effort:high think:on  token:15.5k  ██████████░░░░░░░░░░ 42%  session:my-session
```

換成

```
~/…/Project_01  Opus effort:high think:on  token:15.5k  compact ██████████░░░░░░░░░░ 42%  session:my-session
```

(b) 「第 1 行」表格的 context bar 那列：把

```
| context bar | `context_window.used_percentage` | 20 格 `█/░` + ` NN%`，綠→黃→紅平滑漸層 | 有才顯示 |
```

換成

```
| context bar（auto-compact %）| `context_window.used_percentage` | `compact` + 20 格 `█/░` + ` NN%`；NN = used ÷ 門檻 × 100，綠→紅；門檻取 env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`，否則預設 95%（**近似**：CC 未公開門檻、`autoCompactWindow` 假設＝`context_window_size`）| 永遠（永不隱藏）|
```

- [ ] **Step 3: 更新 CODE_MAP.md**

在 `leon-statusline/CODE_MAP.md` 的 `color.mjs` 那行：

```markdown
- `color.mjs` — `colorize` / `gradientColor` / `gradientBar`（truecolor 平滑漸層）
```

之後加一行：

```markdown
- `compact.mjs` — `autoCompactThreshold`（env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 否則 95）/ `autoCompactPct`（used 對門檻換算，給第 1 行 bar）
```

- [ ] **Step 4: 更新 development-journal.md 版本沿革**

在 `resources/development-journal.md` 版本沿革表的 `| 1.3.0 | …` 那列**之後**加一列：

```markdown
| 1.4.0 | 第 1 行 context bar 改為 auto-compact %（used 對門檻換算，compact 標籤；門檻 env override 否則 95%）|
```

- [ ] **Step 5: 全套測試確認沒壞**

Run（於 `leon-statusline/`）：`npx vitest run`
Expected: PASS（文件/版本變更不影響測試）。

- [ ] **Step 6: Commit**

```bash
git add leon-statusline/.claude-plugin/plugin.json resources/statusline-attributes.md leon-statusline/CODE_MAP.md resources/development-journal.md
git commit -m "chore: bump 1.4.0 + 文件記 auto-compact bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（已執行）

- **Spec coverage**：compact.mjs（T1）、renderLine1 bar + 進入點 deps（T2）、版本+文件（T3）。spec 每節都有對應 task。✓
- **Placeholder scan**：無 TBD/TODO；每個 code step 都有完整程式碼與預期輸出。✓
- **Type consistency**：`autoCompactThreshold(env)` / `autoCompactPct(used, threshold)` / `DEFAULT_AUTOCOMPACT_PCT` 在 T1 定義、T2（render + deps）沿用同名；`deps.autoCompactThreshold` 在 T2 兩處（render 用、entry 設）一致。✓
- **既有測試不破**：renderLine1 空 d → `n/a`、真 0 → `0%` 在新 bar 下仍成立（autoCompactPct(undefined)=null、autoCompactPct(0)=0）。✓
