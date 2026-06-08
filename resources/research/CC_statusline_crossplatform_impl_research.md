# Claude Code 狀態列「跨平台實作」深度調研

> 調研日期：2026-06-08｜方法：聚焦 deep-research workflow（4 搜尋角度 → 6 來源抓取 → 統整）＋本機實測驗證。
> 主題：為「全自寫、跨 macOS/Windows/Linux」的 Claude Code 狀態列釐清六大實作難題——MCP 連線偵測、跨平台路徑陷阱、runtime 選擇、永不崩潰模式、`total_duration_ms` 閒置語意、各項設定的硬碟儲存位置與計數方式。
> 此檔為前一份《CC_statusline_config_research_2026-06-08.md》（基礎欄位/語法）的**實作延伸**。技術名詞、JSON key、程式碼一律保留原文英文。

---

## 1. MCP：能否偵測「實際已連線」的 server（而非僅「已設定」）？

**結論**：statusline 的 stdin JSON payload **沒有任何 MCP 欄位** [1]，所以拿不到連線狀態。唯一可行路徑是**自己 shell out 執行 `claude mcp list`**、解析每行連線狀態、並積極快取。

**做法（cc-statusline [3] 的實證模式）**：
- 用 `spawnSync` 執行 `claude mcp list`，設 `timeout: 15000`，`cwd` 設為 session 的 `workspace.current_dir`（讓專案級 `.mcp.json` 生效）。
- 每行用「**最後一個 ` - `**」(`lastIndexOf`) 切分，讓含連字號的 server 名稱不被切壞；狀態 regex：`/Connected/i`、`/Failed/i`、`/Needs authentication|Not authenticated/i`、`/Disconnected/i`，其餘為 `unknown`。
- 結果快取到**機器全域**檔（非 session 專屬）：`~/.claude/mcp-status-cache.json`，加 staleness gate（`STALE_MS = 90s`）——可把 8 小時約 960 次 spawn 壓到每小時數次。**在背景探測、絕不阻塞 render**。
- 專案級待審/被拒 server 在 `claude mcp list` 顯示為 `⏸ Pending approval` / `✗ Rejected` [4]。

**信心：HIGH**（官方文件 [1] + 實作 [3] + upstream issue [4] 三方佐證這是唯一路徑）。

**Caveats**：
- `claude mcp list` **抓不到部分內建橋接**（如 `claude-in-chrome`），所以你的計數可能**比 `/mcp` 顯示的少** [3]——應向使用者標註此分歧，別宣稱權威。
- 狀態可能與 `/mcp` 不一致：你的探測反映「最近一次 CLI 探測」，`/mcp` 反映「session 快取狀態」，連線中途變動時兩者會合理地不同 [3]。
- 從 Claude Code 狀態列內遞迴 spawn `claude` 很重，**90 秒快取不是可選項而是必須**。

---

## 2. 跨平台路徑 / 命令——確切陷阱與最安全寫法

**陷阱（皆有來源）**：
- **`~` 展開因 shell 而異**：Git Bash 會正確把 `~` 展開成 Windows 家目錄 [1]；但 **PowerShell 與 cmd 不會**——git/node 收到的是字面 `~`，會建出一個字面 `~` 資料夾（cc-statusline issue #6）[3]。所以 `~` 只在「Git Bash 執行該 command」時安全。
- **反斜線會被 Git Bash 吃掉**：命令字串裡的 `C:\Users\username\script.mjs` 到達 runner 時分隔符被吃掉、**靜默失敗** [1]。→ **命令字串一律用正斜線** `C:/Users/username/...`。
- **node vs python 呼叫**：直接用 `node`（跨平台一致）、用 `python3` 而非 `python` [2]。**避免 shell wrapper**（`bash -c`、`cmd /c`、`powershell -Command`）——會破壞可攜性 [2]。
- **腳本內部別用字串串接組路徑**：用 `path.join()`、`os.homedir()`、`os.tmpdir()`；**絕不**用字面 `/` 或 `\\`、**絕不**用 `$HOME`/`%USERPROFILE%`/`$env:USERPROFILE` [2]。

**最安全可攜寫法**：
- **settings.json 的 `command`**：`node ~/.claude/statusline.js` 之所以能在 Windows 運作，是因為 CC 在 Windows 上（若裝了 Git Bash）會把命令交給 Git Bash 執行（會展開 `~`），否則走 PowerShell [1]。→ **若要最大安全、且要散佈給別人，包成 plugin 用 `node ${CLAUDE_PLUGIN_ROOT}/statusline.js`** [3]——無 `~`、不必猜家目錄。
- **PowerShell 明確版**（沒有 Git Bash 時）：`powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1`——正斜線、`-NoProfile` [1]。
- **腳本內部**：一切用 `os.homedir()`/`path.join()` 解析，**永不信任 `~`**。

