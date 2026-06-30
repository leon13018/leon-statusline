# 設計：`/leon-statusline:resync-statusline` 手動重指指令

- 日期：2026-06-30
- 狀態：設計定稿，待實作
- 影響版本：`leon-statusline/.claude-plugin/plugin.json` 1.2.0 → **1.3.0**（新指令＝新功能）

## 1. 背景與目標

「重指 statusLine 路徑」（把 settings.json 的 statusLine 指到目前安裝版本）目前只有兩個觸發點：**SessionStart hook 自動跑** `setup.mjs --sync`，或手動下 node 指令（要自帶版號路徑）。

新增一個**使用者可手動觸發**的指令 `/leon-statusline:resync-statusline`，等同 hook 做的事（`applySync`），但**會回報逐 scope 結果**，用於「剛裝好新版、不想等下次開 session」的情境。

職責分工（明確、不重疊）：
- **`setup-statusline`**（既有）＝ **安裝/覆寫**（`applySetup`，偵測既有→問→`--force` 覆寫）。
- **`resync-statusline`**（新）＝ **只重指既有的「本 plugin」statusLine**（`applySync`，不問、冪等、只動我們的）。若沒有「我們的」statusLine → **不安裝**，只提示去跑 `setup-statusline`。

## 2. 範圍

- 改 `leon-statusline/setup.mjs`：充實 `applySync` 回傳；CLI 加 `--report`。
- 新增 `leon-statusline/skills/resync-statusline/SKILL.md`。
- **不動**：`hooks/hooks.json`（hook 仍用靜默 `--sync`）、`statusline.mjs`、`src/*`、`applySetup`、`setup-statusline` skill。
- bump `plugin.json` version → `1.3.0`；更新 `leon-statusline/CODE_MAP.md`。

## 3. 行為規格

### 3.1 `applySync` 回傳（充實 `status`）

現況：三種「沒動」情況都回 `{updated:false}`，分不出原因。改為回明確 `status`：

| 情況 | 回傳 |
|---|---|
| settings 檔讀不到 / 不能 parse | `{ updated:false, status:'absent' }` |
| 有檔，但 statusLine 不是我們的（含沒有 statusLine） | `{ updated:false, status:'foreign' }` |
| 是我們的、已指目前版本 | `{ updated:false, status:'current' }` |
| 是我們的、過時 → 已重指 | `{ updated:true, status:'repointed', from, to, backup }` |

- 判定「是我們的」沿用既有 `isOurs(cur)`（命令含 `statusline.mjs` 且含 `leon-statusline`）。
- 寫入前沿用既有行為：先 `copyFileSync` 備份 `<file>.bak-<stamp>`，再寫。
- **向後相容**：hook 忽略回傳值，只是多了欄位 → 不影響 hook。

### 3.2 CLI：`--sync` 維持靜默；`--sync --report` 印 JSON

- `node setup.mjs --sync --root <R>`（**維持靜默**）→ SessionStart hook 照舊用，**逐 scope 重指、不印任何 stdout**。行為與現況完全相同。
- `node setup.mjs --sync --report --root <R>` → 逐 scope（`user`/`project`/`local`）收集 `applySync` 結果，最後 `process.stdout.write(JSON.stringify(results))`，其中
  `results = [{ scope, ...applySyncResult }, …]`（長度 3）。
- 非 `--sync`（即 `--scope`）路徑不變（`applySetup`）。

### 3.3 新 skill `skills/resync-statusline/SKILL.md`

- frontmatter：`disable-model-invocation: true`（只有人手動叫，與 `setup-statusline` 一致）。
- 步驟：
  1. 執行 `node "${CLAUDE_PLUGIN_ROOT}/setup.mjs" --sync --report --root "${CLAUDE_PLUGIN_ROOT}"`。
  2. 解析輸出 JSON 陣列，逐 scope 回報：
     - `repointed` → 「<scope>：重指 <from> → <to>（舊設定已備份 <backup>）」
     - `current` → 「<scope>：已是最新，未變動」
     - `foreign` → 「<scope>：偵測到非本 plugin 的 statusLine（或沒有），未動」
     - `absent` → 「<scope>：無 settings 檔，略過」
  3. 若三個 scope 都沒有 `repointed`/`current`（全 foreign/absent）→ 提示「尚未安裝本 plugin 的 statusLine，請先跑 `/leon-statusline:setup-statusline`」。

## 4. 不變式 / 邊界

- `applySync` 仍**只動「我們的」且過時的** statusLine；`foreign` 一律不碰（不會誤覆寫使用者其他 statusLine）。
- 寫入前一律備份（沿用既有）。
- `--report` 只是「印出 results」，不改變重指邏輯；`--sync`（無 report）與現況位元級等價。
- 純函式 `applySync` 可單測（temp 檔）。

## 5. 測試（TDD，先紅後綠）

`leon-statusline/tests/setup.test.mjs` 補/改：
- `applySync` 四種 status（用 temp settings 檔）：
  - `absent`：指向不存在的檔 → `{updated:false, status:'absent'}`。
  - `foreign`：temp 檔的 statusLine 命令不含 `leon-statusline`/`statusline.mjs`（或無 statusLine）→ `status:'foreign'`、原檔不變。
  - `current`：temp 檔 statusLine 已等於 desired → `status:'current'`、原檔不變、**不產生備份**。
  - `repointed`：temp 檔 statusLine 是「我們的」舊路徑 → `status:'repointed'`、`from`/`to` 正確、檔案已改、備份存在。
- 既有 `applySync` 測試的斷言若假設舊回傳形狀 → 一併更新為新 `status` 形狀。
- **CLI `--sync --report` 不做自動化測試**：它依賴真實 `targetPath`（家目錄/cwd 的 settings），自動測會動到真實設定。其邏輯＝「迴圈呼叫 `applySync` + `JSON.stringify`」很薄，由 `applySync` 單測涵蓋核心、CLI 由 skill 實機驗證。
- 全套 `npx vitest run` 全綠才逐 task commit。

## 6. 版本與文件

- `leon-statusline/.claude-plugin/plugin.json`：`1.2.0` → `1.3.0`。
- `leon-statusline/CODE_MAP.md`：skills 區塊加一行 `resync-statusline`（手動重指、`applySync`、`--report`）。
- （可選）`resources/development-journal.md`：版本沿革加 1.3.0 列。
