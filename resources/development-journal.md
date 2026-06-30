# 開發日誌：leon-statusline

> 一句話：把「想要一個漂亮、跨平台、可分享的 Claude Code 狀態列」這個念頭，走完整 brainstorm → 調研 → spec → plan → TDD → 封裝 → 安裝 → 升級自動化，做成 v1.2.0 的 plugin。

---

## 0. 起點與目標
- **目的一**：跨 macOS / Windows / Linux 通用，能分享給別人裝。
- **目的二**：精緻漂亮。
- 後來補的硬需求：**永不崩潰**（狀態列出錯會害 Claude Code 開不了，要 `claude doctor` 修）、**零執行期依賴**。

## 1. 調研（設計前）
- 用 deep-research 調查狀態列基礎：`settings.json` 的 `statusLine` 設定、腳本從 stdin 收到的完整 JSON 欄位、ANSI/顏色、`/statusline` 指令、社群工具。
- 產出 → `research/CC_statusline_config_research.md`。

## 2. 設計（brainstorming，逐版定案）
逐步把版面定成 **4 行**，並反覆微調：
- 元素位置（session 名在第 1 行還第 2 行來回搬過幾次）、標籤用英文、`5h:`/`7d:` 用冒號、時間精度到分鐘、不用 emoji（一度想加，最後覺得亂）。
- 視覺路線：原本想要 claude-powerline 那種 powerline 分段，後來因 **Nerd Font 字型依賴**（別人沒裝會變豆腐）而放棄，改 **純文字空格分隔 + truecolor 平滑漸層 bar**。
- 第 4 行「基礎設施數量」語意：從「當前啟用且可用」收斂成「**已設定 / 可發現**」（執行期狀態拿不到），範圍定為**只算專案＋user 自訂**。

## 3. 工具選型探索
- 先想用現成工具（claude-powerline / ccusage / ccstatusline）。
- 發現它們**做不出第 4 行**（mcp/agent/skill/hook/plugin/workflow 計數，沒有這種 widget），且要 `npx` 拉套件。
- → 決定 **全自寫**（Node.js）。

## 4. spec + plan（SDD）
- 寫 `spec`（版面/各 attribute 來源與格式/條件顯示/計數定義/架構/快取/永不崩潰/測試）。
- 寫 `plan`（11 個 bite-sized TDD task，逐模組 test→impl→commit）。

## 5. 調研（實作前，第二輪）
實作前再調研幾個不確定點 → `research/CC_statusline_crossplatform_impl_research.md`：
- MCP 連線數能不能拿到（結論：只能 spawn `claude mcp list`，太重 → 只做已設定數）。
- 跨平台路徑陷阱（`~`、反斜線）。
- runtime 選擇（Node 最穩）。
- 怎樣會害 Claude Code 開不了 + 永不崩潰 patterns。
- `total_duration_ms` 含不含閒置（含）。
- 各項計數的硬碟儲存位置。

## 6. TDD 實作
逐模組紅綠燈、逐 task commit：
`color` → `format` → `input` → `cache` → `git` → `count` → `render` → `statusline.mjs`(進入點) → `setup`。
- 共 **55 個測試**全綠。
- 實機 smoke test：餵 mock JSON，4 行彩色面板正確輸出、exit 0。

## 7. 封裝為 plugin + 第三輪調研
- 封裝成 Claude Code plugin（repo 兼 marketplace）。
- 調研 plugin 製作 → `research/CC_create_plugins_official_guide.md`：
- **關鍵發現（會改架構）**：plugin 的 `settings.json` **只支援 `agent` / `subagentStatusLine`，不支援主 `statusLine`** → 「裝 plugin 就自動出現狀態列」不成立。
- 派 **2 個獨立 agent 交叉驗證**（官方文件 + 4 個真實 statusline plugin）→ 全部確認：真實 plugin 都靠「setup 指令 / 手動編輯 settings.json」才裝得上主 statusLine。
- → 改成 **plugin 帶腳本 + `/leon-statusline:setup-statusline` 指令**，由 setup 安全寫入使用者 settings.json（偵測既有 statusLine → 停下來問 → 覆蓋前備份）。