**信心：HIGH**（官方 [1] + claudefa.st [2] + 真實 install-bug [3] 三方收斂）。

---

## 3. Runtime 選擇——Node vs Python vs Go-binary vs Bun/Deno

**結論：強烈建議 Node.js（`node script.mjs`）。**

**理由**：
- 它是**唯一**在 Windows/Linux/macOS 用**同一種命令形式**（`node <path>`）呼叫、**不需 wrapper、不靠 shebang** 的 runtime [2][3]。claudefa.st 明令：「Delete every wrapper. Invoke Node.js directly.」[2]
- 最完整的參考實作 cc-statusline 全程只用 Node（狀態列 + 所有 hooks）[3]。
- **Node 保證存在於任何 Claude Code 環境**（Claude Code 本身就是 Node CLI）。Python3「只在處處都有時才可行」——較弱的保證 [2]。
- Bash 只在 macOS/Linux/Git-Bash 可用，在純 PowerShell Windows 直接死 [1]。
- `os.homedir()`/`os.tmpdir()`/`path.join()` 提供乾淨的跨平台原語 [2]。

**關於 Go-binary / Bun / Deno**：六份來源**皆未提及**用於狀態列。預編譯 Go 單檔執行檔在 runtime **最穩**（零直譯器依賴、快、無啟動成本）**但**帶來 build/散佈負擔與逐架構 binary——無來源佐證，屬推論，**信心 LOW**。Bun/Deno 重新引入「直譯器是否每台都裝」的問題，又沒有 Node 的「保證存在」。

**信心：HIGH（Node 為可靠性首選）**，因其「保證存在 + 零 wrapper 呼叫」。**Caveat**：若極在意冷啟動延遲且你掌控散佈，Go binary 理論更好但無來源。

---

## 4. 永不崩潰 / bulletproof 模式

**會讓狀態列變空白或壞掉的確切原因（除註明外皆出自 [1]）**：
1. 腳本 exit 非零 **或** 沒有 stdout → 狀態列**變空白**。
2. **只有 stdout 第一行**會成為狀態列；stderr 全部看不到 [2]。
3. `disableAllHooks: true` 會**整個停用**狀態列 [1]。
4. 未接受 workspace trust → 顯示「statusline skipped · restart to fix」[1]。
5. 腳本太慢會阻塞更新；若新 render 在執行中觸發，**進行中的那次會被取消** [1]——所以同步的長 MCP 探測可能**永遠跑不完**。
6. 欄位在第一次 API 回應前可能是 `null` → 必須 fallback（jq 的 `// 0`）[1]。
7. **Windows 靜默失敗**：命令路徑的反斜線被 Git Bash 吃掉 → 無任何可見錯誤 [1]。
8. `.sh` 腳本忘了 `chmod +x` 是「bash 狀態列不出現的幾乎唯一原因」[2]。
9. **成本歸零地雷**：若某 hook 寫了只含自己欄位的部分累計檔，下次 render 的 fallback 路徑可能把累計成本重設為 0 [3]。

**鐵律**：
- **一律 `exit 0`**（或 `process.exit(0)`），連內部錯誤也是——整個 body 包 try/catch，印出 fallback 行。**絕不讓例外傳播**。
- **一律至少印一行 stdout**。降級的一行勝過空白。
- **render 絕不阻塞於網路/子程序**。從快取檔讀；在 detached 背景程序刷新快取（cc-statusline 把 MCP 探測丟背景、快取新鮮就立即 exit）[3]。
- **每個 JSON 欄位都當作可能 null/缺失**；用 `?? 0` / `// 0` 兜底 [1]。
- **累計/狀態檔須單調不減**——寫前先讀硬碟值、絕不讓總值下降、寫前備份、缺欄位絕不重設總值 [3]。
- **狀態存 `~/.claude/...`、不存 `os.tmpdir()`**——Windows Storage Sense / Linux `/tmp` 清理會抹掉 tmp 狀態 [3]。
- **快取檔命名用 JSON input 的 `session_id`**（每 session 穩定唯一）。**絕不用 `$$`/`getpid()`/`process.pid`**——每次 invocation 都變、會讓快取失效 [1]。
- **用 `claude --debug` 除錯**——會記錄第一次 invocation 的 exit code + stderr [1]。
- **別靠 `process.stdout.columns`/`tput cols`/`$COLUMNS` 判斷寬度**——全壞（stdio 是 pipe）[3]。改讀 `COLUMNS`/`LINES` 環境變數（CC v2.1.153+）[1]；否則 fallback 到寫死寬度（cc-statusline 用 120）[3]。

