# Claude Code Plugin 開發 Playbook（通用 SOP）

> 從 leon-statusline 抽象出的「**下次做任何 Claude Code plugin 都能照走**」的標準步驟與檢查清單。
> 與 `development-journal.md`（本專案故事）不同：這份是**去專案化、可重用**的方法論。

---

## 0. 適用情境
你要做一個可散佈、跨平台的 Claude Code 擴充（statusline / skill / agent / hook / MCP / 指令）。
核心原則：**跨平台通用、零執行期依賴（或明確的前置依賴）、永不崩潰、可分享可升級。**

---

## 1. 流程總覽
```
調研 → brainstorm 設計 → spec → plan → TDD 實作 → 封裝 plugin → 安裝驗證 → 升級自動化 → 文件
```
每階段都有「產出」與「驗證」，做完才進下一階段。

---

## 2. 各階段

### 階段 1：調研（動手前）
- 用 deep-research / 官方文件查清楚**這類擴充的機制與限制**。
- **務必查官方 `plugins-reference` 與目標元件文件**（statusline / hooks / skills…）。
- 不確定、來源衝突的點 → **派多個 subagent 交叉驗證**，別憑記憶。
- 產出：研究筆記（放 `resources/research/`）。
- 驗證：能回答「這個元件能做什麼、不能做什麼、資料從哪來」。

### 階段 2：brainstorm 設計
- 定**功能範圍**（YAGNI，砍掉非必要）、**視覺/輸出格式**、**資料來源對照表**。
- 視覺若要跨平台分享 → **避免 Nerd Font 私有區字元**（別人沒裝會變豆腐），用標準 Unicode。
- 列出「**拿得到 vs 拿不到**」的資料（執行期狀態多半拿不到），不要顯示假資料。
- 產出：版面/元素/條件顯示規則定案。

### 階段 3：spec
- 寫死：目標、非目標、架構、各元素來源與格式、錯誤處理、測試策略、封裝方式。
- 產出：`spec.md`。自審（無 placeholder、前後一致、範圍聚焦）。

### 階段 4：plan
- 拆成 **bite-sized TDD task**：每個 task = 寫失敗測試 → 跑紅 → 最小實作 → 跑綠 → commit。
- 每個 task 含**完整程式碼與指令**，不留 TODO。
- 產出：`plan.md`。

### 階段 5：TDD 實作
- 邏輯拆**單一職責純函式模組**（易測）；IO（檔案/子程序）獨立、全部容錯。
- 進入點只負責 stdin→組裝→輸出→`exit 0`。
- 逐 task 紅→綠→commit。全綠才往下。
- 跨平台路徑鐵律：**`os.homedir()` + `path.join()`**；不信任 `~`、不拼字串、不讀 `$HOME`/`%USERPROFILE%`；命令字串用正斜線。

### 階段 6：封裝為 plugin（repo 兼 marketplace）
標準結構：
```
<repo>/
  .claude-plugin/marketplace.json     # name / owner{name} / plugins[].source
  <plugin>/
    .claude-plugin/plugin.json        # name(必填) / version / hooks 等
    <元件：skills/ commands/ agents/ hooks/hooks.json / .mcp.json / 腳本>
```
- `version` 要設，**改對外行為一定 bump**（否則使用者 `/plugin update` 收不到）。
- `claude plugin validate <plugin>` 要過。

### 階段 7：安裝驗證
```
/plugin marketplace add <owner/repo>
/plugin install <name>@<marketplace>
（若需要）/<name>:<setup 指令>
```
- 重啟 / `/reload-plugins` 生效。空白就用 `claude --debug` 看 exit code/stderr。

### 階段 8：升級自動化（若有寫死路徑）
- 若你把「帶版號的安裝路徑」寫進使用者 settings → 升級後會過時。
- 解法：plugin 內建 **SessionStart hook**，每次開 session 跑「sync」自動重指到當前 `${CLAUDE_PLUGIN_ROOT}`（idempotent、只動自己的、寫前備份、靜默）。

### 階段 9：文件
- repo 三層 `CLAUDE.md`(精簡紅線+導航) + `CODE_MAP.md`(細目索引)。
- `resources/`：開發日誌、技術決策、踩坑、屬性、本 playbook、研究副本。
- public repo 補 `LICENSE`。

---

## 3. Plugin 關鍵限制（血淚知識）
1. **plugin 的 `settings.json` 只支援 `agent` / `subagentStatusLine`** —— 不能帶主 `statusLine`。要裝主 statusLine 得用「setup 指令寫進使用者 settings.json」。
2. **`${CLAUDE_PLUGIN_ROOT}` 不是到處都展開**：在 skill/agent/hook/monitor/MCP/LSP 內容會展開；**statusLine 命令不展開**（實測）。需要絕對路徑時，在「會展開的情境」（如 skill / hook）裡先解析再寫入。
3. **升級後安裝路徑帶版號會變、舊路徑約 7 天後刪** → 別把純版號路徑當永久；用 SessionStart hook 重指或 `npx <pkg>@latest`。
4. **元件路徑語意**：`skills` 是「加到」預設；`commands`/`agents`/`outputStyles` 是「取代」預設。
5. **`hooks/hooks.json` 放 plugin 根的 `hooks/`**（不可放 `.claude-plugin/` 內）；可自動探索，也可在 plugin.json 顯式宣告。
6. **SessionStart hook 的 stdout 會被當成 session context 注入** → 自動化用途要靜默。

---

## 4. 踩坑檢查清單（commit 前自問）
- [ ] 任何輸入都 `exit 0` 且至少印一行？（永不崩潰）
- [ ] 每個外部欄位都當可能 null/缺失處理？
- [ ] 路徑全用 `os.homedir()`+`path.join()`、命令用正斜線？
- [ ] 子程序/網路**不阻塞** render（走快取、設 timeout、失敗略過）？
- [ ] 狀態檔存 `${CLAUDE_PLUGIN_DATA}`/`~/.claude` 而非 tmp；快取 key 用 `session_id` 非 pid？
- [ ] 寫使用者設定檔前**備份**、只動自己的鍵、不破壞其他設定？
- [ ] 測試在 Windows/macOS/Linux 都過？（路徑分隔符別硬寫；期望值也用 `join()` 建）
- [ ] 改對外行為有 bump `plugin.json` version？
- [ ] `claude plugin validate` 通過？

---

## 5. 散佈與升級（給使用者的話）
- 安裝：`/plugin marketplace add` → `/plugin install` →（必要的 setup 指令）。
- 升級：`/plugin marketplace update <marketplace>`（會一併 bump 已安裝 plugin）→ 重啟。
- private repo 也能當 marketplace（團隊內部用）。
