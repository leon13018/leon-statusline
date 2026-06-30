# `/leon-statusline:resync-statusline` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增使用者可手動觸發的 `/leon-statusline:resync-statusline` 指令，把 settings.json 裡「本 plugin 的」 statusLine 重指到目前安裝版本，並逐 scope 回報結果。

**Architecture:** 重用既有 `applySync`（充實其回傳 `status`）；`setup.mjs` CLI 加 `--report` 讓 `--sync --report` 印 JSON（`--sync` 維持靜默給 hook 用）；新增一支 `disable-model-invocation` 的 SKILL.md 跑該指令並解析回報。

**Tech Stack:** Node.js ESM（`.mjs`）、Vitest（dev-only）、Claude Code plugin skill（markdown frontmatter）。

## Global Constraints

逐字照搬自 spec，每個 task 隱含包含：

- **不動 hook**：`hooks/hooks.json` 仍用靜默 `--sync`；`--sync`（無 `--report`）的行為與現況**位元級等價**。
- **只動「我們的」**：`applySync` 沿用 `isOurs(cur)` 判定，`foreign` 一律不碰、不誤覆寫使用者其他 statusLine；寫入前一律 `copyFileSync` 備份。
- **職責分工**：`setup-statusline`＝安裝/覆寫（`applySetup`）；`resync-statusline`＝只重指既有的「我們的」statusLine（`applySync`），不安裝。
- **路徑安全**：一律 `os.homedir()` + `path.join()`（沿用既有 `setup.mjs`）。
- **改對外行為 → bump `leon-statusline/.claude-plugin/plugin.json` version：1.2.0 → 1.3.0**（Task 4）。
- TDD：先紅後綠、逐 task `npx vitest run` 全綠才 commit。產出物（commit message/註解/skill）用繁體中文。
- commit 一律**明確列檔名**（不可 `git add -A`）。
- 測試指令在 `leon-statusline/` 目錄下執行。

---

## File Structure

- `leon-statusline/setup.mjs` — 改 `applySync`（回傳加 `status`/`from`/`to`）；CLI `--sync` 分支加 `--report`。
- `leon-statusline/tests/setup.test.mjs` — 加 `applySync` 的 `status` 斷言（既有 `.updated` 斷言不變、仍綠）。
- `leon-statusline/skills/resync-statusline/SKILL.md` — 新指令（create）。
- `leon-statusline/.claude-plugin/plugin.json` — version bump。
- `leon-statusline/CODE_MAP.md` — skills 區塊加一行、setup.mjs CLI 註記 `--report`。
- `resources/development-journal.md` — 版本沿革加 1.3.0 列。

---

## Task 1: `applySync` 回傳充實 `status`

**Files:**
- Modify: `leon-statusline/setup.mjs:34-43`（`applySync`）
- Test: `leon-statusline/tests/setup.test.mjs`（`applySync` describe 內新增 4 個 `it`）

**Interfaces:**
- Produces: `applySync(file, desiredCommand, stamp?)` → 物件。新增欄位 `status`：
  - `'absent'`（檔讀不到）、`'foreign'`（有檔但 statusLine 非我們的/無）、`'current'`（我們的、已最新）、`'repointed'`（我們的、過時→已重指，另含 `from`、`to`、`backup`）。
  - `updated` 欄位維持（`repointed`→`true`，其餘 `false`），既有呼叫端與測試不受影響。

- [ ] **Step 1: 加測試（先紅）**

在 `leon-statusline/tests/setup.test.mjs` 的 `describe('applySync', ...)` **區塊內最後**（第 96 行 `})` 之前）插入：