**信心：HIGH**（直接記載的失敗模式 + 實戰驗證的緩解）。

---

## 5. `cost.total_duration_ms` 是否含閒置時間？

**答案：含閒置時間（YES）。** 定義為「Total wall-clock time since the session started, in milliseconds」，且明確「counts all elapsed wall-clock time including idle time」——與 `cost.total_api_duration_ms`（等待 API 的時間）相異 [1]。

**信心：HIGH**——官方狀態列文件直接陳述 [1]。（來源 [2][4][5][6] 完全未提及此欄位——非衝突，只是沉默；僅 [1] 有記載。）

**Caveats**：
- 數值在閒置時**持續成長**（它是 wall-clock），**但狀態列在閒置時不會自動重跑去顯示新值**，除非設 `refreshInterval`；否則更新是事件驅動（assistant 訊息後、/compact、模式/vim 變更）[1]。
- **若要「活躍時間」（排除閒置），不要用此欄位**。cc-statusline 的做法是另外算活躍時間：用 hooks 累計每輪 `(Stop ts − UserPromptSubmit ts)`，自然排除輪間閒置 [3]。依「要含閒置的 wall-clock（`total_duration_ms`）」或「純活躍（hook 追蹤）」二選一。

> 補充釐清：`total_api_duration_ms` 與 `total_duration_ms` **兩者都是整個 session 累計**。差別在 API 時間只累計「等 Claude 回應」那幾段（通常遠小於 wall-clock）；所以一個重度 session 下 API 時間會慢慢長到數分鐘，但 session 早期在「分鐘精度」下會顯示 `0m`。

---

## 6. agents / skills / commands / hooks / plugins / workflows / mcp 的硬碟儲存位置與「啟用」判定

**設定根目錄覆寫**：`CLAUDE_CONFIG_DIR` 可覆寫儲存根，預設 `~/.claude/` [2]。Plugin 檔案經 `${CLAUDE_PLUGIN_ROOT}`（bundled）與 `${CLAUDE_PLUGIN_DATA}`（持久狀態）解析 [4]。

**具體路徑（user / project / plugin）**：

| 項目 | User 層 | Project 層 | Plugin 層 | 「啟用」判定 |
|---|---|---|---|---|
| **settings** | `~/.claude/settings.json` [1][2] | `.claude/settings.json` + `.claude/settings.local.json`（gitignore 個人覆寫）[2][4] | plugin `settings.json`（可附 subagentStatusLine 預設）[1] | 合併；`disableAllHooks` 同時關 hooks+statusline [1] |
| **commands (slash)** | — | `.claude/commands/`（markdown）[2] | plugin `commands/` 目錄 [3] | 檔案存在 = 可用 |
| **agents** | — | `.claude/agents/`（YAML frontmatter）[2] | — | 檔案存在 |
| **hooks** | `~/.claude/hooks/` [2][3] | `.claude/hooks/`、logs 在 `.claude/hooks/logs/` [2] | plugin `hooks/hooks.json`，安裝時自動註冊 [3] | settings 的 `hooks` 區塊宣告；`disableAllHooks:true` 全關 [1] |
| **skills** | — | `.claude/skills/`、規則在 `.claude/skills/skill-rules.json` [2] | — | （見 caveat）|
| **plugins** | 安裝目錄經 `${CLAUDE_PLUGIN_ROOT}`；metadata `.claude-plugin/plugin.json` + `marketplace.json` [3] | — | 自身 | **`enabledPlugins`** settings key = 已啟用集合；`extraKnownMarketplaces` 列出 marketplace [2] |
| **MCP servers** | user scope + local scope 皆在 `~/.claude.json`（注意：是**頂層 dotfile**，不是 `~/.claude/` 目錄內）[4] | 專案根的 `.mcp.json`（版控）[4] | plugin 根的 `.mcp.json` 或 `plugin.json` 內聯 [4] | 連線/失敗/待審只能經 `claude mcp list`（見 §1）|
| **statusline 腳本/狀態** | `~/.claude/statusline.js`、狀態存 `~/.claude/`（**非 tmp**）[1][3] | `.claude/settings.json` 的 `statusLine` 區塊 [1] | `${CLAUDE_PLUGIN_ROOT}/statusline.js` [3] | settings 設 `statusLine.type:"command"` |

