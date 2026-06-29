# 狀態列「永不隱藏」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 4 行狀態列所有元素永不隱藏——讀到值（含真實 0）顯示真值並維持原色，沒抓到則顯示 `n/a`（數值類）/`none`（名稱類）並以 DIM 灰呈現。

**Architecture:** 改動集中在 `src/render.mjs`（四個 render 函式的「讀到/沒抓到」分支）與 `src/color.mjs`（`gradientBar` 處理 null）。新增一個 render 模組內的 `field` 私有 helper 統一「讀到→原色／沒抓到→DIM 佔位」邏輯。`attr`、`joinLine`、`buildOutput` 行為不變。

**Tech Stack:** Node.js ESM（`.mjs`）、Vitest（dev-only）。

## Global Constraints

逐字照搬自 spec，每個 task 隱含包含：

- **永不崩潰**：所有改動仍處於 `statusline.mjs` 的 try/catch 內；不改進入點、不改 `exit 0` 行為。本計畫不碰 `statusline.mjs`/`setup.mjs`/`hooks/`/`cache`/`git`/`count`/`input`。
- **DIM = `[130, 130, 130]`**，ANSI 序列 `\x1b[38;2;130;130;130m`。**DIM 灰專指「沒抓到」**；讀到的真值（含真 0）維持元素原色。
- **判定「讀到」一律以 `欄位 != null` 為準**（巢狀用 optional chaining）。
- **名稱類缺席 → `none`**：model、session、repo、worktree、PR、git（不在 repo）。**數值類缺席 → `n/a`**：目錄、effort、token、context bar、api、wall、cost、5h、7d。
- **無「缺席」態**：`think`（永遠 `on`/`off`）、第 4 行 8 個計數（0 即真 0，不變）。
- **git 內部維持原樣**：在 repo 無變動 → `git:main clean`（綠）；ahead/behind 為 0 省略；僅不在 repo → `git:none`（DIM）。
- TDD：先紅後綠、逐 task `npx vitest run` 全綠才 commit。產出物（commit message/註解）用繁體中文。
- commit 一律**明確列檔名**（不可 `git add -A`／`-A`，開發機 hook 會擋）。
- 改對外行為 → **bump `leon-statusline/.claude-plugin/plugin.json` 的 `version`：1.1.1 → 1.2.0**（Task 6）。

> 測試指令一律在 `leon-statusline/` 目錄下執行（package.json / vitest.config 在此）。

---

## File Structure

- `leon-statusline/src/color.mjs` — 改 `gradientBar`：`pct == null` → 空 bar + `n/a`；數值（含 0）→ bar + `NN%`。
- `leon-statusline/src/render.mjs` — 新增 `field` 私有 helper；改寫 `renderLine1`/`renderLine2`/`renderLine3`。`renderLine4`/`buildOutput` 不變。
- `leon-statusline/tests/color.test.mjs` — 改 null 測試、加真 0 測試。
- `leon-statusline/tests/render.test.mjs` — 加 `renderLine1` 測試；改 `renderLine2`/`renderLine3` 為佔位斷言；加真 0 / 不在 repo / DIM 色斷言；強化 `buildOutput`。
- `leon-statusline/tests/integration.test.mjs` — valid input 斷言輸出恰 4 行。
- `leon-statusline/.claude-plugin/plugin.json` — version bump。
- `resources/statusline-attributes.md` — 改寫「條件顯示規則」段。
- `resources/development-journal.md` — 版本沿革加 1.2.0 列。

---

## Task 1: gradientBar 區分 null（n/a）與真實 0（0%）

**Files:**
- Modify: `leon-statusline/src/color.mjs:16-30`（`gradientBar`）
- Test: `leon-statusline/tests/color.test.mjs:19-22`（改 null 測試、加真 0 測試）

**Interfaces:**
- Produces: `gradientBar(pct, width=20)` → string。`pct == null`/非有限 → `'░'×width + ' n/a'`；數值（含 `0`）→ 漸層 bar + ` ${round(pct)}%`（pct 夾在 0–100）。

- [ ] **Step 1: 改測試（先紅）**

把 `leon-statusline/tests/color.test.mjs` 的這段：

```js
  it('returns empty for null pct', () => {
    expect(gradientBar(null)).toBe('')
  })
```

換成：

