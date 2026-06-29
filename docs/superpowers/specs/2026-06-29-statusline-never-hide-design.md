# 設計：狀態列「永不隱藏」（讀到→真值/真 0；沒抓到→n/a/none + DIM）

- 日期：2026-06-29
- 狀態：設計定稿，待實作
- 影響版本：`leon-statusline/.claude-plugin/plugin.json` 1.1.1 → **1.2.0**（對外顯示行為變更）

## 1. 背景與目標

現況採「條件顯示」：元素的值缺席／拿不到時，**連標題一起隱藏**；某行所有元素全缺時，**整行消失**。

目標改為 **所有元素永不隱藏**，且嚴格區分兩種情況（**0 值不可與「沒抓到」混為一談**）：

- **讀到值（包含真實的 `0`）** → 顯示該值的自然表示（`token:0.0k`、`cost:$0.00`、`5h:0%`、`git:main clean`、`+0 -0`…），**維持元素原本顏色**。
- **沒抓到 / 不適用** → 顯示佔位字串並以 **DIM 灰**呈現：
  - **名稱類** → `none`：model、session、repo、worktree、PR、git（不在 repo）。
  - **數值類** → `n/a`：目錄、effort、token、context bar、api、wall、cost、5h、7d。

DIM 灰因此**專門代表「沒資料」**；真實 0 維持原色。兩者用**文字 + 顏色雙重區分**。

> 不影響的紅線：永不崩潰（一律 `exit 0`、至少印一行）、路徑安全、`${CLAUDE_PLUGIN_ROOT}` 不入 statusLine 命令、setup/hook 邏輯。

## 2. 範圍

- 主改 `src/render.mjs` 四個 render 函式的「讀到 / 沒抓到」分支。
- `src/color.mjs`：`gradientBar` 改為——`pct == null`（沒抓到）→ 回 `░×20 + ' n/a'`；`pct` 為數值（含真實 `0`）→ 維持 bar + ` NN%`。
- `src/format.mjs`：`attr` 行為不變（仍隱藏 `null`/`''`）；由呼叫端保證傳入非空字串並指定顏色。
- **不改**：`statusline.mjs`（進入點崩潰安全）、`setup.mjs`、`hooks/`、`cache`/`git`/`count`/`input`。
- bump `plugin.json` `version` → `1.2.0`；同步更新 `resources/statusline-attributes.md` 的「條件顯示規則」。

## 3. 行為規格：對照表

判定「讀到」一律以 `欄位 != null` 為準（巢狀用 optional chaining）。

| 行 | 元素 | 讀到值（含真實 0）→ 原色 | 沒抓到 → 佔位（DIM）|
|---|---|---|---|
| 1 | 目錄 | 縮短路徑（BLUE）| `n/a` |
| 1 | 模型 | 原文（MAGENTA）| `none` |
| 1 | `effort:` | `effort:high`（DIM）| `effort:n/a` |
| 1 | `think:` | `think:on` / `think:off`（DIM）| 無缺席態（absent 視為 off）|
| 1 | `token:` | `token:0.0k`…（DIM）| `token:n/a` |
| 1 | context bar | `███░ 42%` / 真 0 → `░░░…░ 0%` | `░░░…░ n/a` |
| 1 | `session:` | 原文（DIM）| `session:none` |
| 2 | `repo:` | 原文（DIM）| `repo:none` |
| 2 | `worktree:` | 原文（DIM）| `worktree:none` |
| 2 | `git:` | `git:main clean` / `git:main +2 ~1 ↑1↓2`（綠/黃）| `git:none`（不在 repo）|
| 2 | 增刪行 | `+0 -0`…（DIM）| `n/a` |
| 2 | `PR:` | `PR:#1234 pending`（YELLOW）| `PR:none` |
| 3 | `api:` | `api:0m`/`api:<1m`/`api:2m`（DIM）| `api:n/a` |
| 3 | `wall:` | `wall:3m`（DIM）| `wall:n/a` |
| 3 | `cost:` | `cost:$0.00`…（YELLOW）| `cost:n/a` |
| 3 | `5h:` | `5h:0%(reset …)`…（tier 色）| `5h:n/a` |
| 3 | `7d:` | `7d:34%(reset …)`…（tier 色）| `7d:n/a` |
| 4 | 8 個計數 | 真實數（含 `0`，DIM）| 無缺席態（檔案系統一定數得到，0 即真 0）|