**計數具體做法**：
- Slash commands：數 `.claude/commands/`（專案）+ plugin `commands/` 的 `*.md`。
- Agents：數 `.claude/agents/` 的檔案。
- Hooks：數**合併後 settings 的 `hooks` 區塊條目**（不是只數硬碟檔案——檔案沒被註冊就不算啟用）；plugin hooks 來自各 plugin 的 `hooks/hooks.json`。
- Plugins：數 settings 的 `enabledPlugins` [2]，不是所有已安裝。
- MCP「已設定」：解析 `~/.claude.json`（user+local scope）+ 專案 `.mcp.json` + plugin 定義。MCP「已連線」：只能經 `claude mcp list`（§1）。
- Skills：列舉 `.claude/skills/` 目錄；`skill-rules.json` 描述啟用 [2]。

**信心**：
- MCP scope/路徑：**HIGH**（官方 [4]）。
- commands/agents/hooks/settings 路徑：**MEDIUM-HIGH**（[2][3] 為社群 blog + repo，非官方；官方狀態列頁 [1] 明確未記載這些）。
- **Skills / agents / workflows：UNCERTAIN / 來源衝突**。claudefa.st [2] 引 `.claude/skills/` + `.claude/agents/`，但 cc-statusline [3] 明確聲明「Claude Code 沒有為 'skills'/'agents'/'workflows' 提供官方記載的儲存路徑——這些不是該 codebase 使用的詞」。**沒有任何來源給出 'workflows' 的路徑**。→ 這三者路徑視為 best-effort，**用於計數前須在實機驗證**。

**衝突 / 須標註旗標**：
- 「workflows」儲存路徑：**所有來源皆查無** → 不要自己發明。
- skills/agents 目錄是否存在：[2] 與 [3] **衝突** → 在實機驗證（檢查 `.claude/skills/`、`.claude/agents/` 是否存在），別假設。
- 兩種 MCP 設定檔並存：Claude **Code** 用 `~/.claude.json`（頂層 dotfile）做 user/local MCP scope [4]；Claude **Desktop** 用 `~/Library/Application Support/Claude/claude_desktop_config.json` [6]——別混為一談。
- 「硬碟上有檔」≠「啟用」，hooks 與 plugins 尤其如此（分別 gate 於 `hooks` 區塊與 `enabledPlugins`）→ 純數檔案會高估。

---

## 本機實測補充（2026-06-08，本專案 Project_01）

研究說 skills/agents/workflows 路徑不確定，故在本機驗證「只算專案＋user 自訂」範圍的真實數字：

| 項目 | 路徑 | 實測 |
|---|---|---|
| agent | `.claude/agents/*.md` | **1**（`sales-coder.md`）|
| skill | `.claude/skills/**/SKILL.md` | **2**（`test-driven-development`、`project-01-workflow`）|
| workflow | `.claude/workflows/*.js` | **1**（`skill-edd-regression.js`）— 研究稱「無官方路徑」，但本機**確實有此目錄**，可數 |
| hook | `.claude/hooks/*.ps1` | 約 **13** 支腳本（精確應數 settings.json 註冊條目）|
| plugin / mcp | settings `enabledPlugins` / `~/.claude.json` | 待讀設定 |

⚠️ **關鍵實測**：嘗試 glob **plugin 帶的 skill**（superpowers 等）時**抓不到**（plugin 快取結構深且不穩）→ 佐證「含 plugin」不只數字大又雜、且**不可靠**。故第4行計數**採「只算專案＋user 自訂」**。

---

## 參考來源

[1] Customize your status line — Claude Code Docs — https://code.claude.com/docs/en/statusline
[2] Claude Code Hooks on Windows, Linux, and macOS (2026) — claudefa.st — https://claudefa.st/blog/tools/hooks/cross-platform-hooks
[3] cc-statusline GitHub（MCP health probe via `claude mcp list`）— https://github.com/NYCU-Chung/cc-statusline
[4] Connect Claude Code to tools via MCP — Official Docs — https://code.claude.com/docs/en/mcp
[5] Add per-MCP-server log files (parity with Claude Desktop) · Issue #29035 · anthropics/claude-code — https://github.com/anthropics/claude-code/issues/29035
[6] [BUG] Environment variables from `env` section not passed to MCP servers · Issue #1254 · anthropics/claude-code — https://github.com/anthropics/claude-code/issues/1254