```js
  it('null pct -> empty bar + n/a (沒抓到)', () => {
    const out = strip(gradientBar(null, 10))
    expect(out).toBe('░░░░░░░░░░ n/a')
    expect(out).not.toContain('█')
  })
  it('real 0 pct -> empty bar + 0% (讀到真 0，非 n/a)', () => {
    expect(strip(gradientBar(0, 10))).toBe('░░░░░░░░░░ 0%')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run（於 `leon-statusline/`）：`npx vitest run tests/color.test.mjs`
Expected: FAIL（`gradientBar(null)` 目前回 `''`，新斷言不符）。

- [ ] **Step 3: 改實作**

把 `leon-statusline/src/color.mjs` 的 `gradientBar` 整個函式換成：

```js
export function gradientBar(pct, width = 20) {
  const known = pct != null && Number.isFinite(pct)
  const p = known ? Math.max(0, Math.min(100, pct)) : 0
  const filled = Math.round((p / 100) * width)
  let bar = ''
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const t = width > 1 ? i / (width - 1) : 0
      bar += colorize('█', gradientColor(t))
    } else {
      bar += colorize('░', [60, 60, 60])
    }
  }
  return `${bar} ${known ? `${Math.round(p)}%` : 'n/a'}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/color.test.mjs`
Expected: PASS（含既有 50/150 測試仍綠）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/color.mjs leon-statusline/tests/color.test.mjs
git commit -m "feat(color): gradientBar 區分 null(n/a) 與真實 0(0%)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 新增 `field` helper + renderLine1 永不隱藏

**Files:**
- Modify: `leon-statusline/src/render.mjs:7`（在 `tierColor` 後加 `field` helper）、`:9-23`（改寫 `renderLine1`）
- Test: `leon-statusline/tests/render.test.mjs:2`（import 加 `renderLine1`）、新增 `renderLine1` describe

**Interfaces:**
- Produces（render.mjs 模組私有）：`field(label, value, color, placeholder)` → string。`value == null || value === ''` → `colorize(label+placeholder, DIM)`；否則 `colorize(label+value, color)`。
- Consumes: `gradientBar`（Task 1，null→n/a）、`colorize`、`shortPath`、`joinLine`、模組常數 `BLUE/MAGENTA/DIM`。

- [ ] **Step 1: 加測試（先紅）**

`leon-statusline/tests/render.test.mjs` 第 2 行 import 改為：

```js
import { renderLine1, renderLine2, renderLine3, renderLine4, buildOutput } from '../src/render.mjs'
```

在檔案 `describe('renderLine2 ...` **之前**插入：

```js
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
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run tests/render.test.mjs`
Expected: FAIL（`renderLine1` 未 export／舊 renderLine1 仍隱藏 → 斷言不符）。

- [ ] **Step 3: 改實作**

在 `leon-statusline/src/render.mjs` 的 `const tierColor = ...` 那行**之後**加入 helper：

```js
// 永不隱藏：讀到值（非 null/空）→ label+value 上 color；沒抓到 → label+placeholder 上 DIM
const field = (label, value, color, placeholder) =>
  (value == null || value === '')
    ? colorize(`${label}${placeholder}`, DIM)
    : colorize(`${label}${value}`, color)
```

把 `renderLine1` 整個函式換成：

```js
export function renderLine1(d, deps) {
  const cw = d.context_window || {}
  const dir = d.workspace?.current_dir
  const tok = cw.total_input_tokens
  const parts = [
    field('', dir ? shortPath(dir, deps.home) : null, BLUE, 'n/a'),
    field('', d.model?.display_name, MAGENTA, 'none'),
    field('effort:', d.effort?.level, DIM, 'n/a'),
    colorize('think:' + (d.thinking?.enabled ? 'on' : 'off'), DIM),
    field('token:', tok != null ? `${(tok / 1000).toFixed(1)}k` : null, DIM, 'n/a'),
    gradientBar(cw.used_percentage),
    field('session:', d.session_name, DIM, 'none'),
  ]
  return joinLine(parts)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/render.test.mjs`
Expected: PASS（`renderLine1` 兩個新測試綠；既有 renderLine2/3/4/buildOutput 此時可能仍綠或在後續 task 調整）。

> 註：本 task 只動 renderLine1 與 helper，不應使既有 renderLine2/3 測試變紅。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/render.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(render): 加 field helper + renderLine1 永不隱藏

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: renderLine2 永不隱藏

**Files:**
- Modify: `leon-statusline/src/render.mjs:25-46`（`renderLine2`）
- Test: `leon-statusline/tests/render.test.mjs`（改寫 `renderLine2` describe）

**Interfaces:**
- Consumes: `field`（Task 2）、`colorize`、`DIM/GREEN/YELLOW`、`deps.git(cwd)`（回 git 物件或 `null`）。

- [ ] **Step 1: 改測試（先紅）**