## 8. 安裝驗證
- `/plugin marketplace add` → `/plugin install` → `/leon-statusline:setup-statusline user`。
- setup 偵測到既有 statusLine（舊的 Node 一行腳本）→ 停下問 → 同意覆蓋 → 備份後寫入。✅
- 驗證 settings.json：statusLine 指向絕對路徑、其他設定全保留、備份存在。

## 9. 升級路徑問題 →（B）失敗 →（C）成功
- 問題：setup 寫的是**帶版號的絕對路徑**（`…/1.0.0/statusline.mjs`）；plugin 更新後路徑變、舊路徑約 7 天後被清。
- **試 (B)**：在 statusLine 命令裡直接留 `${CLAUDE_PLUGIN_ROOT}`，看 CC render 時會不會展開 → **實測：不展開，狀態列空白**（印證調研與 issue #9354）。秒退還原。
- **上 (C)**：plugin 內建 **SessionStart hook**，每次開 session 跑 `setup.mjs --sync`，自動把「我們的、過時的」statusLine 路徑重指到當前版本（idempotent、寫前備份、不碰別人設定）→ **v1.1.0**。
- 驗證：更新到 1.1.0 → 重啟 → settings.json 路徑自動從 `1.0.0` 重指到 `1.1.0`。✅

## 10. 慣例收尾
- `plugin.json` 顯式宣告 `"hooks": "./hooks/hooks.json"`（標準慣例；功能與自動探索相同）→ **v1.1.1**。
  - ⚠️ **後來移除**（commit `0a713cf`，1.2.0 起不再宣告）：CC 會**自動載入**標準 `hooks/hooks.json`，manifest 再宣告一次造成 **Duplicate-hooks-file load error**（`/doctor` 可見），反而害 SessionStart 自動重指 hook 載不進來。manifest 的 `hooks` 只該放**額外**的 hook 檔；移除後標準 `hooks.json` 正常單次載入。
- `claude plugin validate` ✔ 通過。

---

## 11. v1.2.0：狀態列永不隱藏
- 需求：所有元素永不隱藏；**0 值不可與「沒抓到」混為一談**。
- 規格：讀到值（含真實 `0`）→ 顯示真值（如 `cost:$0.00`、`5h:0%`、`+0 -0`）並維持元素原色；沒抓到 → 名稱類 `none`、數值類 `n/a`，一律 **DIM 灰**（灰色專指「沒資料」，與真 0 用文字＋顏色雙重區分）。例外：`think` 永遠 on/off、第 4 行計數 0 即真 0。
- 實作（brainstorm→spec→plan→TDD）：`gradientBar` 區分 null(n/a)/真0(0%)；render 新增 `field` helper；逐行改寫 renderLine1/2/3；加「4 行永不隱藏」回歸測試。**63 測試全綠**。spec/plan 留在 `docs/superpowers/`。
- 插曲：合回 main 時撞上 origin 的 `0a713cf`（manifest hooks 修正）分歧 → **rebase** 化解，保留該修正、`plugin.json` 收斂為 v1.2.0 且無 manifest hooks。

---

## 版本沿革
| 版本 | 內容 |
|---|---|
| 1.0.0 | 首版：4 行狀態列腳本 + setup 指令（plugin + marketplace）|
| 1.1.0 | 加 SessionStart hook，升級後自動重指 statusLine 路徑 |
| 1.1.1 | plugin.json 顯式宣告 hooks（慣例）|
| 1.2.0 | 狀態列永不隱藏：讀到→真值（含真 0）原色，沒抓到→n/a/none 並 DIM |

## 最終狀態
- v1.2.0、**63 測試全綠**、**0 npm 漏洞**、public GitHub、跨平台、自動重指、**狀態列永不隱藏**。
- 構成：`statusline.mjs`（進入點）+ `src/`（color/format/input/cache/git/count/render）+ `setup.mjs` + `skills/setup-statusline/` + `hooks/hooks.json`（標準路徑自動載入，manifest 不再宣告）。