```js
  it('status repointed with from/to when ours and stale', () => {
    const f = join(dir, 'settings.json')
    const oldCmd = 'node "/p/leon-statusline/1.0.0/statusline.mjs"'
    writeFileSync(f, JSON.stringify({ statusLine: { type: 'command', command: oldCmd } }))
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    const r = applySync(f, desired)
    expect(r.status).toBe('repointed')
    expect(r.from).toBe(oldCmd)
    expect(r.to).toBe(desired)
  })
  it('status current when already pointing at desired', () => {
    const f = join(dir, 'settings.json')
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    writeFileSync(f, JSON.stringify({ statusLine: { command: desired } }))
    expect(applySync(f, desired).status).toBe('current')
  })
  it('status foreign when statusLine not ours', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ statusLine: { command: 'node "/home/me/custom.mjs"' } }))
    expect(applySync(f, 'node "/p/leon-statusline/1.1.0/statusline.mjs"').status).toBe('foreign')
  })
  it('status absent when file missing', () => {
    expect(applySync(join(dir, 'nope.json'), 'node x').status).toBe('absent')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run（於 `leon-statusline/`）：`npx vitest run tests/setup.test.mjs`
Expected: FAIL（4 個新測試的 `r.status` 為 `undefined`，不符 'repointed'/'current'/'foreign'/'absent'）。

- [ ] **Step 3: 改實作**

把 `leon-statusline/setup.mjs` 的 `applySync` 整個函式換成：

```js
// 升級後路徑改變時自動重指：僅當既有 statusLine 是「我們的」且過時才改寫（idempotent、寫前備份）
export function applySync(file, desiredCommand, stamp = String(Date.now())) {
  let j
  try { j = JSON.parse(readFileSync(file, 'utf8')) } catch { return { updated: false, status: 'absent' } }
  const cur = j.statusLine && j.statusLine.command
  if (!isOurs(cur)) return { updated: false, status: 'foreign' }
  if (cur === desiredCommand) return { updated: false, status: 'current' }
  const backup = `${file}.bak-${stamp}`
  copyFileSync(file, backup)
  j.statusLine = { ...j.statusLine, command: desiredCommand }
  writeFileSync(file, JSON.stringify(j, null, 2))
  return { updated: true, status: 'repointed', from: cur, to: desiredCommand, backup }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run：`npx vitest run tests/setup.test.mjs`
Expected: PASS（4 個新測試綠；既有 `applySync`/`applySetup`/其他測試仍綠——它們只斷言 `.updated`/`.backup`，未受影響）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/setup.mjs leon-statusline/tests/setup.test.mjs
git commit -m "feat(setup): applySync 回傳加 status(absent/foreign/current/repointed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CLI 加 `--report`（`--sync` 維持靜默）

**Files:**
- Modify: `leon-statusline/setup.mjs:50-54`（CLI 的 `--sync` 分支）

**Interfaces:**
- Consumes: `applySync`（Task 1，回傳含 `status`）、`targetPath`、`arg`。
- Produces（CLI 行為）：
  - `node setup.mjs --sync --root <R>` → **靜默**（逐 scope 重指、無 stdout）。
  - `node setup.mjs --sync --report --root <R>` → stdout 印 `JSON.stringify(results)`，`results = [{ scope, ...applySyncResult }]`（長度 3，scope 依序 user/project/local）。

> 本 task 不寫 vitest（CLI 依賴真實 `targetPath`，自動測會動到真實 settings）；核心邏輯已由 Task 1 的 `applySync` 單測涵蓋，CLI 為薄 glue，用「安全 manual smoke」驗證（見 Step 2）。

- [ ] **Step 1: 改實作**

把 `leon-statusline/setup.mjs` CLI 裡的這段：

```js
  if (process.argv.includes('--sync')) {
    // SessionStart hook 用：靜默（stdout 會被當成 session context 注入），跨 scope 自動重指
    for (const scope of ['user', 'project', 'local']) {
      try { applySync(targetPath(scope), command) } catch {}
    }
  } else {
```

換成：

```js
  if (process.argv.includes('--sync')) {
    // SessionStart hook 用：靜默（stdout 會被當成 session context 注入），跨 scope 自動重指
    // --report：給 resync-statusline skill 用，逐 scope 印出結果
    const report = process.argv.includes('--report')
    const results = []
    for (const scope of ['user', 'project', 'local']) {
      let r
      try { r = applySync(targetPath(scope), command) } catch { r = { updated: false, status: 'absent' } }
      results.push({ scope, ...r })
    }
    if (report) process.stdout.write(JSON.stringify(results))
  } else {
```

- [ ] **Step 2: 安全 manual smoke**

> ⚠️ `--root` **務必**用「目前真實安裝版本路徑」，這樣 user scope 會解析成 `current`（不寫入），smoke 才不會動到你真實的 statusLine。

Run（於任意空目錄，例如 scratchpad，避免 project/local 命中）：

```bash
cd "C:/Users/LINHON~1/AppData/Local/Temp/claude/C--Users-LIN-HONG-Desktop-leon-statusline/a84b3672-3e49-4117-99aa-a9fdc3b3c9e3/scratchpad" \
&& echo "--- 靜默(無 report)應無輸出 ---" \
&& node "C:/Users/LIN HONG/Desktop/leon-statusline/leon-statusline/setup.mjs" --sync --root "C:/Users/LIN HONG/.claude/plugins/cache/leon-statusline-marketplace/leon-statusline/1.2.0" \
&& echo "[靜默結束]" \
&& echo "--- --report 應印 JSON ---" \
&& node "C:/Users/LIN HONG/Desktop/leon-statusline/leon-statusline/setup.mjs" --sync --report --root "C:/Users/LIN HONG/.claude/plugins/cache/leon-statusline-marketplace/leon-statusline/1.2.0"
```

Expected:
- 第一段（無 `--report`）→ 兩個 echo 之間**沒有任何 JSON**（靜默）。
- 第二段（`--report`）→ 印出 JSON 陣列，含三個 scope；`user` 的 `status` 為 `"current"`（證明沒有寫入真實設定），`project`/`local` 為 `"absent"`。

若 `user` 顯示 `repointed`／或第一段印了東西 → 停止，回 Step 1 檢查（不要放寬）。

- [ ] **Step 3: 全套測試確認沒壞**

Run（於 `leon-statusline/`）：`npx vitest run`
Expected: PASS（全綠；CLI 改動不影響既有測試）。

- [ ] **Step 4: Commit**

```bash
git add leon-statusline/setup.mjs
git commit -m "feat(setup): CLI 加 --report（--sync --report 印逐 scope JSON；--sync 仍靜默）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 新 skill `resync-statusline/SKILL.md`

**Files:**
- Create: `leon-statusline/skills/resync-statusline/SKILL.md`

**Interfaces:**
- Consumes: `setup.mjs --sync --report`（Task 2，印出 `[{scope,status,from?,to?,backup?}]`）。

- [ ] **Step 1: 建立 SKILL.md**

建立 `leon-statusline/skills/resync-statusline/SKILL.md`，內容：

```markdown
---
description: 把 leon-statusline 的 statusLine 重指到目前安裝版本（只重指既有的「本 plugin」statusLine，不安裝）。使用者明確呼叫才執行。
disable-model-invocation: true
---

# leon-statusline resync

把 settings.json 裡「本 plugin 的」 statusLine 重指到目前載入版本（等同 SessionStart hook 做的事，手動觸發）。**不會安裝**新的 statusLine。

步驟：
1. 執行：`node "${CLAUDE_PLUGIN_ROOT}/setup.mjs" --sync --report --root "${CLAUDE_PLUGIN_ROOT}"`
2. 解析輸出的 JSON 陣列（每個 scope 一筆），逐 scope 回報：
   - `repointed` → 「<scope>：重指 `<from>` → `<to>`（舊設定已備份 `<backup>`）」
   - `current` → 「<scope>：已是最新，未變動」
   - `foreign` → 「<scope>：偵測到非本 plugin 的 statusLine（或沒有），未動」
   - `absent` → 「<scope>：無 settings 檔，略過」
3. 若三個 scope 都沒有 `repointed`/`current`（全為 `foreign`/`absent`）→ 提示：「尚未安裝本 plugin 的 statusLine，請先跑 `/leon-statusline:setup-statusline`。」
```

- [ ] **Step 2: 驗證指令可跑**

Run（於 `leon-statusline/`）：`npx vitest run`
Expected: PASS（新增 markdown 不影響測試；確認整包仍全綠）。

> 說明：skill 本身要 `/reload-plugins` 後才會被 Claude Code 載入；其驅動的指令已在 Task 2 Step 2 驗過可正常輸出 JSON。SKILL.md 為純指示文件，無單元測試。

- [ ] **Step 3: Commit**

```bash
git add leon-statusline/skills/resync-statusline/SKILL.md
git commit -m "feat(skill): 新增 /leon-statusline:resync-statusline 手動重指指令

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: bump 1.3.0 + 更新文件

**Files:**
- Modify: `leon-statusline/.claude-plugin/plugin.json:5`（version）
- Modify: `leon-statusline/CODE_MAP.md`（skills 區塊 + setup.mjs CLI 註記）
- Modify: `resources/development-journal.md`（版本沿革加 1.3.0 列）

- [ ] **Step 1: bump version**

`leon-statusline/.claude-plugin/plugin.json` 第 5 行：

```json
  "version": "1.3.0",
```

- [ ] **Step 2: 更新 CODE_MAP.md**

在 `leon-statusline/CODE_MAP.md` 的 `skills/setup-statusline/SKILL.md` 那行**之後**加一行：

```markdown
- `skills/resync-statusline/SKILL.md` — 指令 `/leon-statusline:resync-statusline`（手動重指：跑 `setup.mjs --sync --report`、逐 scope 回報；只動「我們的」statusLine）
```

並把同檔的這行：

```markdown
  - `isOurs` / `applySync`（`--sync` 升級後自動重指、idempotent、寫前備份）
  - CLI：`--scope` / `--force` / `--sync`
```

換成：

```markdown
  - `isOurs` / `applySync`（`--sync` 升級後自動重指、idempotent、寫前備份；回傳 `status`：absent/foreign/current/repointed）
  - CLI：`--scope` / `--force` / `--sync`（`--report` 逐 scope 印 JSON，給 resync skill 用）
```

- [ ] **Step 3: 更新 development-journal.md 版本沿革**

在 `resources/development-journal.md` 版本沿革表的 `| 1.2.0 | …` 那列**之後**加一列：

```markdown
| 1.3.0 | 新增 `/leon-statusline:resync-statusline` 手動重指指令（setup.mjs applySync 回傳 status + CLI --report）|
```

- [ ] **Step 4: 全套測試確認沒壞**

Run（於 `leon-statusline/`）：`npx vitest run`
Expected: PASS（文件/版本變更不影響測試）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/.claude-plugin/plugin.json leon-statusline/CODE_MAP.md resources/development-journal.md
git commit -m "chore: bump 1.3.0 + CODE_MAP/journal 記 resync 指令

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（已執行）

- **Spec coverage**：applySync status（T1）、CLI `--report` + `--sync` 維持靜默（T2）、新 skill（T3）、版本+CODE_MAP+journal（T4）。spec 每節都有對應 task。✓
- **Placeholder scan**：無 TBD/TODO；每個 code step 都有完整程式碼與預期輸出。✓
- **Type consistency**：`applySync` 回傳 `{updated, status, from?, to?, backup?}` 在 T1 定義、T2 CLI 與 T3 skill 沿用同名欄位；`status` 四值（absent/foreign/current/repointed）全程一致。✓
- **既有測試不破**：現有 `applySync` 測試只斷言 `.updated`/`.backup`，新回傳相容（T1 Step 4 已說明）。✓