把 `leon-statusline/tests/render.test.mjs` 的整個 `describe('renderLine2 (conditional)', ...)` 區塊換成：

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run tests/render.test.mjs`
Expected: FAIL（舊 renderLine2 隱藏 repo/PR、不在 repo 時不印 git）。

- [ ] **Step 3: 改實作**

把 `leon-statusline/src/render.mjs` 的 `renderLine2` 整個函式換成：

```js
export function renderLine2(d, deps) {
  const g = deps.git(d.workspace?.current_dir)
  let gitPart
  if (g) {
    const status = (g.staged || g.modified) ? `+${g.staged} ~${g.modified}` : 'clean'
    const ab = `${g.ahead ? `↑${g.ahead}` : ''}${g.behind ? `↓${g.behind}` : ''}`
    const gitStr = [g.branch, status, ab].filter(Boolean).join(' ')
    gitPart = colorize('git:' + gitStr, (g.staged || g.modified) ? YELLOW : GREEN)
  } else {
    gitPart = colorize('git:none', DIM)
  }
  const c = d.cost || {}
  const linesPart = (c.total_lines_added != null || c.total_lines_removed != null)
    ? colorize(`+${c.total_lines_added || 0} -${c.total_lines_removed || 0}`, DIM)
    : colorize('n/a', DIM)
  const pr = d.pr ? `#${d.pr.number} ${d.pr.review_state || ''}`.trim() : null
  const parts = [
    field('repo:', d.workspace?.repo?.name, DIM, 'none'),
    field('worktree:', d.workspace?.git_worktree, DIM, 'none'),
    gitPart,
    linesPart,
    field('PR:', pr, YELLOW, 'none'),
  ]
  return joinLine(parts)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/render.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/render.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(render): renderLine2 永不隱藏（repo/worktree/PR/git/增刪行）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: renderLine3 永不隱藏

**Files:**
- Modify: `leon-statusline/src/render.mjs:48-66`（`renderLine3`）
- Test: `leon-statusline/tests/render.test.mjs`（改寫 `renderLine3` describe）

**Interfaces:**
- Consumes: `field`（Task 2）、`colorize`、`fmtDuration`、`resetCountdown`、`tierColor`、`DIM/YELLOW`、`deps.now()`。

- [ ] **Step 1: 改測試（先紅）**

把 `leon-statusline/tests/render.test.mjs` 的整個 `describe('renderLine3', ...)` 區塊換成：

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`npx vitest run tests/render.test.mjs`
Expected: FAIL（舊 renderLine3 在 rate 缺席時隱藏，不印 `5h:n/a`）。

- [ ] **Step 3: 改實作**

把 `leon-statusline/src/render.mjs` 的 `renderLine3` 整個函式換成：

```js
export function renderLine3(d, deps) {
  const c = d.cost || {}
  const rl = d.rate_limits || {}
  const now = deps.now()
  const rlPart = (label, obj) => {
    if (!obj || obj.used_percentage == null) return colorize(`${label}n/a`, DIM)
    const cd = obj.resets_at ? resetCountdown(obj.resets_at, now) : ''
    const val = `${Math.round(obj.used_percentage)}%${cd ? `(reset ${cd})` : ''}`
    return colorize(`${label}${val}`, tierColor(obj.used_percentage))
  }
  const parts = [
    field('api:', c.total_api_duration_ms != null ? fmtDuration(c.total_api_duration_ms) : null, DIM, 'n/a'),
    field('wall:', c.total_duration_ms != null ? fmtDuration(c.total_duration_ms) : null, DIM, 'n/a'),
    field('cost:', c.total_cost_usd != null ? `$${c.total_cost_usd.toFixed(2)}` : null, YELLOW, 'n/a'),
    rlPart('5h:', rl.five_hour),
    rlPart('7d:', rl.seven_day),
  ]
  return joinLine(parts)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/render.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/render.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(render): renderLine3 永不隱藏（api/wall/cost/5h/7d）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 端到端「4 行永不隱藏」回歸測試

**Files:**
- Test: `leon-statusline/tests/render.test.mjs`（強化 `buildOutput` describe）、`leon-statusline/tests/integration.test.mjs:10-14`（valid input 斷言 4 行）

**Interfaces:**
- Consumes: `buildOutput`（不改實作）、`statusline.mjs` 進入點（不改）。

> `buildOutput` 與進入點實作不變；本 task 只加回歸測試，鎖住「元素全缺時仍輸出完整 4 行」。

- [ ] **Step 1: 改測試（先紅／或直接綠—先確認）**

把 `leon-statusline/tests/render.test.mjs` 的整個 `describe('buildOutput', ...)` 區塊換成：

```js
describe('buildOutput', () => {
  it('renders 4 non-empty lines', () => {
    const out = buildOutput({ model: { display_name: 'Opus' }, workspace: { current_dir: '/home/leon/p' } }, deps)
    const lines = strip(out).split('\n')
    expect(lines.length).toBe(4)
    expect(lines.every(l => l.length > 0)).toBe(true)
  })
  it('empty d 仍輸出完整 4 行（never hide）', () => {
    const lines = strip(buildOutput({}, deps)).split('\n')
    expect(lines.length).toBe(4)
    expect(lines.every(l => l.length > 0)).toBe(true)
  })
})
```

把 `leon-statusline/tests/integration.test.mjs` 的 `it('valid input -> exit 0, non-empty', ...)` 換成：

```js
  it('valid input -> exit 0, 4 lines', () => {
    const r = run(JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/tmp/x' } }))
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
    expect(r.stdout.split('\n').length).toBe(4)
  })
```

- [ ] **Step 2: 跑測試**

Run：`npx vitest run tests/render.test.mjs tests/integration.test.mjs`
Expected: PASS（Task 2-4 完成後 buildOutput 對空 d 已能輸出 4 行；integration 以真實機器 deps 跑，`/tmp/x` 非 repo → `git:none`、counts 全 0 → 第 4 行仍在 → 恰 4 行）。
若 FAIL：表示前面某 render 仍隱藏 → 回去修對應 task，不要在此放寬斷言。

- [ ] **Step 3: 跑全套確認全綠**

Run：`npx vitest run`
Expected: PASS（全部測試綠；確認沒有遺漏的舊「隱藏」斷言）。

- [ ] **Step 4: Commit**

```bash
git add leon-statusline/tests/render.test.mjs leon-statusline/tests/integration.test.mjs
git commit -m "test: 鎖住 4 行永不隱藏（buildOutput + 進入點）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: bump version + 更新文件

**Files:**
- Modify: `leon-statusline/.claude-plugin/plugin.json:5`（`version`）
- Modify: `resources/statusline-attributes.md:17-21`（條件顯示規則段）
- Modify: `resources/development-journal.md`（版本沿革表加 1.2.0 列）

**Interfaces:** 無（純設定／文件）。

- [ ] **Step 1: bump version**

`leon-statusline/.claude-plugin/plugin.json` 第 5 行：

```json
  "version": "1.2.0",
```

- [ ] **Step 2: 更新 statusline-attributes.md**

把 `resources/statusline-attributes.md` 的整個 `## 條件顯示規則` 段（含 3 條 bullet）換成：

```markdown
## 顯示規則（永不隱藏）
- 每個 attribute **連同其標題**永遠顯示，從不隱藏；整行也永遠存在（共 4 行）。
- **讀到值（包含真實的 `0`）** → 顯示真值（如 `token:0.0k`、`cost:$0.00`、`5h:0%`、`git:main clean`、`+0 -0`），維持元素原色。
- **沒抓到 / 不適用** → 名稱類顯示 `none`（model/session/repo/worktree/PR/git 不在 repo），數值類顯示 `n/a`（目錄/effort/token/context bar/api/wall/cost/5h/7d），且一律 **DIM 灰**——灰色專指「沒資料」，與真實 0 用文字＋顏色雙重區分。
- 例外：`think` 永遠 `on`/`off`；第 4 行計數 0 即「真的數到 0」。
```

- [ ] **Step 3: 更新 development-journal.md 版本沿革**

在 `resources/development-journal.md` 的版本沿革表（`| 1.1.1 | ... |` 那列之後）加一列：

```markdown
| 1.2.0 | 狀態列永不隱藏：讀到→真值（含真 0）原色，沒抓到→n/a/none 並 DIM |
```

- [ ] **Step 4: 跑全套確認全綠（防呆）**

Run（於 `leon-statusline/`）：`npx vitest run`
Expected: PASS（文件/版本變更不影響測試，確認仍全綠）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/.claude-plugin/plugin.json resources/statusline-attributes.md resources/development-journal.md
git commit -m "chore: bump 1.2.0 + 更新永不隱藏顯示規則文件

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（已執行）

- **Spec coverage**：對照表每列都有 task——bar/真0（T1）、line1 各元素（T2）、line2 repo/worktree/git/lines/PR（T3）、line3 api/wall/cost/5h/7d（T4）、4 行恆存（T5）、版本＋文件（T6）。✓
- **Placeholder scan**：無 TBD/TODO；每個 code step 都有完整程式碼與預期輸出。✓
- **Type consistency**：`field(label, value, color, placeholder)` 在 T2 定義、T3/T4 沿用相同簽章；`gradientBar` 回傳格式在 T1 定義、T2 line1 沿用；`deps.git` 回 `null` 的合約在 T3 測試使用。✓
- **DIM 一致**：`\x1b[38;2;130;130;130m` 在 T2-T4 測試斷言一致。✓
