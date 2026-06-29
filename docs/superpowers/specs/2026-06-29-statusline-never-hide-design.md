# 設計：狀態列「永不隱藏」（所有元素皆顯示，缺值用自然零值）

- 日期：2026-06-29
- 狀態：設計定稿，待實作
- 影響版本：`leon-statusline/.claude-plugin/plugin.json` 1.1.1 → **1.2.0**（對外顯示行為變更）

## 1. 背景與目標

現況採「條件顯示」：元素的值缺席／拿不到時，**連標題一起隱藏**；某行所有元素全缺時，**整行消失**。

目標改為 **所有元素永不隱藏**：值缺席時，冒號後顯示該元素的「**自然零值**」（每個元素語意化的預設），且**零值以暗灰（DIM）呈現**，與真資料區別。

> 不影響的紅線：永不崩潰（一律 `exit 0`、至少印一行）、路徑安全、`${CLAUDE_PLUGIN_ROOT}` 不入 statusLine 命令、setup/hook 邏輯。

## 2. 範圍

- 主改 `src/render.mjs` 四個 render 函式的「缺值分支」。
- `src/color.mjs`：`gradientBar` 已能處理 `0`（全空槽），改為呼叫端傳 `pct ?? 0`，函式本身不改。
- `src/format.mjs`：`attr` 行為不變（仍隱藏 `null`/`''`）；改由呼叫端保證傳入非空字串。
- **不改**：`statusline.mjs`（進入點崩潰安全）、`setup.mjs`、`hooks/`、`cache`/`git`/`count`/`input`。
- bump `plugin.json` `version` → `1.2.0`。

## 3. 行為規格：自然零值對照表

| 行 | 元素 | 有值 | 缺席時（自然零值） | 缺值顏色 |
|---|---|---|---|---|
| 1 | 目錄 | 縮短路徑（BLUE） | `-` | DIM |
| 1 | 模型 | 原文（MAGENTA） | `none` | DIM |
| 1 | `effort:` | low…max | `effort:none` | DIM（原本就是 DIM）|
| 1 | `think:` | `think:on` | `think:off` | DIM |
| 1 | `token:` | `token:15.5k` | `token:0.0k` | DIM |
| 1 | context bar | `███░ 42%` | `░░░…░ 0%`（全空槽，20 格）| bar 自帶（空槽本就灰）|
| 1 | `session:` | 原文 | `session:none` | DIM |
| 2 | `repo:` | 原文 | `repo:none` | DIM |
| 2 | `worktree:` | 原文 | `worktree:none` | DIM |
| 2 | `git:` | `git:main clean` / `git:main +2 ~1 ↑1↓2` | `git:none`（不在 repo）| 有值：綠/黃；缺值：DIM |
| 2 | 增刪行 | `+156 -23` | `+0 -0` | DIM（原本就是 DIM）|
| 2 | `PR:` | `PR:#1234 pending`（YELLOW）| `PR:none` | DIM |
| 3 | `api:` | `api:2m` | `api:0m` | DIM |
| 3 | `wall:` | `wall:3m` | `wall:0m` | DIM |
| 3 | `cost:` | `cost:$1.33`（YELLOW）| `cost:$0.00` | DIM |
| 3 | `5h:` | `5h:24%(reset 1h23m)`（tier 色）| `5h:0%`（無 reset 後綴）| DIM |
| 3 | `7d:` | `7d:34%(reset 4d4h)`（tier 色）| `7d:0%`（無 reset 後綴）| DIM |
| 4 | 8 個計數 | 數字（DIM）| 本來就顯示 `0` | 不變 |

### git 內部維持原樣（明確不變）
- 在 repo、無變動 → `git:main clean`（`clean` 即 git 的自然零值）。
- ahead / behind 為 0 → **省略**（不強制 `↑0↓0`，避免噪音）。
- 僅「不在 git repo」（`gitInfo` 回 `null`）→ `git:none`（DIM）。

## 4. 顏色規則

- **真值**：維持各元素原本顏色（dir BLUE、model MAGENTA、git 綠/黃、cost/PR 黃、rate tier 色、其餘 DIM）。
- **零值 / none**：一律 **DIM**（`[130,130,130]`，ANSI `\x1b[38;2;130;130;130m`）。
- 理由：(a) `git:none` 不在 repo 時沒有 `g` 物件、本就無語意色可用；(b) 避免 `5h:0%` 落在綠色被誤讀為「用量 0%、良好」；(c) 真資料更跳。
- 實作零成本：各 render 呼叫端的「有值／缺值」分支本就存在，缺值分支改傳 `DIM`。

## 5. 整行顯示

因每個元素恆有輸出，**4 行恆非空**。`buildOutput` 的「空行過濾」與 `joinLine` 的空值過濾退化為**防呆網**（保留、不再觸發）。即：不在 git repo 時第 2 行顯示為整排灰色的
`repo:none  worktree:none  git:none  +0 -0  PR:none`。

## 6. 不變式 / 邊界

- 永不崩潰：所有改動仍在 `statusline.mjs` 的 try/catch 內；最壞情況（整個 `buildOutput` 拋例外或回空）進入點仍印 `claude` 並 `process.exit(0)`。此 `claude` 是「緊急 fallback」，與第 1 行 model 元素的 `none` 是不同層級，兩者並存合理。
- 純函式：render 仍只吃 `(d, deps)`，測試以構造的 `d` 物件覆蓋各缺值情境。

## 7. 測試（TDD，先紅後綠）

逐 render 函式補 / 改測；改對外行為，既有「驗隱藏」的測試需改為「驗零值顯示」。

- `renderLine1`：空 `d`（無 workspace/model/effort/thinking/context_window/session_name）→ 含 `-`、`none`、`effort:none`、`think:off`、`token:0.0k`、空 bar `0%`、`session:none`；驗各零值字串與 DIM 碼。
- `renderLine2`：`deps.git` 回 `null` → `repo:none worktree:none git:none +0 -0 PR:none`（皆 DIM）；`deps.git` 回正常物件 → 維持 `git:main …` 與綠/黃色、ahead/behind 為 0 省略。
- `renderLine3`：無 `cost`/`rate_limits` → `api:0m wall:0m cost:$0.00 5h:0% 7d:0%`（皆 DIM、無 reset 後綴）；有真值 → 維持原格式與 tier 色。
- `renderLine4`：行為不變（沿用既有測試）。
- `buildOutput`：空 `d` → 仍輸出**完整 4 行**（驗永不隱藏）。
- 顏色：以 `\x1b[38;2;130;130;130m`（DIM）斷言零值；以原色斷言真值。
- 全套 `npx vitest run` 全綠才逐 task commit。

## 8. 版本

`leon-statusline/.claude-plugin/plugin.json`：`1.1.1` → `1.2.0`（顯示行為明顯變更，minor）。同步更新 `resources/statusline-attributes.md` 的「條件顯示規則」段落（改述為「永不隱藏 + 自然零值」）與版本沿革。