### 顏色差異落在哪
- 原色**非 DIM** 的元素（`git` / `cost` / `PR` / `5h` / `7d`）：真值用語意色、`n/a`/`none` 用 DIM → 顏色明顯區分「有資料 vs 沒抓到」。
- 原色**本為 DIM** 的元素（目錄缺值、`effort` / `token` / `session` / `repo` / `worktree` / 增刪行）：靠**文字**（真值 vs `n/a`/`none`）區分。
- 關鍵：`5h:0%`（真 0，綠色）與 `5h:n/a`（沒抓到，灰）不再混淆。

### git 內部維持原樣（明確不變）
- 在 repo、無變動 → `git:main clean`（`clean` 是「讀到、變動數為 0」的真實表示，綠色）。
- ahead / behind 為 0 → **省略**（不強制 `↑0↓0`）。
- 僅「不在 git repo」（`gitInfo` 回 `null`）→ `git:none`（DIM）。

## 4. 整行顯示

每個元素恆有輸出，**4 行恆非空**。`buildOutput` 的「空行過濾」與 `joinLine` 的空值過濾退化為**防呆網**（保留、不再觸發）。不在 git repo 時第 2 行即整排灰色
`repo:none  worktree:none  git:none  +0 -0  PR:none`（其中 `+0 -0` 若 cost 有讀到則為真值 DIM、否則 `n/a`）。

## 5. 不變式 / 邊界

- 永不崩潰：所有改動仍在 `statusline.mjs` 的 try/catch 內；最壞情況（`buildOutput` 拋例外或回空）進入點仍印 `claude` 並 `process.exit(0)`。此 `claude` 是「緊急 fallback」，與第 1 行 model 元素的 `none` 是不同層級，並存合理。
- 純函式：render 仍只吃 `(d, deps)`，測試以構造的 `d` 物件覆蓋「沒抓到 / 真實 0 / 一般值」三類情境。

## 6. 測試（TDD，先紅後綠）

逐 render 函式補 / 改測；改對外行為，既有「驗隱藏」測試改為「驗佔位顯示」，並**新增「真實 0」案例**驗證不與 `n/a` 混淆。

- `renderLine1`
  - 空 `d` → `n/a`(目錄)、`none`(模型)、`effort:n/a`、`think:off`、`token:n/a`、空 bar + `n/a`、`session:none`；皆 DIM。
  - 真 0 案例：`total_input_tokens:0` → `token:0.0k`；`used_percentage:0` → 空 bar + `0%`（驗非 `n/a`）。
- `renderLine2`
  - `deps.git` 回 `null` → `git:none`（DIM）；回正常物件（含 `clean`）→ `git:main …` 綠/黃、ahead/behind 為 0 省略。
  - `repo`/`worktree`/`pr` 缺 → `none`（DIM）。
  - 增刪行：cost 有 `total_lines_added:0` → `+0 -0`（DIM）；無 cost → `n/a`（DIM）。
- `renderLine3`
  - 無 `cost`/`rate_limits` → `api:n/a wall:n/a cost:n/a 5h:n/a 7d:n/a`（皆 DIM）。
  - 真 0 案例：`total_cost_usd:0` → `cost:$0.00`（YELLOW）；`five_hour.used_percentage:0` → `5h:0%(reset …)`（tier 綠）；`total_api_duration_ms:0` → `api:<1m`。
- `renderLine4`：行為不變（沿用既有測試）。
- `buildOutput`：空 `d` → 仍輸出**完整 4 行**。
- 顏色斷言：`n/a`/`none` 驗 DIM 碼 `\x1b[38;2;130;130;130m`；真值/真 0 驗該元素原色碼。
- 全套 `npx vitest run` 全綠才逐 task commit。

## 7. 版本與文件

- `leon-statusline/.claude-plugin/plugin.json`：`1.1.1` → `1.2.0`。
- `resources/statusline-attributes.md`：改寫「條件顯示規則」段為「永不隱藏；讀到→真值（含真 0）原色，沒抓到→`n/a`/`none` 並 DIM」，並補版本沿革列。
